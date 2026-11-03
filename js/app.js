/**
 * js/app.js - Main workstation controller, drag-drop ingestion, format target, and transport.
 */
document.addEventListener('DOMContentLoaded', () => {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js').catch(() => {});
  }

  const { player, audioEl } = window.XMAudio;
  window.XMVisualizer.start(player, audioEl);

  let activeFormat = 'mp3';
  let isSeeking = false;
  let prevVolume = 0.85;

  const btnPlayPause = document.getElementById('btnPlayPause');
  const svgPlay = document.getElementById('svgPlay');
  const svgPause = document.getElementById('svgPause');
  const btnStop = document.getElementById('btnStop');
  const btnLoop = document.getElementById('btnLoop');
  const btnShuffle = document.getElementById('btnShuffle');
  const btnDownload = document.getElementById('btnDownload');
  const btnBrowse = document.getElementById('btnBrowse');
  const btnDemo = document.getElementById('btnDemo');
  const fileInput = document.getElementById('fileInput');
  const dropZone = document.getElementById('dropZone');

  const progressBar = document.getElementById('progressBar');
  const timeCurrent = document.getElementById('timeCurrent');
  const timeTotal = document.getElementById('timeTotal');
  const volSlider = document.getElementById('volSlider');
  const volPercent = document.getElementById('volPercent');
  const btnMute = document.getElementById('btnMute');

  const songTitle = document.getElementById('songTitle');
  const songArtist = document.getElementById('songArtist');
  const modType = document.getElementById('modType');
  const badgeEngine = document.querySelector('.badge-engine');
  const channels = document.getElementById('channels');
  const qualityBadge = document.getElementById('qualityBadge');
  const rateBadge = document.getElementById('rateBadge');
  const statusBadge = document.getElementById('statusBadge');
  const btnUnload = document.getElementById('btnUnload');

  const btnFmtMp3 = document.getElementById('btnFmtMp3');
  const btnFmtWav = document.getElementById('btnFmtWav');
  const readoutProgressTrack = document.getElementById('readoutProgressTrack');
  const readoutProgressBar = document.getElementById('readoutProgressBar');

  // Mobile layout switch
  const btnToggleLeft = document.getElementById('btnToggleLeft');
  const btnToggleRight = document.getElementById('btnToggleRight');
  const panelLeft = document.getElementById('panelLeft');
  if (btnToggleLeft && btnToggleRight) {
    btnToggleLeft.addEventListener('click', () => {
      btnToggleLeft.classList.add('active');
      btnToggleRight.classList.remove('active');
      panelLeft.classList.remove('mobile-hide');
      dropZone.classList.add('mobile-hide');
    });
    btnToggleRight.addEventListener('click', () => {
      btnToggleRight.classList.add('active');
      btnToggleLeft.classList.remove('active');
      dropZone.classList.remove('mobile-hide');
      panelLeft.classList.add('mobile-hide');
    });
  }

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

  setInterval(() => {
    if (isSeeking) return;
    if (!window.XMAudio.isNativeStream && player.currentPlayingNode && !player.currentPlayingNode.paused) {
      const cur = player.getPosition();
      const dur = player.duration();
      if (dur > 0) {
        progressBar.value = (cur / dur) * 100;
        timeCurrent.textContent = formatTime(cur);
        timeTotal.textContent = formatTime(dur);
      }
    } else if (window.XMAudio.isNativeStream && !audioEl.paused && audioEl.duration) {
      progressBar.value = (audioEl.currentTime / audioEl.duration) * 100;
      timeCurrent.textContent = formatTime(audioEl.currentTime);
      timeTotal.textContent = formatTime(audioEl.duration);
    }
  }, 100);

  btnPlayPause.addEventListener('click', () => {
    player.unlock();
    if (window.XMAudio.isNativeStream) {
      if (audioEl.paused) audioEl.play().catch(() => {});
      else audioEl.pause();
      setPlayingState(!audioEl.paused);
    } else {
      if (!player.currentPlayingNode && window.XMAudio.currentRawBuffer) {
        player.play(window.XMAudio.currentRawBuffer);
        setPlayingState(true);
      } else if (player.currentPlayingNode) {
        const isPaused = player.togglePause();
        setPlayingState(!isPaused);
      }
    }
  });

  btnStop.addEventListener('click', () => {
    if (window.XMAudio.isNativeStream) {
      audioEl.pause();
      audioEl.currentTime = 0;
    } else {
      player.stop();
    }
    progressBar.value = 0;
    timeCurrent.textContent = "00:00";
    setPlayingState(false);
  });

  btnLoop.addEventListener('click', () => {
    const isLoop = window.XMAudio.toggleLoop();
    btnLoop.classList.toggle('active', isLoop);
  });

  btnShuffle.addEventListener('click', () => {
    const isShuff = window.XMAudio.toggleShuffle();
    btnShuffle.classList.toggle('active', isShuff);
  });

  btnUnload.addEventListener('click', () => {
    player.stop();
    audioEl.pause();
    audioEl.currentTime = 0;
    songTitle.textContent = "No Module Loaded";
    songArtist.textContent = "Ready for FastTracker II / Audio input";
    modType.textContent = "NONE";
    if (badgeEngine) badgeEngine.classList.add('engine-none');
    channels.textContent = "--";
    progressBar.value = 0;
    progressBar.disabled = true;
    timeCurrent.textContent = "00:00";
    timeTotal.textContent = "00:00";
    btnDownload.disabled = true;
    setStatus('idle');
    setPlayingState(false);
    if (window.XMLibrary) window.XMLibrary.notifyPlaying(null);
  });

  progressBar.addEventListener('input', () => { isSeeking = true; });
  progressBar.addEventListener('change', () => {
    const target = progressBar.value / 100;
    if (window.XMAudio.isNativeStream && audioEl.duration) {
      audioEl.currentTime = target * audioEl.duration;
    } else if (!window.XMAudio.isNativeStream) {
      const dur = player.duration();
      if (dur > 0) player.seek(target * dur);
    }
    isSeeking = false;
  });

  volSlider.addEventListener('input', (e) => {
    const v = parseFloat(e.target.value);
    audioEl.volume = v;
    player.setVolume(v);
    volPercent.textContent = `${Math.round(v * 100)}%`;
    if (v > 0) prevVolume = v;
  });

  btnMute.addEventListener('click', () => {
    if (parseFloat(volSlider.value) > 0) {
      prevVolume = parseFloat(volSlider.value) || 0.85;
      audioEl.volume = 0;
      player.setVolume(0);
      volSlider.value = 0;
      volPercent.textContent = '0%';
    } else {
      const r = prevVolume || 0.85;
      audioEl.volume = r;
      player.setVolume(r);
      volSlider.value = r;
      volPercent.textContent = `${Math.round(r * 100)}%`;
    }
  });

  btnFmtMp3.addEventListener('click', () => {
    activeFormat = 'mp3';
    btnFmtMp3.classList.add('active');
    btnFmtWav.classList.remove('active');
    qualityBadge.textContent = "320 KBPS";
  });

  btnFmtWav.addEventListener('click', () => {
    activeFormat = 'wav';
    btnFmtWav.classList.add('active');
    btnFmtMp3.classList.remove('active');
    qualityBadge.textContent = "16-BIT PCM";
  });

  btnDownload.addEventListener('click', () => {
    const raw = window.XMAudio.currentRawBuffer;
    if (!raw) return;
    setStatus('compiling');
    readoutProgressTrack.classList.remove('hide');
    readoutProgressBar.style.width = '0%';

    window.AudioCompiler.compile(
      raw,
      activeFormat,
      (p) => { readoutProgressBar.style.width = `${Math.round(p * 100)}%`; },
      (blob) => {
        readoutProgressTrack.classList.add('hide');
        setStatus('ready');
        const info = window.XMAudio.getCurrentInfo();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${info.artist} - ${info.title}.${activeFormat}`.replace(/[/\\?%*:|"<>]/g, '_');
        a.click();
      },
      () => {
        readoutProgressTrack.classList.add('hide');
        setStatus('ready');
      }
    );
  });

  btnBrowse.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      window.XMAudio.loadTrack(e.target.files[0], e.target.files[0].name);
    }
  });

  btnDemo.addEventListener('click', () => {
    window.XMAudio.loadTrack('https://deskjet.github.io/chiptune2.js/tunes/chipsounds.mod', 'Dubmood - Chipsounds.mod');
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
      window.XMAudio.loadTrack(e.dataTransfer.files[0], e.dataTransfer.files[0].name);
    }
  });

  window.XMApp = {
    updateTrackUI: function(title, artist, engine, channelCount, isNative) {
      songTitle.textContent = title;
      songArtist.textContent = artist;
      modType.textContent = engine;
      if (badgeEngine) badgeEngine.classList.remove('engine-none');
      channels.textContent = channelCount;
      qualityBadge.textContent = isNative ? engine : (activeFormat === 'mp3' ? "320 KBPS" : "16-BIT PCM");
      rateBadge.textContent = "48 KHZ";
      progressBar.disabled = false;
      btnDownload.disabled = isNative;
      setStatus('ready');
      setPlayingState(true);
    },
    onTrackEnded: function() {
      setPlayingState(false);
      progressBar.value = 0;
      timeCurrent.textContent = "00:00";
    }
  };
});