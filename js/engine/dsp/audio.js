/**
 * js/engine/dsp/audio.js - Master playback coordinator with visualizer pre-caching and seamless native handoff.
 */
(function(window) {
  const player = new ChiptuneJsPlayer();
  const audioEl = document.getElementById('nativeAudio');
  const compiledCache = new Map();

  let currentRawBuffer = null;
  let currentAudioBlob = null;
  let currentAudioSrc = '';
  let activeObjectUrl = null;
  let currentExt = 'xm';
  let isNativeStream = false;
  let nativeAudioSource = null;
  let activeTitle = 'No Module Loaded';
  let activeArtist = '';
  let activeDuration = 0;
  let currentTrackItem = null;
  let currentLoadId = 0;

  const NATIVE_STREAM_EXTS = new Set(['.mp3', '.ogg', '.wav', '.flac', '.aac', '.m4a', '.weba']);
  const SUPPORTED_EXTS = new Set([
    'xm', 'mod', 'it', 's3m', 'mtm', 'mo3', 'med', '669', 'far', 'ptm',
    'amf', 'ams', 'dbm', 'digi', 'dmf', 'dsm', 'dtm', 'gdm', 'imf', 'j2b',
    'mptm', 'okt', 'plm', 'psm', 'sfx', 'stm', 'ult', 'umx', 'mdl', 'stp',
    'v2m', 'ahx', 'sid', 'mid', 'midi',
    'mp3', 'ogg', 'wav', 'flac', 'aac', 'm4a', 'weba'
  ]);

  function unlockOnGesture() {
    if (player && player.unlock) player.unlock();
    document.removeEventListener('touchstart', unlockOnGesture);
    document.removeEventListener('click', unlockOnGesture);
  }
  document.addEventListener('touchstart', unlockOnGesture, { passive: true, once: true });
  document.addEventListener('click', unlockOnGesture, { passive: true, once: true });

  function revokeActiveObjectUrl() {
    if (activeObjectUrl) {
      URL.revokeObjectURL(activeObjectUrl);
      activeObjectUrl = null;
    }
  }

  function connectNativeSource() {
    if (!player.context) return;
    if (!nativeAudioSource) {
      try { nativeAudioSource = player.context.createMediaElementSource(audioEl); } catch (e) {}
    }
    if (nativeAudioSource) {
      try { nativeAudioSource.disconnect(); } catch (e) {}
      nativeAudioSource.connect(player.gainNode);
    }
  }

  function updateDocumentTitle(playing) {
    if (playing && activeTitle && activeTitle !== 'No Module Loaded') {
      document.title = `▶ ${activeTitle}${activeArtist ? ` - ${activeArtist}` : ''}`;
    } else if (activeTitle && activeTitle !== 'No Module Loaded') {
      document.title = `${activeTitle}${activeArtist ? ` - ${activeArtist}` : ''} | XM-Studio`;
    } else {
      document.title = 'XM-Studio';
    }
  }

  function parseTrackInfo(filename, internalMeta) {
    internalMeta = internalMeta || {};
    let base = (filename || '').replace(/\.[a-z0-9]+$/i, '').trim();
    if (base.includes('_-_')) base = base.replace(/_-_/g, ' - ').replace(/_/g, ' ');
    else if (!base.includes(' ') && base.includes('_')) base = base.replace(/_/g, ' ');
    const match = base.match(/^(.+?)\s+[-–—]\s+(.+)$/);
    return {
      title: (match ? match[2].trim() : (internalMeta.title || '').trim()) || base || 'Untitled Track',
      artist: (match ? match[1].trim() : (internalMeta.artist || '').trim()) || (internalMeta.type_long || 'FastTracker II')
    };
  }

  function getDuration() {
    if (isNativeStream) {
      const d = audioEl.duration;
      if (d && !isNaN(d) && isFinite(d) && d > 0) return d;
      return activeDuration > 0 ? activeDuration : 0;
    }
    const d = player.duration ? player.duration() : 0;
    return d > 0 ? d : (activeDuration > 0 ? activeDuration : 0);
  }

  function getPosition() {
    if (isNativeStream) {
      const ct = audioEl.currentTime;
      return (ct && !isNaN(ct) && isFinite(ct)) ? Math.max(0, ct) : 0;
    }
    const p = player.getPosition ? player.getPosition() : 0;
    return (isFinite(p) && p >= 0) ? p : 0;
  }

  function isPlaying() {
    return isNativeStream ? !audioEl.paused : Boolean(player.currentPlayingNode && !player.currentPlayingNode.paused);
  }

  function notifyPlayState(playing) {
    if (window.XMApp && window.XMApp.setPlayingState) window.XMApp.setPlayingState(playing);
    if (window.XMBackground && window.XMBackground.setPlaybackState) window.XMBackground.setPlaybackState(playing);
    updateDocumentTitle(playing);
  }

  function safeSeekAudio(element, time) {
    if (!isFinite(time) || time < 0) return;
    try {
      if (element.seekable && element.seekable.length > 0) {
        element.currentTime = Math.max(0, Math.min(time, element.seekable.end(element.seekable.length - 1)));
      } else if (isFinite(element.duration) && element.duration > 0) {
        element.currentTime = Math.min(time, element.duration);
      } else {
        element.currentTime = time;
      }
    } catch (err) {}
  }

  function setPaused(wantPaused) {
    player.unlock();
    if (wantPaused) {
      audioEl.pause();
      if (!isNativeStream && player.currentPlayingNode && !player.currentPlayingNode.paused) player.togglePause();
      notifyPlayState(false);
    } else {
      if (isNativeStream) {
        audioEl.play().then(() => notifyPlayState(true)).catch(() => {
          if (currentRawBuffer) {
            isNativeStream = false;
            player.play(currentRawBuffer);
            notifyPlayState(true);
            if (window.XMApp && window.XMApp.setPlaybackStatus) window.XMApp.setPlaybackStatus('live');
          } else {
            notifyPlayState(false);
          }
        });
      } else {
        if (!player.currentPlayingNode && currentRawBuffer) player.play(currentRawBuffer);
        else if (player.currentPlayingNode && player.currentPlayingNode.paused) player.togglePause();
        audioEl.play().then(() => notifyPlayState(true)).catch(() => notifyPlayState(true));
      }
    }
  }

  function togglePlayPause() { setPaused(isPlaying()); }

  function stopPlayback() {
    audioEl.pause();
    try { audioEl.currentTime = 0; } catch (e) {}
    player.stop();
    notifyPlayState(false);
    if (window.XMVisualizer) {
      if (typeof window.XMVisualizer.clear === 'function') window.XMVisualizer.clear();
      else if (typeof window.XMVisualizer.clearCanvas === 'function') window.XMVisualizer.clearCanvas();
    }
    if (window.XMApp && window.XMApp.onTrackEnded) window.XMApp.onTrackEnded();
  }

  function seekTo(targetSec) {
    const s = Math.max(0, Number(targetSec) || 0);
    if (isNativeStream) safeSeekAudio(audioEl, s);
    else { player.seek(s); safeSeekAudio(audioEl, s); }
    if (window.XMBackground && window.XMBackground.updatePositionState) window.XMBackground.updatePositionState();
  }

  function handleUnsupported(title, ext, filename) {
    unload();
    const displayExt = (ext || 'FILE').toUpperCase();
    if (window.XMApp) {
      window.XMApp.updateTrackUI(
        `${title || filename || 'Unknown'} (Unsupported)`,
        `Format .${displayExt} is not supported by workstation`,
        'UNSUPPORTED',
        '--',
        false,
        0
      );
    }
  }

  function unload() {
    currentLoadId++;
    try {
      if (window.AudioCompiler && window.AudioCompiler.cancel) window.AudioCompiler.cancel();
      if (window.XMExport && window.XMExport.cancelExport) window.XMExport.cancelExport();
      player.stop();
      audioEl.pause();
      try { audioEl.currentTime = 0; } catch (e) {}
      audioEl.removeAttribute('src');
      audioEl.load();
      if (window.XMBackground) {
        if (window.XMBackground.releaseCarrier) window.XMBackground.releaseCarrier();
        if (window.XMBackground.clearMetadata) window.XMBackground.clearMetadata();
      }
      if (window.XMVisualizer) {
        if (typeof window.XMVisualizer.clearVisualizerCache === 'function') window.XMVisualizer.clearVisualizerCache();
        if (typeof window.XMVisualizer.clear === 'function') window.XMVisualizer.clear();
        else if (typeof window.XMVisualizer.clearCanvas === 'function') window.XMVisualizer.clearCanvas();
        else if (typeof window.XMVisualizer.sleep === 'function') window.XMVisualizer.sleep();
      }
    } catch (err) {
      console.warn('Error during unload:', err);
    } finally {
      revokeActiveObjectUrl();
      isNativeStream = false;
      currentRawBuffer = null;
      currentAudioBlob = null;
      currentAudioSrc = '';
      currentTrackItem = null;
      activeTitle = 'No Module Loaded';
      activeArtist = '';
      activeDuration = 0;
      if (window.XMQueue && window.XMQueue.setQueue) window.XMQueue.setQueue(null, -1);
      notifyPlayState(false);
    }
  }

  function getCachedCompiled(trackId, format) {
    if (window.XMCache) {
      const res = window.XMCache.get(trackId, format);
      if (res) return res;
    }
    return compiledCache.get(`${trackId}_${(format || 'mp3').toLowerCase()}`) || null;
  }

  function setCachedCompiled(trackId, format, blob, visData, visFps, duration) {
    const fmt = (format || 'mp3').toLowerCase();
    if (window.XMCache) window.XMCache.set(trackId, fmt, blob, visData, visFps, duration);
    compiledCache.set(`${trackId}_${fmt}`, { blob, ext: fmt, visData, visFps, duration });
  }

  function handoffToCompiled(blob, format, targetTrackId, visData, visFps, duration) {
    if (!blob) return;
    const currentId = (currentTrackItem && currentTrackItem.id) || currentAudioSrc || activeTitle;
    const targetExt = (format || 'mp3').toLowerCase();

    if (typeof duration === 'number' && duration > 0) {
      activeDuration = duration;
    } else if (!activeDuration && visData) {
      activeDuration = Math.round((visData.byteLength || visData.length) / 28 / (visFps || 15));
    }

    setCachedCompiled(targetTrackId || currentId, targetExt, blob, visData, visFps, activeDuration);
    if (targetTrackId && targetTrackId !== currentId) return;

    currentAudioBlob = blob;
    currentExt = targetExt;
    if (visData && window.XMVisualizer && window.XMVisualizer.setVisualizerCache) {
      window.XMVisualizer.setVisualizerCache(visData, visFps);
    }

    const wasPlaying = isPlaying();
    const curPos = getPosition();
    revokeActiveObjectUrl();
    activeObjectUrl = URL.createObjectURL(blob);

    audioEl.pause();
    audioEl.src = activeObjectUrl;
    audioEl.loop = window.XMQueue ? window.XMQueue.isLooping : true;
    connectNativeSource();
    audioEl.load();

    const onHandoffReady = () => {
      const livePos = (player.currentPlayingNode && !player.currentPlayingNode.paused) ? player.getPosition() : curPos;
      if (wasPlaying) {
        audioEl.play().then(() => {
          isNativeStream = true;
          safeSeekAudio(audioEl, livePos);
          player.stop();
          notifyPlayState(true);
          if (window.XMApp && window.XMApp.setPlaybackStatus) window.XMApp.setPlaybackStatus('loaded');
          if (window.XMBackground) {
            window.XMBackground.updateMetadata(activeTitle, activeArtist);
            window.XMBackground.updatePositionState();
          }
          if (window.XMApp && activeDuration > 0) window.XMApp.updateDuration(activeDuration);
        }).catch(() => notifyPlayState(true));
      } else {
        isNativeStream = true;
        player.stop();
        safeSeekAudio(audioEl, curPos);
        notifyPlayState(false);
        if (window.XMApp && window.XMApp.setPlaybackStatus) window.XMApp.setPlaybackStatus('loaded');
        if (window.XMApp && activeDuration > 0) window.XMApp.updateDuration(activeDuration);
      }
      const trackNum = window.XMQueue ? window.XMQueue.getTrackNum() : 1;
      if (window.XMApp && window.XMApp.updateTrackUI) {
        window.XMApp.updateTrackUI(activeTitle, activeArtist, currentExt.toUpperCase(), '2CH', true, trackNum);
      }
    };

    if (audioEl.readyState >= 2) onHandoffReady();
    else audioEl.addEventListener('canplay', onHandoffReady, { once: true });
  }

  function loadTrack(fileOrUrl, fallbackName, trackItemRef, queue, queueIdx) {
    const loadId = ++currentLoadId;
    const extMatch = (fallbackName || '').toLowerCase().match(/\.[a-z0-9]+$/);
    currentExt = extMatch ? extMatch[0].replace('.', '').toLowerCase() : '';

    let targetTitle = (trackItemRef && trackItemRef.title) ? trackItemRef.title.trim() : '';
    let targetArtist = (trackItemRef && trackItemRef.artist) ? trackItemRef.artist.trim() : '';
    if (!targetTitle) {
      const parsed = parseTrackInfo(fallbackName, {});
      targetTitle = parsed.title;
      targetArtist = targetArtist || parsed.artist;
    }

    if (!currentExt || !SUPPORTED_EXTS.has(currentExt)) {
      handleUnsupported(targetTitle, currentExt, fallbackName);
      return;
    }

    player.unlock();
    player.stop();
    audioEl.pause();
    try { audioEl.currentTime = 0; } catch (e) {}
    audioEl.removeAttribute('src');
    audioEl.load();
    isNativeStream = false;
    revokeActiveObjectUrl();

    activeTitle = targetTitle;
    activeArtist = targetArtist;
    activeDuration = 0;
    currentRawBuffer = null;
    currentAudioBlob = null;
    currentAudioSrc = (typeof fileOrUrl === 'string') ? fileOrUrl : '';
    currentTrackItem = trackItemRef || null;
    if (window.XMQueue) window.XMQueue.setQueue(queue, queueIdx);

    const trackNum = window.XMQueue ? window.XMQueue.getTrackNum() : 1;
    if (window.XMVisualizer && window.XMVisualizer.clearVisualizerCache) window.XMVisualizer.clearVisualizerCache();
    if (window.XMLibrary && trackItemRef) window.XMLibrary.notifyPlaying(trackItemRef.id);
    if (window.XMApp) {
      window.XMApp.resetTimeline();
      window.XMApp.updateTrackUI(targetTitle, targetArtist, currentExt.toUpperCase() || 'AUDIO', '--', false, trackNum);
    }

    const cacheKey = (trackItemRef && trackItemRef.id) || currentAudioSrc || targetTitle;
    const cached = getCachedCompiled(cacheKey, 'mp3') || getCachedCompiled(cacheKey, 'wav');
    if (cached && cached.blob) {
      isNativeStream = true;
      currentAudioBlob = cached.blob;
      currentExt = cached.ext || 'mp3';
      activeDuration = cached.duration || 0;
      if (!activeDuration && cached.visData) {
        activeDuration = Math.round((cached.visData.length / 28) / (cached.visFps || 15));
      }

      activeObjectUrl = URL.createObjectURL(cached.blob);
      audioEl.src = activeObjectUrl;
      try { audioEl.currentTime = 0; } catch (e) {}
      audioEl.loop = window.XMQueue ? window.XMQueue.isLooping : true;
      connectNativeSource();
      if (cached.visData && window.XMVisualizer && window.XMVisualizer.setVisualizerCache) {
        window.XMVisualizer.setVisualizerCache(cached.visData, cached.visFps);
      }
      if (window.XMBackground) {
        window.XMBackground.updateMetadata(targetTitle, targetArtist);
        window.XMBackground.setPlaybackState(true);
      }
      audioEl.play().then(() => notifyPlayState(true)).catch(() => notifyPlayState(false));
      if (window.XMApp) {
        window.XMApp.updateTrackUI(targetTitle, targetArtist, currentExt.toUpperCase(), '2CH', true, trackNum);
        if (activeDuration > 0) window.XMApp.updateDuration(activeDuration);
        if (window.XMApp.setPlaybackStatus) window.XMApp.setPlaybackStatus('loaded');
        if (window.XMApp.setCompileStatus) window.XMApp.setCompileStatus('ready');
      }
      return;
    }

    if (NATIVE_STREAM_EXTS.has(extMatch ? extMatch[0] : '')) {
      isNativeStream = true;
      currentAudioBlob = (fileOrUrl instanceof File || fileOrUrl instanceof Blob) ? fileOrUrl : null;
      activeObjectUrl = currentAudioBlob ? URL.createObjectURL(currentAudioBlob) : null;
      audioEl.src = activeObjectUrl || fileOrUrl;
      try { audioEl.currentTime = 0; } catch (e) {}
      audioEl.loop = window.XMQueue ? window.XMQueue.isLooping : true;
      connectNativeSource();
      if (window.XMBackground) {
        window.XMBackground.updateMetadata(targetTitle, targetArtist);
        window.XMBackground.setPlaybackState(true);
      }
      audioEl.play().then(() => notifyPlayState(true)).catch(() => notifyPlayState(false));
      if (window.XMApp) {
        window.XMApp.updateTrackUI(targetTitle, targetArtist, currentExt.toUpperCase(), '2CH', true, trackNum);
      }
      return;
    }

    isNativeStream = false;
    connectNativeSource();
    if (window.XMBackground) {
      window.XMBackground.mountCarrier(180, 0, true);
      window.XMBackground.updateMetadata(targetTitle, targetArtist);
      window.XMBackground.setPlaybackState(true);
    }

    player.load(fileOrUrl, (buf) => {
      if (loadId !== currentLoadId) return;
      currentRawBuffer = buf;
      player.setRepeat(window.XMQueue ? window.XMQueue.isLooping : true);
      const node = player.play(buf);
      if (!node) {
        handleUnsupported(targetTitle, currentExt, fallbackName);
        return;
      }
      const meta = player.currentMetadata || {};
      const engineName = (meta.type_long || currentExt || 'FT2').toUpperCase();
      const dur = (meta && isFinite(meta.duration) && meta.duration > 0) ? meta.duration : player.duration();
      if (dur > 0) activeDuration = dur;

      if (window.XMBackground) {
        window.XMBackground.updateMetadata(targetTitle, targetArtist);
        window.XMBackground.updatePositionState();
      }
      notifyPlayState(true);
      if (window.XMApp) {
        window.XMApp.updateTrackUI(targetTitle, targetArtist, engineName, `${meta.channels || 8}CH`, false, trackNum);
        if (activeDuration > 0) window.XMApp.updateDuration(activeDuration);
      }
      if (window.XMExport && window.XMExport.startInitialCompile) {
        const trackId = (trackItemRef && trackItemRef.id) || currentAudioSrc || targetTitle;
        window.XMExport.startInitialCompile(buf, trackId);
      }
    }, (err) => {
      if (loadId !== currentLoadId) return;
      handleUnsupported(targetTitle, currentExt, fallbackName);
    });
  }

  audioEl.addEventListener('loadedmetadata', () => {
    const d = audioEl.duration;
    if (d && !isNaN(d) && isFinite(d) && d > 0) activeDuration = d;
    if (window.XMApp && activeDuration > 0) window.XMApp.updateDuration(activeDuration);
    if (window.XMBackground && window.XMBackground.updatePositionState) window.XMBackground.updatePositionState();
  });
  audioEl.addEventListener('durationchange', () => {
    const d = audioEl.duration;
    if (d && !isNaN(d) && isFinite(d) && d > 0) {
      activeDuration = d;
      if (window.XMApp) window.XMApp.updateDuration(activeDuration);
    }
  });
  audioEl.addEventListener('error', () => {
    if (isNativeStream && activeTitle && activeTitle !== 'No Module Loaded') {
      handleUnsupported(activeTitle, currentExt, '');
    }
  });
  audioEl.addEventListener('ended', () => {
    if (isNativeStream && window.XMQueue) window.XMQueue.playNextTrack(false);
  });
  player.on('onEnded', () => {
    if (!isNativeStream && window.XMQueue) window.XMQueue.playNextTrack(false);
  });

  window.XMAudio = {
    player,
    audioEl,
    unload,
    setPaused,
    togglePlayPause,
    stopPlayback,
    seekTo,
    getDuration,
    getPosition,
    isPlaying,
    notifyPlayState,
    get isNativeStream() { return isNativeStream; },
    get currentRawBuffer() { return currentRawBuffer; },
    get currentAudioBlob() { return currentAudioBlob; },
    get currentAudioSrc() { return currentAudioSrc; },
    get currentTrackItem() { return currentTrackItem; },
    getCurrentExtension: () => currentExt,
    loadTrack,
    handoffToCompiled,
    getCachedCompiled,
    setCachedCompiled,
    playNextTrack: (f) => window.XMQueue && window.XMQueue.playNextTrack(f),
    playPrevTrack: () => window.XMQueue && window.XMQueue.playPrevTrack(),
    playRandomTrack: () => window.XMQueue && window.XMQueue.playRandomTrack(),
    toggleLoop: () => window.XMQueue && window.XMQueue.toggleLoop(),
    toggleShuffle: () => window.XMQueue && window.XMQueue.toggleShuffle(),
    get isLooping() { return window.XMQueue ? window.XMQueue.isLooping : true; },
    get isShuffle() { return window.XMQueue ? window.XMQueue.isShuffle : false; },
    getCurrentInfo: () => ({ title: activeTitle, artist: activeArtist, trackNum: window.XMQueue ? window.XMQueue.getTrackNum() : 1 })
  };
})(window);