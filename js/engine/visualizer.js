/**
 * js/engine/visualizer.js - Ultra-high refresh rate VSync visualizer with precomputed visualizer caching.
 */
(function(window) {
  const canvas = document.getElementById('visualizer');
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.imageSmoothingEnabled = false;

  const TOTAL_BARS = 28;
  const dataArray = new Uint8Array(64);
  const smoothedValues = new Float32Array(TOTAL_BARS);
  const frameBars = new Uint8Array(TOTAL_BARS);

  let activePlayer = null;
  let isLoopRunning = false;
  let lastFrameTime = 0;
  let cachedDpr = 1;

  // Cached visualizer spectrum data for compiled tracks (0% CPU, zero FFT overhead)
  let cachedVisData = null;
  let cachedVisFps = 60;

  function resizeCanvas() {
    cachedDpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const parent = canvas.parentElement;
    if (!parent) return;
    const w = Math.floor(parent.clientWidth * cachedDpr);
    const h = Math.floor(parent.clientHeight * cachedDpr);
    if (w > 0 && h > 0 && (canvas.width !== w || canvas.height !== h)) {
      canvas.width = w;
      canvas.height = h;
      ctx.imageSmoothingEnabled = false;
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

  resizeCanvas();
  window.addEventListener('resize', resizeCanvas, { passive: true });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && window.XMAudio && window.XMAudio.isPlaying()) {
      wake(activePlayer);
    }
  });

  function renderFrame(now) {
    const isLive = window.XMAudio ? window.XMAudio.isPlaying() : false;
    if (!isLive || document.hidden) {
      if (!isLive) {
        smoothedValues.fill(0);
        drawIdleBackground();
      }
      isLoopRunning = false;
      return;
    }

    // Uncapped native VSync refresh rate (60Hz, 90Hz, 120Hz, 144Hz+)
    const delta = Math.min(60, Math.max(1, now - lastFrameTime || 16.67));
    lastFrameTime = now;

    if (canvas.width === 0 || canvas.height === 0) resizeCanvas();
    drawIdleBackground();

    const cHeight = canvas.height;
    const maxBarH = cHeight - (8 * cachedDpr);
    const minBarH = Math.max(2, Math.round(2 * cachedDpr));
    const spacing = Math.max(1, Math.round(3 * cachedDpr));
    const totalSpacing = spacing * (TOTAL_BARS - 1);
    const barWidth = Math.max(1, Math.floor((canvas.width - totalSpacing) / TOTAL_BARS));
    const step = barWidth + spacing;

    // Retrieve spectrum values: Instant O(1) cached lookup if compiled, or live WebAudio FFT
    let hasData = false;
    if (cachedVisData && cachedVisData.length > 0) {
      const pos = window.XMAudio ? window.XMAudio.getPosition() : 0;
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
        const binIdx = Math.min(58, Math.floor(1 + Math.pow(i / (TOTAL_BARS - 1), 1.35) * 54));
        let raw = dataArray[binIdx];
        if (binIdx + 1 < 64 && dataArray[binIdx + 1] > raw) raw = Math.max(raw, dataArray[binIdx + 1]);
        frameBars[i] = raw < 10 ? 0 : raw;
      }
      hasData = true;
    }

    if (hasData && canvas.width > 0) {
      const timeScale = delta / 16.67;
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
        const barHeight = val > 1 ? Math.max(minBarH, Math.round((val / 255) * maxBarH)) : minBarH;

        let targetStyle;
        if (val < 2 || barHeight <= minBarH) {
          targetStyle = '#1e293b';
        } else if (val > 238) {
          targetStyle = '#f97316'; // Flame Orange
        } else if (val > 210) {
          targetStyle = '#fde047'; // Bright Yellow
        } else if (val > 175) {
          targetStyle = '#22c55e'; // Green
        } else if (val > 140) {
          targetStyle = '#a855f7'; // Purple
        } else if (val > 105) {
          targetStyle = '#ef4444'; // Red
        } else if (val > 70) {
          targetStyle = '#3b82f6'; // Blue
        } else if (val > 35) {
          targetStyle = '#ec4899'; // Pink
        } else {
          targetStyle = '#52525b'; // Slate Gray
        }

        if (targetStyle !== currentStyle) {
          currentStyle = targetStyle;
          ctx.fillStyle = currentStyle;
        }
        ctx.fillRect(Math.round(i * step), cHeight - barHeight, barWidth, barHeight);
      }
    }

    requestAnimationFrame(renderFrame);
  }

  function wake(player) {
    if (player) activePlayer = player;
    if (!isLoopRunning && !document.hidden) {
      isLoopRunning = true;
      lastFrameTime = performance.now();
      requestAnimationFrame(renderFrame);
    }
  }

  window.XMVisualizer = {
    start: function(player) {
      activePlayer = player;
      wake(player);
    },
    wake,
    resize: resizeCanvas,
    setVisualizerCache,
    clearVisualizerCache
  };
})(window);