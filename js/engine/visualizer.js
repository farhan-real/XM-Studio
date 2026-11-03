/**
 * js/engine/visualizer.js - Fast frequency spectrum analyzer with idle sleep and DPR throttling.
 */
(function(window) {
  const canvas = document.getElementById('visualizer');
  const ctx = canvas.getContext('2d', { alpha: false });
  const dataArray = new Uint8Array(32);

  let isLoopRunning = false;
  let lastFrameTime = 0;
  const FRAME_INTERVAL = 28; // Capped to ~35fps to save mobile GPU/CPU overhead

  function resizeCanvas() {
    // Cap devicePixelRatio at 1.5 to reduce fill-rate by up to 75% on 3x/4x mobile screens
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.floor(canvas.parentElement.clientWidth * dpr);
    canvas.height = Math.floor(canvas.parentElement.clientHeight * dpr);
    drawIdleBackground();
  }

  function drawIdleBackground() {
    ctx.fillStyle = '#090a0d';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  function render(player, audioEl) {
    const isLive = window.XMAudio ? window.XMAudio.isPlaying() : false;

    if (!isLive) {
      drawIdleBackground();
      isLoopRunning = false;
      return; // Sleep: pause requestAnimationFrame when audio is not playing
    }

    const now = performance.now();
    if (now - lastFrameTime >= FRAME_INTERVAL) {
      lastFrameTime = now;

      drawIdleBackground();

      if (player.analyser) {
        player.analyser.getByteFrequencyData(dataArray);
        const totalBars = 28;
        const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
        const spacing = 3 * dpr;
        const totalSpacing = spacing * (totalBars - 1);
        const barWidth = (canvas.width - totalSpacing) / totalBars;
        let x = 0;

        for (let i = 0; i < totalBars; i++) {
          const val = dataArray[i] / 255;
          const barHeight = Math.max(3 * dpr, val * (canvas.height - 8));

          if (val > 0.82) ctx.fillStyle = '#22c55e';
          else if (val > 0.5) ctx.fillStyle = '#d4d4d8';
          else ctx.fillStyle = '#52525b';

          ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
          x += barWidth + spacing;
        }
      }
    }

    requestAnimationFrame(() => render(player, audioEl));
  }

  function wake(player, audioEl) {
    if (!isLoopRunning) {
      isLoopRunning = true;
      lastFrameTime = performance.now();
      requestAnimationFrame(() => render(player, audioEl));
    }
  }

  window.XMVisualizer = {
    start: function(player, audioEl) {
      wake(player, audioEl);
    },
    wake: wake
  };
})(window);