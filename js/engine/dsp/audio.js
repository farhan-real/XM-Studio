/**
 * js/engine/dsp/audio.js - Master playback coordinator without silent fallbacks.
 */
(function(window) {
  const player = new ChiptuneJsPlayer();
  const audioEl = document.getElementById('nativeAudio');
  const compiledCache = new Map();

  let currentRawBuffer = null, currentAudioBlob = null, currentAudioSrc = '';
  let activeObjectUrl = null, currentExt = '', isNativeStream = false, nativeAudioSource = null;
  let activeTitle = 'No Module Loaded', activeArtist = '', activeDuration = 0;
  let activeEngine = 'NONE', activeChannels = '--';
  let currentTrackItem = null, currentLoadId = 0;

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
      nativeAudioSource = player.context.createMediaElementSource(audioEl);
    }
    nativeAudioSource.disconnect();
    nativeAudioSource.connect(player.gainNode);
  }

  function updateDocumentTitle(playing) {
    if (playing && activeTitle && activeTitle !== 'No Module Loaded') {
      document.title = `▶ ${activeTitle} - ${activeArtist}`;
    } else if (activeTitle && activeTitle !== 'No Module Loaded') {
      document.title = `${activeTitle} - ${activeArtist} | XM-Studio`;
    } else {
      document.title = 'XM-Studio';
    }
  }

  function getDuration() {
    if (isNativeStream) {
      const d = audioEl.duration;
      return (d && !isNaN(d) && isFinite(d) && d > 0) ? d : (activeDuration > 0 ? activeDuration : 0);
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
    if (typeof time !== 'number' || !isFinite(time) || time < 0) throw new Error(`Invalid seek time: ${time}`);
    if (element.seekable && element.seekable.length > 0) {
      element.currentTime = Math.max(0, Math.min(time, element.seekable.end(element.seekable.length - 1)));
    } else if (isFinite(element.duration) && element.duration > 0) {
      element.currentTime = Math.min(time, element.duration);
    } else {
      element.currentTime = time;
    }
  }

  function setPaused(wantPaused) {
    player.unlock();
    if (wantPaused) {
      audioEl.pause();
      if (!isNativeStream && player.currentPlayingNode && !player.currentPlayingNode.paused) player.togglePause();
      notifyPlayState(false);
    } else if (isNativeStream) {
      audioEl.play().then(() => notifyPlayState(true)).catch((err) => {
        console.error('[XMAudio] Native audio play failed:', err);
        notifyPlayState(false);
        if (window.XMApp && window.XMApp.setStatus) window.XMApp.setStatus('error');
        alert('Audio Playback Error: ' + err.message);
      });
    } else {
      if (!player.currentPlayingNode && currentRawBuffer) player.play(currentRawBuffer);
      else if (player.currentPlayingNode && player.currentPlayingNode.paused) player.togglePause();
      audioEl.play().then(() => notifyPlayState(true)).catch((err) => {
        console.error('[XMAudio] Carrier audio playback failed:', err);
        notifyPlayState(false);
        alert('Carrier Audio Error: ' + err.message);
      });
    }
  }

  function togglePlayPause() { setPaused(isPlaying()); }

  function stopPlayback() {
    audioEl.pause();
    audioEl.currentTime = 0;
    player.stop();
    notifyPlayState(false);
    if (window.XMVisualizer && window.XMVisualizer.clear) window.XMVisualizer.clear();
    if (window.XMApp && window.XMApp.onTrackEnded) window.XMApp.onTrackEnded();
  }

  function seekTo(targetSec) {
    const s = Math.max(0, Number(targetSec));
    if (isNativeStream) safeSeekAudio(audioEl, s);
    else { player.seek(s); safeSeekAudio(audioEl, s); }
    if (window.XMBackground && window.XMBackground.updatePositionState) window.XMBackground.updatePositionState();
  }

  function handleUnsupported(title, ext, filename) {
    unload();
    const displayExt = ext ? ext.toUpperCase() : 'UNKNOWN';
    const err = new Error(`Format .${displayExt} is not supported by workstation.`);
    console.error('[XMAudio]', err);
    if (window.XMApp) {
      window.XMApp.updateTrackUI(`${title ? title : filename} (Unsupported)`, err.message, 'UNSUPPORTED', '--', false, 0);
    }
    alert(err.message);
  }

  function unload() {
    currentLoadId++;
    try {
      if (window.AudioCompiler && window.AudioCompiler.cancel) window.AudioCompiler.cancel();
      if (window.XMExport && window.XMExport.cancelExport) window.XMExport.cancelExport();
      player.stop();
      audioEl.pause();
      audioEl.currentTime = 0;
      audioEl.removeAttribute('src');
      audioEl.load();
      if (window.XMBackground && window.XMBackground.releaseCarrier) window.XMBackground.releaseCarrier();
      if (window.XMBackground && window.XMBackground.clearMetadata) window.XMBackground.clearMetadata();
      if (window.XMVisualizer && window.XMVisualizer.clearVisualizerCache) window.XMVisualizer.clearVisualizerCache();
    } catch (err) {
      console.error('[XMAudio] Error during unload:', err);
    } finally {
      revokeActiveObjectUrl();
      isNativeStream = false;
      currentRawBuffer = null;
      currentAudioBlob = null;
      currentAudioSrc = '';
      currentTrackItem = null;
      currentExt = '';
      activeTitle = 'No Module Loaded';
      activeArtist = '';
      activeDuration = 0;
      activeEngine = 'NONE';
      activeChannels = '--';
      if (window.XMQueue && window.XMQueue.setQueue) window.XMQueue.setQueue(null, -1);
      notifyPlayState(false);
    }
  }

  function getCachedCompiled(trackId, format) {
    if (!trackId) throw new Error('getCachedCompiled: trackId is required.');
    if (!format) throw new Error('getCachedCompiled: format is required.');
    if (window.XMCache) {
      const res = window.XMCache.get(trackId, format);
      if (res) return res;
    }
    return compiledCache.get(`${trackId}_${format.toLowerCase()}`);
  }

  function setCachedCompiled(trackId, format, blob, visData, visFps, duration, engine, channels) {
    if (!trackId) throw new Error('setCachedCompiled: trackId is required.');
    if (!format) throw new Error('setCachedCompiled: format is required.');
    if (!engine) throw new Error('setCachedCompiled: engine is required.');
    if (!channels) throw new Error('setCachedCompiled: channels is required.');
    const fmt = format.toLowerCase();
    const qId = window.XMQueue && window.XMQueue.getQueueId ? window.XMQueue.getQueueId() : null;
    if (window.XMCache) window.XMCache.set(trackId, fmt, blob, visData, visFps, duration, qId, engine, channels);
    compiledCache.set(`${trackId}_${fmt}`, { blob, ext: fmt, visData, visFps, duration, playlistId: qId, engine, channels });
  }

  function handoffToCompiled(blob, format, targetTrackId, visData, visFps, duration, engine, channels) {
    if (!blob) throw new Error('Handoff error: No blob provided.');
    if (!format) throw new Error('Handoff error: Target format is missing.');
    if (!targetTrackId) throw new Error('Handoff error: targetTrackId is missing.');
    if (typeof duration !== 'number' || duration <= 0) {
      throw new Error(`Handoff error: Invalid duration ${duration} for compiled audio.`);
    }
    activeDuration = duration;

    const isTracker = !window.XMMeta.NATIVE_STREAM_EXTS.has(`.${currentExt}`);
    let resolvedEngine;
    if (isTracker) {
      resolvedEngine = (activeEngine && activeEngine !== 'NONE' && activeEngine !== 'AUDIO' && activeEngine !== 'MP3' && activeEngine !== 'WAV')
        ? activeEngine
        : window.XMMeta.resolveTrackerEngine(engine, currentTrackItem ? currentTrackItem.ext : currentExt);
    } else {
      resolvedEngine = window.XMMeta.resolveTrackerEngine(engine ? engine : activeEngine, currentTrackItem ? currentTrackItem.ext : currentExt);
    }

    if (!channels && (!activeChannels || activeChannels === '--')) {
      throw new Error('Handoff error: Channel count was not reported.');
    }
    const resolvedChannels = (activeChannels && activeChannels !== '--') ? activeChannels : channels;

    setCachedCompiled(targetTrackId, format, blob, visData, visFps, activeDuration, resolvedEngine, resolvedChannels);
    const currentId = currentTrackItem ? currentTrackItem.id : (currentAudioSrc ? currentAudioSrc : activeTitle);
    if (targetTrackId !== currentId) return;

    activeEngine = resolvedEngine;
    activeChannels = resolvedChannels;
    currentAudioBlob = blob;
    if (visData && window.XMVisualizer && window.XMVisualizer.setVisualizerCache) window.XMVisualizer.setVisualizerCache(visData, visFps);

    const wasPlaying = isPlaying();
    const curPos = getPosition();
    revokeActiveObjectUrl();
    activeObjectUrl = URL.createObjectURL(blob);

    audioEl.pause();
    audioEl.src = activeObjectUrl;
    audioEl.loop = window.XMQueue ? window.XMQueue.isLooping : false;
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
          if (window.XMApp && window.XMApp.setCompileStatus) window.XMApp.setCompileStatus('ready');
          if (window.XMBackground) {
            window.XMBackground.updateMetadata(activeTitle, activeArtist);
            window.XMBackground.updatePositionState();
          }
          if (window.XMApp && activeDuration > 0) window.XMApp.updateDuration(activeDuration);
        }).catch((err) => {
          console.error('[XMAudio] Native audio play failed after handoff:', err);
          notifyPlayState(false);
          alert('Playback Failure: ' + err.message);
        });
      } else {
        isNativeStream = true;
        player.stop();
        safeSeekAudio(audioEl, curPos);
        notifyPlayState(false);
        if (window.XMApp && window.XMApp.setPlaybackStatus) window.XMApp.setPlaybackStatus('loaded');
        if (window.XMApp && window.XMApp.setCompileStatus) window.XMApp.setCompileStatus('ready');
        if (window.XMApp && activeDuration > 0) window.XMApp.updateDuration(activeDuration);
      }
      const trackNum = window.XMQueue ? window.XMQueue.getTrackNum() : 1;
      if (window.XMApp && window.XMApp.updateTrackUI) window.XMApp.updateTrackUI(activeTitle, activeArtist, activeEngine, activeChannels, true, trackNum);
    };

    if (audioEl.readyState >= 2) onHandoffReady();
    else audioEl.addEventListener('canplay', onHandoffReady, { once: true });
  }

  function loadTrack(fileOrUrl, fallbackName, trackItemRef, queue, queueIdx) {
    const loadId = ++currentLoadId;
    const extMatch = fallbackName ? fallbackName.toLowerCase().match(/\.[a-z0-9]+$/) : null;
    const parsedExt = extMatch ? extMatch[0].replace('.', '').toLowerCase() : '';
    const itemExt = trackItemRef && trackItemRef.ext ? String(trackItemRef.ext).replace(/^\./, '').toLowerCase() : '';
    currentExt = itemExt ? itemExt : parsedExt;

    if (!currentExt) throw new Error(`loadTrack error: Missing extension for "${fallbackName}".`);
    if (!window.XMMeta.SUPPORTED_EXTS.has(currentExt)) {
      handleUnsupported(trackItemRef ? trackItemRef.title : fallbackName, currentExt, fallbackName);
      return;
    }

    let targetTitle = trackItemRef && trackItemRef.title ? trackItemRef.title.trim() : '';
    let targetArtist = trackItemRef && trackItemRef.artist ? trackItemRef.artist.trim() : '';
    if (!targetTitle || !targetArtist) {
      const parsed = window.XMMeta.parseTrackInfo(fallbackName, {});
      if (!targetTitle) targetTitle = parsed.title;
      if (!targetArtist) targetArtist = parsed.artist;
    }
    if (!targetTitle) throw new Error('loadTrack error: Track title is missing.');
    if (!targetArtist) throw new Error('loadTrack error: Track artist is missing.');

    const isDirectNativeAudio = window.XMMeta.NATIVE_STREAM_EXTS.has(`.${currentExt}`);

    player.unlock();
    player.stop();
    audioEl.pause();
    audioEl.currentTime = 0;
    isNativeStream = false;
    revokeActiveObjectUrl();

    activeTitle = targetTitle;
    activeArtist = targetArtist;
    activeDuration = 0;
    activeEngine = isDirectNativeAudio ? currentExt.toUpperCase() : window.XMMeta.resolveTrackerEngine('', currentExt);
    activeChannels = isDirectNativeAudio ? '2CH' : '--';
    currentRawBuffer = null;
    currentAudioBlob = null;
    currentAudioSrc = (typeof fileOrUrl === 'string') ? fileOrUrl : '';
    currentTrackItem = trackItemRef ? trackItemRef : null;
    if (window.XMQueue) window.XMQueue.setQueue(queue, queueIdx);

    const trackNum = window.XMQueue ? window.XMQueue.getTrackNum() : 1;
    if (window.XMVisualizer && window.XMVisualizer.clearVisualizerCache) window.XMVisualizer.clearVisualizerCache();
    if (window.XMLibrary && trackItemRef) window.XMLibrary.notifyPlaying(trackItemRef.id);
    if (window.XMApp) {
      window.XMApp.resetTimeline();
      window.XMApp.updateTrackUI(targetTitle, targetArtist, activeEngine, activeChannels, false, trackNum);
    }

    if (!window.XMExport) throw new Error('loadTrack error: XMExport module is not available.');
    const activeFmt = window.XMExport.getActiveFormat();
    const cacheKey = trackItemRef ? trackItemRef.id : (currentAudioSrc ? currentAudioSrc : targetTitle);
    const cached = !isDirectNativeAudio ? getCachedCompiled(cacheKey, activeFmt) : null;
    if (cached && cached.blob) {
      isNativeStream = true;
      currentAudioBlob = cached.blob;
      activeDuration = cached.duration;
      activeEngine = window.XMMeta.resolveTrackerEngine(cached.engine, currentExt);
      activeChannels = cached.channels;

      activeObjectUrl = URL.createObjectURL(cached.blob);
      audioEl.src = activeObjectUrl;
      audioEl.currentTime = 0;
      audioEl.loop = window.XMQueue ? window.XMQueue.isLooping : false;
      connectNativeSource();
      if (cached.visData && window.XMVisualizer && window.XMVisualizer.setVisualizerCache) window.XMVisualizer.setVisualizerCache(cached.visData, cached.visFps);
      if (window.XMBackground) {
        window.XMBackground.updateMetadata(targetTitle, targetArtist);
        window.XMBackground.setPlaybackState(true);
      }
      audioEl.play().then(() => notifyPlayState(true)).catch((err) => {
        console.error('[XMAudio] Native audio play failed:', err);
        notifyPlayState(false);
        alert('Playback Error: ' + err.message);
      });
      if (window.XMApp) {
        window.XMApp.updateTrackUI(targetTitle, targetArtist, activeEngine, activeChannels, true, trackNum);
        if (activeDuration > 0) window.XMApp.updateDuration(activeDuration);
        if (window.XMApp.setPlaybackStatus) window.XMApp.setPlaybackStatus('loaded');
        if (window.XMApp.setCompileStatus) window.XMApp.setCompileStatus('ready');
      }
      if (window.XMPrecompiler && window.XMPrecompiler.onTrackLoaded) window.XMPrecompiler.onTrackLoaded();
      return;
    }

    if (isDirectNativeAudio) {
      isNativeStream = true;
      currentAudioBlob = (fileOrUrl instanceof File || fileOrUrl instanceof Blob) ? fileOrUrl : null;
      activeObjectUrl = currentAudioBlob ? URL.createObjectURL(currentAudioBlob) : null;
      audioEl.src = activeObjectUrl ? activeObjectUrl : fileOrUrl;
      audioEl.currentTime = 0;
      audioEl.loop = window.XMQueue ? window.XMQueue.isLooping : false;
      connectNativeSource();
      if (window.XMBackground) {
        window.XMBackground.updateMetadata(targetTitle, targetArtist);
        window.XMBackground.setPlaybackState(true);
      }
      audioEl.play().then(() => notifyPlayState(true)).catch((err) => {
        console.error('[XMAudio] Native audio play failed:', err);
        notifyPlayState(false);
        alert('Playback Error: ' + err.message);
      });
      if (window.XMApp) {
        window.XMApp.updateTrackUI(targetTitle, targetArtist, activeEngine, '2CH', true, trackNum);
        if (window.XMApp.setCompileStatus) window.XMApp.setCompileStatus('ready');
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
      player.setRepeat(window.XMQueue ? window.XMQueue.isLooping : false);
      const node = player.play(buf);
      if (!node) {
        handleUnsupported(targetTitle, currentExt, fallbackName);
        return;
      }
      const meta = player.currentMetadata;
      if (!meta) throw new Error('Tracker playback error: Metadata was not extracted by engine.');
      activeEngine = window.XMMeta.resolveTrackerEngine(meta.type_long, currentExt);
      if (typeof meta.channels !== 'number' || meta.channels <= 0) {
        throw new Error(`Invalid channel count reported by engine: ${meta.channels}`);
      }
      activeChannels = `${meta.channels}CH`;
      activeDuration = meta.duration;

      if (window.XMBackground) {
        window.XMBackground.updateMetadata(targetTitle, targetArtist);
        window.XMBackground.updatePositionState();
      }
      notifyPlayState(true);
      if (window.XMApp) {
        window.XMApp.updateTrackUI(targetTitle, targetArtist, activeEngine, activeChannels, false, trackNum);
        if (activeDuration > 0) window.XMApp.updateDuration(activeDuration);
        if (window.XMApp.setCompileStatus) window.XMApp.setCompileStatus('compiling');
      }
      if (window.XMExport && window.XMExport.startInitialCompile) {
        const trackId = trackItemRef ? trackItemRef.id : (currentAudioSrc ? currentAudioSrc : targetTitle);
        window.XMExport.startInitialCompile(buf, trackId);
      }
    }, (err) => {
      if (loadId !== currentLoadId) return;
      console.error('[XMAudio] player.load failed:', err);
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
  audioEl.addEventListener('ended', () => {
    if (window.XMQueue && window.XMQueue.playMode === 'stop') { stopPlayback(); return; }
    if (isNativeStream && window.XMQueue) window.XMQueue.playNextTrack(false);
  });
  player.on('onEnded', () => {
    if (window.XMQueue && window.XMQueue.playMode === 'stop') { stopPlayback(); return; }
    if (!isNativeStream && window.XMQueue) window.XMQueue.playNextTrack(false);
  });

  window.XMAudio = {
    player, audioEl, unload, setPaused, togglePlayPause, stopPlayback, seekTo,
    getDuration, getPosition, isPlaying, notifyPlayState,
    get isNativeStream() { return isNativeStream; },
    get currentRawBuffer() { return currentRawBuffer; },
    get currentAudioBlob() { return currentAudioBlob; },
    get currentAudioSrc() { return currentAudioSrc; },
    get currentTrackItem() { return currentTrackItem; },
    getCurrentExtension: () => currentExt,
    loadTrack, handoffToCompiled, getCachedCompiled, setCachedCompiled,
    playNextTrack: (f) => window.XMQueue && window.XMQueue.playNextTrack(f),
    playPrevTrack: () => window.XMQueue && window.XMQueue.playPrevTrack(),
    playRandomTrack: () => window.XMQueue && window.XMQueue.playRandomTrack(),
    toggleLoop: () => window.XMQueue && window.XMQueue.toggleLoop(),
    toggleShuffle: () => window.XMQueue && window.XMQueue.toggleShuffle(),
    get isLooping() { return window.XMQueue ? window.XMQueue.isLooping : false; },
    get isShuffle() { return window.XMQueue ? window.XMQueue.isShuffle : false; },
    getCurrentInfo: () => ({ title: activeTitle, artist: activeArtist, trackNum: window.XMQueue ? window.XMQueue.getTrackNum() : 1 })
  };
})(window);