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

  // Native streaming extensions that bypass OpenMPT compilation
  const NATIVE_STREAM_EXTS = ['.mp3', '.ogg', '.wav'];

  // WebAudio Graph for Spectrum Analyzer
  let audioCtx = null;
  let analyser = null;
  let sourceNode = null;

  function initVisualizerRouting() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      analyser.smoothingTimeConstant = 0.82;
      sourceNode = audioCtx.createMediaElementSource(audioEl);
      sourceNode.connect(analyser);
      analyser.connect(audioCtx.destination);
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
  }

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

  const compilerOverlay = document.getElementById('compilerOverlay');
  const compilerProgressBar = document.getElementById('compilerProgressBar');
  const compilerStatus = document.getElementById('compilerStatus');

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

  function getFileExtension(filename) {
    const match = filename.toLowerCase().match(/\.[a-z0-9]+$/);
    return match ? match[0] : '';
  }

  // Compiler Execution
  function processAudioBuffer(buffer, fallbackName) {
    currentRawBuffer = buffer;
    compilerOverlay.classList.add('active');
    compilerProgressBar.style.width = '0%';
    compilerStatus.textContent = activeFormat === 'mp3' 
      ? 'DSP RENDERING 320 KBPS' 
      : 'DSP RENDERING 16-BIT WAV';

    player.compileAudio(
      buffer,
      activeFormat,
      (progress) => {
        compilerProgressBar.style.width = `${Math.round(progress * 100)}%`;
        compilerStatus.textContent = `DSP RENDERING ${Math.round(progress * 100)}%`;
      },
      (audioBlob, duration, meta) => {
        compilerOverlay.classList.remove('active');
        if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl);

        currentAudioBlob = audioBlob;
        currentAudioUrl = URL.createObjectURL(audioBlob);
        audioEl.src = currentAudioUrl;

        activeTitle = meta.title || fallbackName || "UNTITLED MODULE";
        songTitle.textContent = activeTitle;
        songArtist.textContent = meta.artist || "FastTracker II Module";
        modType.textContent = (meta.type_long || "FT2").toUpperCase();
        channels.textContent = `${meta.channels || 8} CH`;

        if (activeFormat === 'mp3') {
          qualityBadge.textContent = "320 KBPS";
          rateBadge.textContent = "48 KHZ";
        } else {
          qualityBadge.textContent = "16-BIT PCM";
          rateBadge.textContent = "48 KHZ";
        }

        progressBar.disabled = false;
        btnDownload.disabled = false;

        if ('mediaSession' in navigator) {
          navigator.mediaSession.metadata = new MediaMetadata({
            title: activeTitle,
            artist: meta.artist || "FastTracker II",
            album: "XM Precision Studio"
          });
          navigator.mediaSession.setActionHandler('play', () => audioEl.play());
          navigator.mediaSession.setActionHandler('pause', () => audioEl.pause());
          navigator.mediaSession.setActionHandler('stop', () => { audioEl.pause(); audioEl.currentTime = 0; });
        }

        initVisualizerRouting();
        audioEl.play().catch(() => {});
        setPlayingState(true);
      },
      (err) => {
        compilerOverlay.classList.remove('active');
        alert("Audio parsing error: " + err.message);
      }
    );
  }

  function loadModule(fileOrUrl, fallbackName) {
    const ext = getFileExtension(fallbackName);

    // 1. DIRECT HARDWARE STREAM (MP3, OGG, WAV)
    if (NATIVE_STREAM_EXTS.includes(ext)) {
      compilerOverlay.classList.remove('active');
      
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
      songArtist.textContent = "Direct Stream";
      modType.textContent = ext.replace('.', '').toUpperCase();
      channels.textContent = "2 CH";
      qualityBadge.textContent = ext.replace('.', '').toUpperCase();
      rateBadge.textContent = "DIRECT";

      progressBar.disabled = false;
      btnDownload.disabled = false;

      initVisualizerRouting();
      audioEl.play().catch(() => {});
      setPlayingState(true);
      return;
    }

    // 2. TRACKER COMPILER (XM, MOD, IT, S3M, etc.)
    compilerOverlay.classList.add('active');
    compilerProgressBar.style.width = '0%';
    compilerStatus.textContent = 'BUFFERING MODULE';
    player.load(fileOrUrl, (buf) => processAudioBuffer(buf, fallbackName));
  }

  // Format Selection
  btnFmtMp3.addEventListener('click', () => {
    if (activeFormat === 'mp3') return;
    activeFormat = 'mp3';
    btnFmtMp3.classList.add('active');
    btnFmtWav.classList.remove('active');
    if (currentRawBuffer) processAudioBuffer(currentRawBuffer, activeTitle);
  });

  btnFmtWav.addEventListener('click', () => {
    if (activeFormat === 'wav') return;
    activeFormat = 'wav';
    btnFmtWav.classList.add('active');
    btnFmtMp3.classList.remove('active');
    if (currentRawBuffer) processAudioBuffer(currentRawBuffer, activeTitle);
  });

  // Spectrum Analyzer Render Loop (Monochrome Slate with Studio Amber Accents)
  const dataArray = new Uint8Array(32);
  function renderVisualizer() {
    requestAnimationFrame(renderVisualizer);

    ctx.fillStyle = '#090a0d';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (analyser && !audioEl.paused) {
      analyser.getByteFrequencyData(dataArray);
      const totalBars = 28;
      const spacing = 3 * window.devicePixelRatio;
      const totalSpacing = spacing * (totalBars - 1);
      const barWidth = (canvas.width - totalSpacing) / totalBars;
      let x = 0;

      for (let i = 0; i < totalBars; i++) {
        const val = dataArray[i] / 255;
        const barHeight = Math.max(3 * window.devicePixelRatio, val * (canvas.height - 8));

        // Slate to Amber color grading
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

  // Audio Events
  audioEl.addEventListener('timeupdate', () => {
    if (!isSeeking && audioEl.duration) {
      progressBar.value = (audioEl.currentTime / audioEl.duration) * 100;
      timeCurrent.textContent = formatTime(audioEl.currentTime);
      timeTotal.textContent = formatTime(audioEl.duration);
    }
  });

  audioEl.addEventListener('play', () => setPlayingState(true));
  audioEl.addEventListener('pause', () => setPlayingState(false));
  audioEl.addEventListener('ended', () => {
    if (!audioEl.loop) {
      setPlayingState(false);
      progressBar.value = 0;
      timeCurrent.textContent = "00:00";
    }
  });

  // Transport Controls
  btnPlayPause.addEventListener('click', () => {
    initVisualizerRouting();
    if (audioEl.paused) {
      audioEl.play().catch(() => {});
    } else {
      audioEl.pause();
    }
  });

  btnStop.addEventListener('click', () => {
    audioEl.pause();
    audioEl.currentTime = 0;
    progressBar.value = 0;
    timeCurrent.textContent = "00:00";
    setPlayingState(false);
  });

  audioEl.loop = true;
  btnLoop.addEventListener('click', () => {
    audioEl.loop = !audioEl.loop;
    btnLoop.classList.toggle('active', audioEl.loop);
  });

  progressBar.addEventListener('input', () => { isSeeking = true; });
  progressBar.addEventListener('change', () => {
    if (audioEl.duration) {
      audioEl.currentTime = (progressBar.value / 100) * audioEl.duration;
    }
    isSeeking = false;
  });

  volSlider.addEventListener('input', (e) => {
    audioEl.volume = parseFloat(e.target.value);
  });

  btnDownload.addEventListener('click', () => {
    if (!currentAudioBlob) return;
    const ext = getFileExtension(activeTitle) || `.${activeFormat}`;
    const filename = activeTitle.endsWith(ext) ? activeTitle : `${activeTitle}.${activeFormat}`;
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
});