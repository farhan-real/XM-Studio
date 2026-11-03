document.addEventListener('DOMContentLoaded', () => {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js').catch(() => {});
  }

  const player = new ChiptuneJsPlayer();
  const audioEl = document.getElementById('nativeAudio');
  
  let currentRawBuffer = null;
  let currentAudioBlob = null;
  let currentAudioUrl = null;
  let activeFormat = 'mp3';
  let isSeeking = false;
  let activeTitle = "NO MODULE LOADED";
  let isNativeStream = false;

  // Native streaming extensions that bypass OpenMPT
  const NATIVE_STREAM_EXTS = ['.mp3', '.ogg', '.wav'];

  // UI Elements
  const btnPlayPause = document.getElementById('btnPlayPause');
  const svgPlay = document.getElementById('svgPlay');
  const svgPause = document.getElementById('svgPause');
  const btnStop = document.getElementById('btnStop');
  const btnLoop = document.getElementById('btnLoop');
  const btnDownload = document.getElementById('btnDownload');
  const btnBrowse = document.getElementById('btnBrowse');
  const btnDemo = document.getElementById('btnDemo');
  const fileInput = document.getElementById('fileInput');
  const dropZone = document.getElementById('dropZone');
  const progressBar = document.getElementById('progressBar');
  const timeCurrent = document.getElementById('timeCurrent');
  const timeTotal = document.getElementById('timeTotal');
  const volSlider = document.getElementById('volSlider');
  const songTitle = document.getElementById('songTitle');
  const songArtist = document.getElementById('songArtist');
  const modType = document.getElementById('modType');
  const channels = document.getElementById('channels');
  const qualityBadge = document.getElementById('qualityBadge');
  const rateBadge = document.getElementById('rateBadge');
  const btnFmtMp3 = document.getElementById('btnFmtMp3');
  const btnFmtWav = document.getElementById('btnFmtWav');

  // Top Status & Unload Controls
  const statusBadge = document.getElementById('statusBadge');
  const btnUnload = document.getElementById('btnUnload');
  const readoutProgressTrack = document.getElementById('readoutProgressTrack');
  const readoutProgressBar = document.getElementById('readoutProgressBar');

  // Canvas Studio Meter
  const canvas = document.getElementById('visualizer');
  const ctx = canvas.getContext('2d');
  function resizeCanvas() {
    canvas.width = canvas.parentElement.clientWidth * window.devicePixelRatio;
    canvas.height = canvas.parentElement.clientHeight * window.devicePixelRatio;
  }
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  function formatTime(sec) {
    if (!sec || isNaN(sec)) return "00:00";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }

  function setPlayingState(isPlaying) {
    if (isPlaying) {
      svgPlay.classList.add('hide');
      svgPause.classList.remove('hide');
    } else {
      svgPlay.classList.remove('hide');
      svgPause.classList.add('hide');
    }
  }

  // Set Top Status Badge State: idle, compiling, ready
  function setStatus(state) {
    statusBadge.className = 'badge status-badge';
    if (state === 'idle') {
      statusBadge.classList.add('status-idle');
      statusBadge.textContent = 'STATUS: IDLE';
    } else if (state === 'compiling') {
      statusBadge.classList.add('status-compiling');
      statusBadge.textContent = 'STATUS: COMPILING';
    } else if (state === 'ready') {
      statusBadge.classList.add('status-ready');
      statusBadge.textContent = 'STATUS: READY';
    }
  }

  function getFileExtension(filename) {
    const match = filename.toLowerCase().match(/\.[a-z0-9]+$/);
    return match ? match[0] : '';
  }

  // Visualizer Loop
  const dataArray = new Uint8Array(32);
  function renderVisualizer() {
    requestAnimationFrame(renderVisualizer);

    ctx.fillStyle = '#090a0d';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    var isLive = isNativeStream 
      ? (!audioEl.paused) 
      : (player.currentPlayingNode && !player.currentPlayingNode.paused);

    if (isLive) {
      player.analyser.getByteFrequencyData(dataArray);
      const totalBars = 28;
      const spacing = 3 * window.devicePixelRatio;
      const totalSpacing = spacing * (totalBars - 1);
      const barWidth = (canvas.width - totalSpacing) / totalBars;
      let x = 0;

      for (let i = 0; i < totalBars; i++) {
        const val = dataArray[i] / 255;
        const barHeight = Math.max(3 * window.devicePixelRatio, val * (canvas.height - 8));

        if (val > 0.82) {
          ctx.fillStyle = '#f59e0b';
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
  renderVisualizer();

  // Unified Real-Time Scrubber & Timeline Loop
  setInterval(() => {
    if (isSeeking) return;

    if (!isNativeStream && player.currentPlayingNode && !player.currentPlayingNode.paused) {
      const cur = player.getPosition();
      const dur = player.duration();
      if (dur > 0) {
        progressBar.value = (cur / dur) * 100;
        timeCurrent.textContent = formatTime(cur);
        timeTotal.textContent = formatTime(dur);
      }
    } else if (isNativeStream && !audioEl.paused && audioEl.duration) {
      progressBar.value = (audioEl.currentTime / audioEl.duration) * 100;
      timeCurrent.textContent = formatTime(audioEl.currentTime);
      timeTotal.textContent = formatTime(audioEl.duration);
    }
  }, 100);

  // UNLOAD MODULE: Resets player to empty/idle state
  function unloadModule() {
    player.cancelCompilation();
    player.stop();
    audioEl.pause();
    audioEl.currentTime = 0;
    
    if (currentAudioUrl) {
      URL.revokeObjectURL(currentAudioUrl);
      currentAudioUrl = null;
    }
    currentRawBuffer = null;
    currentAudioBlob = null;
    isNativeStream = false;

    songTitle.textContent = "NO MODULE LOADED";
    songArtist.textContent = "Ready for FastTracker II / Audio input";
    modType.textContent = "FT2";
    channels.textContent = "--";

    readoutProgressTrack.classList.add('hide');
    readoutProgressBar.style.width = '0%';
    btnUnload.classList.add('hide');

    progressBar.value = 0;
    progressBar.disabled = true;
    timeCurrent.textContent = "00:00";
    timeTotal.textContent = "00:00";
    btnDownload.disabled = true;

    setStatus('idle');
    setPlayingState(false);

    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = null;
    }
  }

  // LOAD & PLAY IMMEDIATELY
  function loadModule(fileOrUrl, fallbackName) {
    const ext = getFileExtension(fallbackName);
    player.stop();
    audioEl.pause();

    // 1. NATIVE HARDWARE STREAM (.mp3, .ogg, .wav)
    if (NATIVE_STREAM_EXTS.includes(ext)) {
      isNativeStream = true;
      readoutProgressTrack.classList.add('hide');

      if (fileOrUrl instanceof File || fileOrUrl instanceof Blob) {
        if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl);
        currentAudioBlob = fileOrUrl;
        currentAudioUrl = URL.createObjectURL(fileOrUrl);
        audioEl.src = currentAudioUrl;
      } else {
        audioEl.src = fileOrUrl;
      }

      activeTitle = fallbackName.replace(/\.[^/.]+$/, "");
      songTitle.textContent = activeTitle;
      songArtist.textContent = "Direct Hardware Stream";
      modType.textContent = ext.replace('.', '').toUpperCase();
      channels.textContent = "2 CH";
      qualityBadge.textContent = ext.replace('.', '').toUpperCase();
      rateBadge.textContent = "DIRECT";

      progressBar.disabled = false;
      btnDownload.disabled = false;
      btnUnload.classList.remove('hide');
      setStatus('ready');

      audioEl.play().catch(() => {});
      setPlayingState(true);
      return;
    }

    // 2. TRACKER MODULE
    isNativeStream = false;
    btnDownload.disabled = true;

    player.load(fileOrUrl, (buf) => {
      currentRawBuffer = buf;

      const meta = player.readMetadata(buf) || {};
      activeTitle = meta.title || fallbackName || "UNTITLED TRACK";
      const artist = meta.artist || "FastTracker II Module";
      
      songTitle.textContent = activeTitle;
      songArtist.textContent = artist;
      modType.textContent = (meta.type_long || "FT2").toUpperCase();
      channels.textContent = `${meta.channels || 8} CH`;

      qualityBadge.textContent = activeFormat === 'mp3' ? "320 KBPS" : "16-BIT PCM";
      rateBadge.textContent = "48 KHZ";

      // Show top-left unload button and inline progress bar
      btnUnload.classList.remove('hide');
      readoutProgressTrack.classList.remove('hide');
      readoutProgressBar.style.width = '0%';

      // Set top status to COMPILING
      setStatus('compiling');

      // PLAY IMMEDIATELY
      player.play(buf);
      setPlayingState(true);
      progressBar.disabled = false;

      if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: activeTitle,
          artist: artist,
          album: "XM Precision Studio"
        });
      }

      // ASYNCHRONOUS BACKGROUND COMPILATION
      player.compileAudio(
        buf,
        activeFormat,
        (progress) => {
          const pct = Math.round(progress * 100);
          readoutProgressBar.style.width = `${pct}%`;
        },
        (compiledBlob) => {
          if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl);
          currentAudioBlob = compiledBlob;
          currentAudioUrl = URL.createObjectURL(compiledBlob);

          readoutProgressBar.style.width = '100%';
          setTimeout(() => readoutProgressTrack.classList.add('hide'), 500);

          setStatus('ready');
          btnDownload.disabled = false;
        },
        (err) => {
          readoutProgressTrack.classList.add('hide');
          setStatus('idle');
          console.error("Background compilation error:", err);
        }
      );
    });
  }

  // Format Switchers
  btnFmtMp3.addEventListener('click', () => {
    if (activeFormat === 'mp3') return;
    activeFormat = 'mp3';
    btnFmtMp3.classList.add('active');
    btnFmtWav.classList.remove('active');
    qualityBadge.textContent = "320 KBPS";
    if (currentRawBuffer && !isNativeStream) {
      loadModule(currentRawBuffer, activeTitle);
    }
  });

  btnFmtWav.addEventListener('click', () => {
    if (activeFormat === 'wav') return;
    activeFormat = 'wav';
    btnFmtWav.classList.add('active');
    btnFmtMp3.classList.remove('active');
    qualityBadge.textContent = "16-BIT PCM";
    if (currentRawBuffer && !isNativeStream) {
      loadModule(currentRawBuffer, activeTitle);
    }
  });

  // Master Transport Controls
  btnPlayPause.addEventListener('click', () => {
    player.unlock();
    if (isNativeStream) {
      if (audioEl.paused) audioEl.play().catch(() => {});
      else audioEl.pause();
      setPlayingState(!audioEl.paused);
    } else {
      if (!player.currentPlayingNode && currentRawBuffer) {
        player.play(currentRawBuffer);
        setPlayingState(true);
      } else if (player.currentPlayingNode) {
        const isPaused = player.togglePause();
        setPlayingState(!isPaused);
      }
    }
  });

  btnStop.addEventListener('click', () => {
    if (isNativeStream) {
      audioEl.pause();
      audioEl.currentTime = 0;
    } else {
      player.stop();
    }
    progressBar.value = 0;
    timeCurrent.textContent = "00:00";
    setPlayingState(false);
  });

  let isLooping = true;
  btnLoop.addEventListener('click', () => {
    isLooping = !isLooping;
    btnLoop.classList.toggle('active', isLooping);
    audioEl.loop = isLooping;
    player.setRepeat(isLooping);
  });

  btnUnload.addEventListener('click', unloadModule);

  progressBar.addEventListener('input', () => { isSeeking = true; });
  progressBar.addEventListener('change', () => {
    const target = (progressBar.value / 100);
    if (isNativeStream && audioEl.duration) {
      audioEl.currentTime = target * audioEl.duration;
    } else if (!isNativeStream) {
      const dur = player.duration();
      if (dur > 0) player.seek(target * dur);
    }
    isSeeking = false;
  });

  volSlider.addEventListener('input', (e) => {
    const v = parseFloat(e.target.value);
    audioEl.volume = v;
    player.setVolume(v);
  });

  btnDownload.addEventListener('click', () => {
    if (!currentAudioBlob) return;
    const ext = isNativeStream ? getFileExtension(activeTitle) : `.${activeFormat}`;
    const filename = activeTitle.endsWith(ext) ? activeTitle : `${activeTitle}${ext}`;
    const a = document.createElement('a');
    a.href = currentAudioUrl;
    a.download = filename.replace(/[/\\?%*:|"<>]/g, '_');
    a.click();
  });

  btnBrowse.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      loadModule(e.target.files[0], e.target.files[0].name);
    }
  });

  btnDemo.addEventListener('click', () => {
    loadModule('https://deskjet.github.io/chiptune2.js/tunes/chipsounds.mod', 'chipsounds.mod');
  });

  ['dragenter', 'dragover'].forEach(n => dropZone.addEventListener(n, (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  }));
  ['dragleave', 'drop'].forEach(n => dropZone.addEventListener(n, (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
  }));
  dropZone.addEventListener('drop', (e) => {
    if (e.dataTransfer.files.length > 0) {
      loadModule(e.dataTransfer.files[0], e.dataTransfer.files[0].name);
    }
  });

  player.on('onEnded', () => {
    setPlayingState(false);
    progressBar.value = 0;
    timeCurrent.textContent = "00:00";
  });
});