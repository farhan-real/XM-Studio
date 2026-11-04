/**
 * js/engine/visualizer.js - Adaptive visualizer with full background sleep and zero-overhead audio isolation.
 */
(function(window) {
  const canvas = document.getElementById('visualizer');
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.imageSmoothingEnabled = false;

  const TOTAL_BARS = 28;
  const dataArray = new Uint8Array(64);
  const smoothedValues = new Float32Array(TOTAL_BARS);
  const frameBars = new Uint8Array(TOTAL_BARS);

  const BIN_MAP = new Uint8Array(TOTAL_BARS);
  for (let i = 0; i < TOTAL_BARS; i++) {
    BIN_MAP[i] = Math.min(58, Math.floor(1 + Math.pow(i / (TOTAL_BARS - 1), 1.35) * 54));
  }

  let activePlayer = null;
  let isLoopRunning = false;
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
  let cachedVisFps = 60;

  function isMobileDevice() {
    return ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || (window.innerWidth <= 900);
  }

  function isCanvasVisible() {
    return !document.hidden && canvas.offsetWidth > 0 && canvas.offsetHeight > 0;
  }

  function resizeCanvas() {
    const isMob = isMobileDevice();
    cachedDpr = Math.min(window.devicePixelRatio || 1, isMob ? 1.25 : 1.5);
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

  function drawIdleBackground() {
    ctx.fillStyle = '#090a0d';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  function setVisualizerCache(data, fps) {
    cachedVisData = data ? new Uint8Array(data) : null;
    cachedVisFps = fps || 60;
  }

  function clearVisualizerCache() {
    cachedVisData = null;
  }

  function sleep() {
    isLoopRunning = false;
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  function wake(player) {
    if (player) activePlayer = player;
    if (document.hidden || !isCanvasVisible()) {
      sleep();
      return;
    }
    if (!isLoopRunning && window.XMAudio && window.XMAudio.isPlaying()) {
      isLoopRunning = true;
      lastFrameTime = performance.now();
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(renderFrame);
    }
  }

  resizeCanvas();
  window.addEventListener('resize', resizeCanvas, { passive: true });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      sleep();
    } else if (isCanvasVisible() && window.XMAudio && window.XMAudio.isPlaying()) {
      wake(activePlayer);
    }
  });
  window.addEventListener('pagehide', sleep, { passive: true });

  function renderFrame(now) {
    const isLive = window.XMAudio ? window.XMAudio.isPlaying() : false;
    if (!isLive || document.hidden || !isCanvasVisible()) {
      if (!isLive) {
        smoothedValues.fill(0);
        drawIdleBackground();
      }
      sleep();
      return;
    }

    const targetInterval = isMobileDevice() ? 32 : 16;
    const elapsed = now - lastFrameTime;
    if (elapsed < targetInterval) {
      if (isLoopRunning) rafId = requestAnimationFrame(renderFrame);
      return;
    }

    lastFrameTime = now;

    if (canvas.width === 0 || canvas.height === 0) resizeCanvas();
    drawIdleBackground();

    let hasData = false;
    if (cachedVisData && cachedVisData.length > 0) {
      const pos = window.XMAudio.getPosition();
      const fIdx = Math.floor(pos * cachedVisFps);
      const offset = fIdx * TOTAL_BARS;
      if (offset >= 0 && offset + TOTAL_BARS <= cachedVisData.length) {
        for (let b = 0; b < TOTAL_BARS; b++) frameBars[b] = cachedVisData[offset + b];
        hasData = true;
      }
    }

    if (!hasData && activePlayer && activePlayer.analyser) {
      activePlayer.analyser.getByteFrequencyData(dataArray);
      for (let i = 0; i < TOTAL_BARS; i++) {
        const binIdx = BIN_MAP[i];
        let raw = dataArray[binIdx];
        if (binIdx + 1 < 64 && dataArray[binIdx + 1] > raw) raw = Math.max(raw, dataArray[binIdx + 1]);
        frameBars[i] = raw < 10 ? 0 : raw;
      }
      hasData = true;
    }

    if (hasData && cachedWidth > 0) {
      const timeScale = Math.min(2.5, Math.max(0.5, elapsed / 16.67));
      const riseFactor = Math.min(1, 0.85 * timeScale);
      const decayFactor = Math.min(1, 0.22 * timeScale);

      let currentStyle = '';
      for (let i = 0; i < TOTAL_BARS; i++) {
        const raw = frameBars[i];

        if (raw > smoothedValues[i]) {
          smoothedValues[i] += (raw - smoothedValues[i]) * riseFactor;
        } else {
          smoothedValues[i] += (raw - smoothedValues[i]) * decayFactor;
        }

        const val = smoothedValues[i];
        const barHeight = val > 1
          ? Math.max(cachedMinBarH, Math.round((val / 255) * cachedMaxBarH))
          : cachedMinBarH;

        let targetStyle;
        if (val < 2 || barHeight <= cachedMinBarH) {
          targetStyle = '#1e293b';
        } else if (val > 238) {
          targetStyle = '#f97316';
        } else if (val > 210) {
          targetStyle = '#fde047';
        } else if (val > 175) {
          targetStyle = '#22c55e';
        } else if (val > 140) {
          targetStyle = '#a855f7';
        } else if (val > 105) {
          targetStyle = '#ef4444';
        } else if (val > 70) {
          targetStyle = '#3b82f6';
        } else if (val > 35) {
          targetStyle = '#ec4899';
        } else {
          targetStyle = '#52525b';
        }

        if (targetStyle !== currentStyle) {
          currentStyle = targetStyle;
          ctx.fillStyle = currentStyle;
        }
        ctx.fillRect(Math.round(i * cachedStep), cachedHeight - barHeight, cachedBarWidth, barHeight);
      }
    }

    if (isLoopRunning) rafId = requestAnimationFrame(renderFrame);
  }

  window.XMVisualizer = {
    start: function(player) {
      activePlayer = player;
      wake(player);
    },
    wake,
    sleep,
    resize: resizeCanvas,
    setVisualizerCache,
    clearVisualizerCache
  };
})(window);