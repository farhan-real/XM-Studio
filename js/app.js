/**
 * js/app.js - Dedicated Player Engine, Hardware Stream Routing & Visualizer
 */
document.addEventListener('DOMContentLoaded', () => {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js').then((reg) => {
      reg.update();
    }).catch(() => {});
  }

  const player = new ChiptuneJsPlayer();
  const audioEl = document.getElementById('nativeAudio');
  
  let currentRawBuffer = null;
  let currentAudioBlob = null;
  let currentAudioUrl = null;
  let activeFormat = 'mp3';
  let isSeeking = false;
  let activeTitle = "No Module Loaded";
  let activeArtist = "";
  let isNativeStream = false;
  let nativeAudioSource = null;
  let prevVolume = 0.85;

  let currentQueue = null;
  let currentQueueIdx = -1;

  const NATIVE_STREAM_EXTS = ['.mp3', '.ogg', '.wav'];

  function routeNativeAudioToWebAudio() {
    if (!nativeAudioSource && player.context) {
      try {
        nativeAudioSource = player.context.createMediaElementSource(audioEl);
        nativeAudioSource.connect(player.gainNode);
      } catch (e) {}
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
  const volPercent = document.getElementById('volPercent');
  const btnMute = document.getElementById('btnMute');
  const songTitle = document.getElementById('songTitle');
  const songArtist = document.getElementById('songArtist');
  const modType = document.getElementById('modType');
  const badgeEngine = document.querySelector('.badge-engine');
  const channels = document.getElementById('channels');
  const qualityBadge = document.getElementById('qualityBadge');
  const rateBadge = document.getElementById('rateBadge');
  const btnFmtMp3 = document.getElementById('btnFmtMp3');
  const btnFmtWav = document.getElementById('btnFmtWav');

  const statusBadge = document.getElementById('statusBadge');
  const btnUnload = document.getElementById('btnUnload');
  const readoutProgressTrack = document.getElementById('readoutProgressTrack');
  const readoutProgressBar = document.getElementById('readoutProgressBar');

  // Mobile View Switcher
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

  function updateVolumeDisplay(val) {
    const pct = Math.round(val * 100);
    volPercent.textContent = `${pct}%`;
    volSlider.value = val;
  }

  function getFileExtension(filename) {
    const match = filename.toLowerCase().match(/\.[a-z0-9]+$/);
    return match ? match[0] : '';
  }

  function normalizeArtist(str) {
    if (!str) return '';
    let s = str.trim();
    s = s.replace(/\s+and\s+/gi, ' & ');
    s = s.replace(/\s+(?:featuring|feat\.?|ft\.?)\s+/gi, ' ft. ');
    s = s.replace(/\s+(?:versus|vs\.?)\s+/gi, ' vs. ');
    s = s.replace(/([^\s&])&/g, '$1 &').replace(/&([^\s&])/g, '& $1');
    s = s.replace(/\s+/g, ' ').trim();
    return s;
  }

  function smartCapitalize(str) {
    if (!str) return '';
    if (str !== str.toLowerCase()) return str;

    const minorWords = ['and', 'or', 'the', 'of', 'in', 'on', 'at', 'to', 'for', 'a', 'an', 'ft.', 'vs.', '&'];
    return str.split(' ').map((word, index) => {
      if (!word) return '';
      const lower = word.toLowerCase();
      if (index > 0 && minorWords.includes(lower)) {
        return lower;
      }
      return word.charAt(0).toUpperCase() + word.slice(1);
    }).join(' ');
  }

  function parseTrackInfo(filename, internalMeta) {
    internalMeta = internalMeta || {};
    let base = filename.replace(/\.[a-z0-9]+$/i, '').trim();

    if (base.includes('_-_')) {
      base = base.replace(/_-_/g, ' - ').replace(/_/g, ' ');
    } else if (!base.includes(' ') && base.includes('_')) {
      base = base.replace(/_/g, ' ');
    }

    let rawArtist = (internalMeta.artist || '').trim();
    let rawTitle = (internalMeta.title || '').trim();

    const match = base.match(/^(.+?)\s+[-–—]\s+(.+)$/);

    if (match) {
      let fileArtist = match[1].trim();
      let fileTitle = match[2].trim();

      const featInTitle = fileTitle.match(/\s*[\(\[\{]?(?:ft\.?|feat\.?|featuring)\s+([^\)\]\}]+)[\)\]\}]?/i);
      if (featInTitle) {
        const featured = featInTitle[1].trim();
        fileTitle = fileTitle.replace(featInTitle[0], '').trim();
        fileArtist = `${fileArtist} ft. ${featured}`;
      }

      if (!rawTitle || fileTitle.toLowerCase().startsWith(rawTitle.toLowerCase())) {
        rawTitle = fileTitle;
      } else {
        rawTitle = fileTitle || rawTitle;
      }

      if (!rawArtist) rawArtist = fileArtist;
    } else {
      const featMatch = base.match(/^(.+?)\s+[\(\[\{]?(?:ft\.?|feat\.?|featuring)\s+([^\)\]\}]+)[\)\]\}]?/i);
      if (featMatch) {
        rawTitle = featMatch[1].trim();
        if (!rawArtist) rawArtist = featMatch[2].trim();
      } else {
        if (!rawTitle) rawTitle = base;
        if (!rawArtist) rawArtist = internalMeta.type_long || "FastTracker II";
      }
    }

    let artist = smartCapitalize(normalizeArtist(rawArtist));
    let title = smartCapitalize(rawTitle.trim());

    return {
      artist: artist || "Unknown Artist",
      title: title || "Untitled Track"
    };
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

        // Phosphor Green Peak with Silver Mids
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
  renderVisualizer();

  // Timeline Scrubber Loop
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

    activeTitle = "No Module Loaded";
    activeArtist = "";

    songTitle.textContent = "No Module Loaded";
    songArtist.textContent = "Ready for FastTracker II / Audio input";
    modType.textContent = "NONE";
    if (badgeEngine) badgeEngine.classList.add('engine-none');
    channels.textContent = "--";

    readoutProgressTrack.classList.add('hide');
    readoutProgressBar.style.width = '0%';

    progressBar.value = 0;
    progressBar.disabled = true;
    timeCurrent.textContent = "00:00";
    timeTotal.textContent = "00:00";
    btnDownload.disabled = true;

    setStatus('idle');
    setPlayingState(false);

    if (window.XMLibrary) window.XMLibrary.notifyPlaying(null);
    if ('mediaSession' in navigator) navigator.mediaSession.metadata = null;
  }

  function playNextTrackInQueue() {
    if (!audioEl.loop && currentQueue && currentQueueIdx >= 0) {
      const nextIdx = currentQueueIdx + 1;
      if (nextIdx < currentQueue.length) {
        const item = currentQueue[nextIdx];
        const url = item.path ? `https://farhan-real.github.io/XM-Music/${item.path}` : (item.url || null);
        loadModule(url, `${item.artist} - ${item.title}.${(item.ext || 'xm').toLowerCase()}`, item, currentQueue, nextIdx);
        return;
      }
    }
    setPlayingState(false);
    progressBar.value = 0;
    timeCurrent.textContent = "00:00";
  }

  function loadModule(fileOrUrl, fallbackName, trackItemRef, queue, queueIdx) {
    const ext = getFileExtension(fallbackName);
    player.stop();
    audioEl.pause();

    currentQueue = queue || null;
    currentQueueIdx = (queueIdx !== undefined) ? queueIdx : -1;

    // 1. Native Stream
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

      const info = parseTrackInfo(fallbackName, {});
      activeTitle = info.title;
      activeArtist = info.artist;

      songTitle.textContent = info.title;
      songArtist.textContent = info.artist;
      modType.textContent = ext.replace('.', '').toUpperCase();
      if (badgeEngine) badgeEngine.classList.remove('engine-none');
      channels.textContent = "2 CH";
      qualityBadge.textContent = ext.replace('.', '').toUpperCase();
      rateBadge.textContent = "DIRECT";

      progressBar.disabled = false;
      btnDownload.disabled = false;
      setStatus('ready');

      if (window.XMLibrary && trackItemRef) {
        window.XMLibrary.notifyPlaying(trackItemRef.id);
      }

      if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: info.title,
          artist: info.artist,
          album: "XM-Studio"
        });
      }

      routeNativeAudioToWebAudio();
      audioEl.play().catch(() => {});
      setPlayingState(true);
      return;
    }

    // 2. Tracker Module
    isNativeStream = false;
    btnDownload.disabled = true;

    player.load(fileOrUrl, (buf) => {
      currentRawBuffer = buf;

      const meta = player.readMetadata(buf) || {};
      const info = parseTrackInfo(fallbackName, meta);

      activeTitle = info.title;
      activeArtist = info.artist;
      
      songTitle.textContent = info.title;
      songArtist.textContent = info.artist;
      modType.textContent = (meta.type_long || "FT2").toUpperCase();
      if (badgeEngine) badgeEngine.classList.remove('engine-none');
      channels.textContent = `${meta.channels || 8} CH`;

      qualityBadge.textContent = activeFormat === 'mp3' ? "320 KBPS" : "16-BIT PCM";
      rateBadge.textContent = "48 KHZ";

      readoutProgressTrack.classList.remove('hide');
      readoutProgressBar.style.width = '0%';
      setStatus('compiling');

      if (window.XMLibrary && trackItemRef) {
        window.XMLibrary.notifyPlaying(trackItemRef.id);
      }

      player.play(buf);
      setPlayingState(true);
      progressBar.disabled = false;

      if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: info.title,
          artist: info.artist,
          album: "XM-Studio"
        });
      }

      // Background compilation + hardware handoff
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

          // Seamless hardware handoff
          if (player.currentPlayingNode) {
            const currentPos = player.getPosition();
            const wasPlaying = !player.currentPlayingNode.paused;

            player.stop();
            routeNativeAudioToWebAudio();
            audioEl.src = currentAudioUrl;
            audioEl.currentTime = currentPos;
            isNativeStream = true;

            if (wasPlaying) {
              audioEl.play().catch(() => {});
              setPlayingState(true);
            }
          }
        },
        (err) => {
          readoutProgressTrack.classList.add('hide');
          setStatus('idle');
          console.error("Compilation error:", err);
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
    if (currentRawBuffer) {
      loadModule(currentRawBuffer, `${activeArtist ? activeArtist + ' - ' : ''}${activeTitle}`);
    }
  });

  btnFmtWav.addEventListener('click', () => {
    if (activeFormat === 'wav') return;
    activeFormat = 'wav';
    btnFmtWav.classList.add('active');
    btnFmtMp3.classList.remove('active');
    qualityBadge.textContent = "16-BIT PCM";
    if (currentRawBuffer) {
      loadModule(currentRawBuffer, `${activeArtist ? activeArtist + ' - ' : ''}${activeTitle}`);
    }
  });

  // Transport Controls
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
    updateVolumeDisplay(v);
    if (v > 0) prevVolume = v;
  });

  btnMute.addEventListener('click', () => {
    if (parseFloat(volSlider.value) > 0) {
      prevVolume = parseFloat(volSlider.value) || 0.85;
      audioEl.volume = 0;
      player.setVolume(0);
      updateVolumeDisplay(0);
    } else {
      const restore = prevVolume || 0.85;
      audioEl.volume = restore;
      player.setVolume(restore);
      updateVolumeDisplay(restore);
    }
  });

  btnDownload.addEventListener('click', () => {
    if (!currentAudioBlob) return;
    const ext = isNativeStream ? getFileExtension(activeTitle) : `.${activeFormat}`;
    const baseName = activeArtist ? `${activeArtist} - ${activeTitle}` : activeTitle;
    const filename = baseName.endsWith(ext) ? baseName : `${baseName}${ext}`;
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
    loadModule('https://deskjet.github.io/chiptune2.js/tunes/chipsounds.mod', 'Dubmood - Chipsounds.mod');
  });

  // Drag and drop
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

  audioEl.addEventListener('ended', playNextTrackInQueue);
  player.on('onEnded', playNextTrackInQueue);

  // Clean API for Left Panel Integration
  window.XMStudio = {
    loadTrackItem: (item, fullUrl, queue, idx) => {
      loadModule(fullUrl, `${item.artist} - ${item.title}.${(item.ext || 'xm').toLowerCase()}`, item, queue, idx);
    },
    getCurrentTrack: () => ({
      title: activeTitle,
      artist: activeArtist
    })
  };
});