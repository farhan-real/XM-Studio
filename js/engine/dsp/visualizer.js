/**
 * js/engine/dsp/visualizer.js - Lightweight 10 FPS spectrum visualizer with precomputed O(1) cache priority.
 */
(function(window) {
  const canvas = document.getElementById('visualizer');
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.imageSmoothingEnabled = false;

  const TOTAL_BARS = 28;
  const dataArray = new Uint8Array(32);
  const smoothedValues = new Float32Array(TOTAL_BARS);
  const frameBars = new Uint8Array(TOTAL_BARS);
  const FRAME_INTERVAL = 100;

  const BIN_MAP = new Uint8Array(TOTAL_BARS);
  for (let i = 0; i < TOTAL_BARS; i++) {
    BIN_MAP[i] = Math.min(30, Math.floor(1 + Math.pow(i / (TOTAL_BARS - 1), 1.35) * 28));
  }

  const PALETTE = [
    '#1e293b', '#52525b', '#ec4899', '#3b82f6', '#ef4444',
    '#a855f7', '#22c55e', '#fde047', '#f97316'
  ];

  let activePlayer = null;
  let isLoopRunning = false;
  let isThrottled = false;
  let rafId = null;
  let lastFrameTime = 0;
  let cachedDpr = 1;

  let cachedWidth = 0;
  let cachedHeight = 0;
  let cachedMaxBarH = 0;
  let cachedMinBarH = 0;
  let cachedBarWidth = 0;
  let cachedStep = 0;

  let cachedVisData = null;
  let cachedVisFps = 10;

  function isCanvasVisible() {
    return !document.hidden && canvas.offsetWidth > 0 && canvas.offsetHeight > 0;
  }

  function drawIdleBackground() {
    if (canvas.width > 0 && canvas.height > 0) {
      ctx.fillStyle = '#090a0d';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }

  function resizeCanvas() {
    cachedDpr = Math.min(window.devicePixelRatio || 1, 1.25);
    const parent = canvas.parentElement;
    if (!parent) return;

    const w = Math.floor(parent.clientWidth * cachedDpr);
    const h = Math.floor(parent.clientHeight * cachedDpr);

    if (w > 0 && h > 0 && (canvas.width !== w || canvas.height !== h)) {
      canvas.width = w;
      canvas.height = h;
      cachedWidth = w;
      cachedHeight = h;
      ctx.imageSmoothingEnabled = false;

      cachedMaxBarH = cachedHeight - Math.round(8 * cachedDpr);
      cachedMinBarH = Math.max(2, Math.round(2 * cachedDpr));
      const spacing = Math.max(1, Math.round(3 * cachedDpr));
      const totalSpacing = spacing * (TOTAL_BARS - 1);
      cachedBarWidth = Math.max(1, Math.floor((cachedWidth - totalSpacing) / TOTAL_BARS));
      cachedStep = cachedBarWidth + spacing;
      drawIdleBackground();
    }
  }

  function clear() {
    smoothedValues.fill(0);
    frameBars.fill(0);
    dataArray.fill(0);
    if (canvas.width === 0 || canvas.height === 0) resizeCanvas();
    drawIdleBackground();
  }

  function setVisualizerCache(data, fps) {
    cachedVisData = data ? new Uint8Array(data) : null;
    cachedVisFps = fps || 10;
  }

  function clearVisualizerCache() {
    cachedVisData = null;
    clear();
  }

  function sleep() {
    isLoopRunning = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    clear();
  }

  function wake(player) {
    if (player) activePlayer = player;
    if (document.hidden || !isCanvasVisible()) { sleep(); return; }
    if (!isLoopRunning && window.XMAudio && window.XMAudio.isPlaying()) {
      isLoopRunning = true;
      lastFrameTime = performance.now();
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(renderFrame);
    }
  }

  function setThrottled(throttled) { isThrottled = throttled; }

  resizeCanvas();
  window.addEventListener('resize', resizeCanvas, { passive: true });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) sleep();
    else if (isCanvasVisible() && window.XMAudio && window.XMAudio.isPlaying()) wake(activePlayer);
  });
  window.addEventListener('pagehide', sleep, { passive: true });

  function renderFrame(now) {
    const isLive = window.XMAudio ? window.XMAudio.isPlaying() : false;
    if (!isLive || document.hidden || !isCanvasVisible()) {
      clear();
      sleep();
      return;
    }

    const interval = FRAME_INTERVAL;
    const elapsed = now - lastFrameTime;
    if (elapsed < interval) {
      if (isLoopRunning) rafId = requestAnimationFrame(renderFrame);
      return;
    }

    lastFrameTime = now - (elapsed % interval);
    if (canvas.width === 0 || canvas.height === 0) resizeCanvas();
    drawIdleBackground();

    let hasData = false;

    if (cachedVisData && cachedVisData.length > 0) {
      const pos = window.XMAudio.getPosition();
      const fIdx = Math.floor(pos * cachedVisFps);
      const offset = fIdx * TOTAL_BARS;
      if (offset >= 0 && offset + TOTAL_BARS <= cachedVisData.length) {
        for (let b = 0; b < TOTAL_BARS; b++) {
          frameBars[b] = cachedVisData[offset + b];
        }
        hasData = true;
      }
    }

    if (!hasData && activePlayer && activePlayer.analyser) {
      activePlayer.analyser.getByteFrequencyData(dataArray);
      let signalSum = 0;
      for (let i = 0; i < TOTAL_BARS; i++) {
        const binIdx = BIN_MAP[i];
        let raw = dataArray[binIdx];
        if (binIdx + 1 < 32 && dataArray[binIdx + 1] > raw) raw = Math.max(raw, dataArray[binIdx + 1]);
        frameBars[i] = raw < 10 ? 0 : raw;
        signalSum += frameBars[i];
      }
      if (signalSum > 0) hasData = true;
    }

    if (hasData && cachedWidth > 0) {
      let currentStyle = '';
      for (let i = 0; i < TOTAL_BARS; i++) {
        const raw = frameBars[i];
        if (raw > smoothedValues[i]) smoothedValues[i] += (raw - smoothedValues[i]) * 0.95;
        else smoothedValues[i] += (raw - smoothedValues[i]) * 0.6;

        const val = smoothedValues[i];
        const barHeight = val > 1 ? Math.max(cachedMinBarH, (val / 255 * cachedMaxBarH) | 0) : cachedMinBarH;

        let targetStyle;
        if (val < 2 || barHeight <= cachedMinBarH) targetStyle = PALETTE[0];
        else if (val > 238) targetStyle = PALETTE[8];
        else if (val > 210) targetStyle = PALETTE[7];
        else if (val > 175) targetStyle = PALETTE[6];
        else if (val > 140) targetStyle = PALETTE[5];
        else if (val > 105) targetStyle = PALETTE[4];
        else if (val > 70) targetStyle = PALETTE[3];
        else if (val > 35) targetStyle = PALETTE[2];
        else targetStyle = PALETTE[1];

        if (targetStyle !== currentStyle) {
          currentStyle = targetStyle;
          ctx.fillStyle = currentStyle;
        }
        ctx.fillRect((i * cachedStep) | 0, cachedHeight - barHeight, cachedBarWidth, barHeight);
      }
    }

    if (isLoopRunning) rafId = requestAnimationFrame(renderFrame);
  }

  window.XMVisualizer = {
    start: function(player) { activePlayer = player; wake(player); },
    wake,
    sleep,
    clear,
    clearCanvas: clear,
    reset: clear,
    setThrottled,
    resize: resizeCanvas,
    setVisualizerCache,
    clearVisualizerCache
  };
})(window);