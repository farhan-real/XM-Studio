/**
 * js/engine/visualizer.js - High-refresh native VSync visualizer with anti-flicker temporal smoothing.
 */
(function(window) {
  const canvas = document.getElementById('visualizer');
  // Avoid desynchronized: true to eliminate canvas presentation tearing and black-flash flickering
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.imageSmoothingEnabled = false;

  const dataArray = new Uint8Array(64);
  const TOTAL_BARS = 28;
  const smoothedValues = new Float32Array(TOTAL_BARS);

  let activePlayer = null;
  let isLoopRunning = false;
  let lastFrameTime = 0;
  let cachedDpr = 1;

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

    // High-refresh rate: allows full 60Hz, 90Hz, 120Hz, and 144Hz displays with frame pacing (>= 6ms)
    const delta = now - lastFrameTime;
    if (delta >= 6) {
      lastFrameTime = now;

      if (canvas.width === 0 || canvas.height === 0) resizeCanvas();
      drawIdleBackground();

      if (activePlayer && activePlayer.analyser && canvas.width > 0) {
        activePlayer.analyser.getByteFrequencyData(dataArray);
        const cHeight = canvas.height;
        const maxBarH = cHeight - (8 * cachedDpr);
        const minBarH = Math.max(2, Math.round(2 * cachedDpr));
        const spacing = Math.max(1, Math.round(3 * cachedDpr));
        const totalSpacing = spacing * (TOTAL_BARS - 1);
        const barWidth = Math.max(1, Math.floor((canvas.width - totalSpacing) / TOTAL_BARS));
        const step = barWidth + spacing;

        // Frame-rate independent scaling (normalized to standard 60Hz / 16.67ms baseline)
        const timeScale = Math.min(2.5, Math.max(0.2, delta / 16.67));
        const riseFactor = Math.min(1, 0.72 * timeScale);
        const decayFactor = Math.min(1, 0.18 * timeScale);

        let currentStyle = '';
        for (let i = 0; i < TOTAL_BARS; i++) {
          // Perceptually map 28 bars across bins 1 to 58, skipping Bin 0 (0 Hz DC offset)
          const binIdx = Math.min(58, Math.floor(1 + Math.pow(i / (TOTAL_BARS - 1), 1.35) * 54));
          let raw = dataArray[binIdx];
          if (binIdx + 1 < 64 && dataArray[binIdx + 1] > raw) {
            raw = Math.max(raw, dataArray[binIdx + 1]);
          }

          // Noise gate to suppress sub-audible digital noise
          if (raw < 10) raw = 0;

          // Anti-flicker temporal smoothing: instant attack with exponential analog decay
          if (raw > smoothedValues[i]) {
            smoothedValues[i] += (raw - smoothedValues[i]) * riseFactor;
          } else {
            smoothedValues[i] += (raw - smoothedValues[i]) * decayFactor;
          }

          const val = smoothedValues[i];
          const barHeight = val > 1
            ? Math.max(minBarH, Math.round((val / 255) * maxBarH))
            : minBarH;

          // Multi-tier spectrum color hierarchy:
          // Resting floor: dark slate tick (prevents idle/tiny bars from lighting up)
          // Peak overload (> 238): flame orange
          // Ultra high (> 210): bright electric yellow
          // High tier (> 175): vibrant phosphor green
          // High-mid tier (> 140): neon purple
          // Mid tier (> 105): vivid red
          // Low-mid tier (> 70): electric blue
          // Subtle low tier (> 35): neon pink
          // Baseline (> 0): muted zinc gray
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
    wake: wake,
    resize: resizeCanvas
  };
})(window);