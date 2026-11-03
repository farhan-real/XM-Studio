/**
 * js/engine/visualizer.js - Fast frequency spectrum analyzer render loop.
 */
(function(window) {
  var canvas = document.getElementById('visualizer');
  var ctx = canvas.getContext('2d');
  var dataArray = new Uint8Array(32);

  function resizeCanvas() {
    canvas.width = canvas.parentElement.clientWidth * window.devicePixelRatio;
    canvas.height = canvas.parentElement.clientHeight * window.devicePixelRatio;
  }
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  function render(player, audioEl, isNativeStream) {
    requestAnimationFrame(function() {
      render(player, audioEl, window.XMAudio ? window.XMAudio.isNativeStream : isNativeStream);
    });

    ctx.fillStyle = '#090a0d';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    var isLive = false;
    if (window.XMAudio) {
      isLive = window.XMAudio.isPlaying();
    }

    if (isLive && player.analyser) {
      player.analyser.getByteFrequencyData(dataArray);
      var totalBars = 28;
      var spacing = 3 * window.devicePixelRatio;
      var totalSpacing = spacing * (totalBars - 1);
      var barWidth = (canvas.width - totalSpacing) / totalBars;
      var x = 0;

      for (var i = 0; i < totalBars; i++) {
        var val = dataArray[i] / 255;
        var barHeight = Math.max(3 * window.devicePixelRatio, val * (canvas.height - 8));

        if (val > 0.82) {
          ctx.fillStyle = '#22c55e';
        } else if (val > 0.5) {
          ctx.fillStyle = '#d4d4d8';
        } else {
          ctx.fillStyle = '#52525b';
        }

        ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
        x += barWidth + spacing;
      }
    }
  }

  window.XMVisualizer = {
    start: function(player, audioEl) {
      render(player, audioEl, false);
    }
  };
})(window);