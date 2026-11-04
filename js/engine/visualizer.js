/**
 * js/engine/visualizer.js - Zero-allocation frequency spectrum analyzer with visibility & idle sleep.
 */
(function(window) {
  const canvas = document.getElementById('visualizer');
  const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
  const dataArray = new Uint8Array(32);

  let activePlayer = null;
  let isLoopRunning = false;
  let lastFrameTime = 0;
  let cachedDpr = 1;
  const FRAME_INTERVAL = 30;
  const TOTAL_BARS = 28;

  function resizeCanvas() {
    cachedDpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const parent = canvas.parentElement;
    if (!parent) return;
    const w = Math.floor(parent.clientWidth * cachedDpr);
    const h = Math.floor(parent.clientHeight * cachedDpr);
    if (w > 0 && h > 0 && (canvas.width !== w || canvas.height !== h)) {
      canvas.width = w;
      canvas.height = h;
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
      if (!isLive) drawIdleBackground();
      isLoopRunning = false;
      return;
    }

    if (now - lastFrameTime >= FRAME_INTERVAL) {
      lastFrameTime = now;

      if (canvas.width === 0 || canvas.height === 0) resizeCanvas();
      drawIdleBackground();

      if (activePlayer && activePlayer.analyser && canvas.width > 0) {
        activePlayer.analyser.getByteFrequencyData(dataArray);
        const cHeight = canvas.height;
        const maxBarH = cHeight - 8;
        const minBarH = 3 * cachedDpr;
        const spacing = 3 * cachedDpr;
        const barWidth = (canvas.width - spacing * (TOTAL_BARS - 1)) / TOTAL_BARS;
        const step = barWidth + spacing;

        let currentStyle = '';
        for (let i = 0; i < TOTAL_BARS; i++) {
          const raw = dataArray[i];
          const barHeight = Math.max(minBarH, (raw * 0.0039215686) * maxBarH);
          const targetStyle = raw > 209 ? '#22c55e' : (raw > 127 ? '#d4d4d8' : '#52525b');
          if (targetStyle !== currentStyle) {
            currentStyle = targetStyle;
            ctx.fillStyle = currentStyle;
          }
          ctx.fillRect(i * step, cHeight - barHeight, barWidth, barHeight);
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