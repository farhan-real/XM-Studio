/**
 * js/engine/dsp/audio.js - Master playback coordinator with latency-aligned native handoff.
 */
(function(window) {
  const player = new ChiptuneJsPlayer();
  const audioEl = document.getElementById('nativeAudio');
  const compiledCache = new Map();

  let currentRawBuffer = null, currentAudioBlob = null, currentAudioSrc = '';
  let activeObjectUrl = null, currentExt = '', isNativeStream = false;
  let nativeAudioSource = null, nativeGainNode = null;
  let activeTitle = 'No Module Loaded', activeArtist = '', activeDuration = 0;
  let activeEngine = 'NONE', activeChannels = '--';
  let currentTrackItem = null, currentLoadId = 0, isHandoffPending = false;

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
      nativeGainNode = player.context.createGain();
      nativeGainNode.connect(player.gainNode);
      nativeAudioSource.connect(nativeGainNode);
    }
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
      if (audioEl.ended || (audioEl.duration > 0 && audioEl.currentTime >= audioEl.duration - 0.1)) {
        safeSeekAudio(audioEl, 0);
      }
      audioEl.play().then(() => notifyPlayState(true)).catch((err) => {
        console.error('[XMAudio] Native audio play failed:', err);
        notifyPlayState(false);
        if (window.XMApp && window.XMApp.setStatus) window.XMApp.setStatus('error');
        alert('Audio Playback Error: ' + err.message);
      });
    } else {
      if (!player.currentPlayingNode && currentRawBuffer) {
        player.play(currentRawBuffer);
      } else if (player.currentPlayingNode && player.currentPlayingNode.paused) {
        if (activeDuration > 0 && player.getPosition() >= activeDuration - 0.1) player.seek(0);
        player.togglePause();
      }
      audioEl.play().then(() => notifyPlayState(true)).catch((err) => {
        console.error('[XMAudio] Carrier audio playback failed:', err);
        notifyPlayState(false);
      });
    }
  }

  function togglePlayPause() { setPaused(isPlaying()); }

  function stopPlayback() {
    isHandoffPending = false;
    audioEl.pause();
    safeSeekAudio(audioEl, 0);
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
    isHandoffPending = false;
    try {
      if (window.AudioCompiler && window.AudioCompiler.cancel) window.AudioCompiler.cancel();
      if (window.XMExport && window.XMExport.cancelExport) window.XMExport.cancelExport();
      player.unload ? player.unload() : player.stop();
      audioEl.pause();
      safeSeekAudio(audioEl, 0);
      audioEl.removeAttribute('src');
      audioEl.load();
      if (nativeGainNode && player.context) nativeGainNode.gain.setValueAtTime(1.0, player.context.currentTime);
      if (player.workletGain && player.context) player.workletGain.gain.setValueAtTime(1.0, player.context.currentTime);
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
    if (!trackId || !format) return null;
    if (window.XMCache) {
      const res = window.XMCache.get(trackId, format);
      if (res) return res;
    }
    return compiledCache.get(`${trackId}_${format.toLowerCase()}`);
  }

  function setCachedCompiled(trackId, format, blob, visData, visFps, duration, engine, channels) {
    if (!trackId || !format || !engine || !channels) throw new Error('setCachedCompiled: parameters required.');
    const fmt = format.toLowerCase();
    const qId = window.XMQueue && window.XMQueue.getQueueId ? window.XMQueue.getQueueId() : null;
    if (window.XMCache) window.XMCache.set(trackId, fmt, blob, visData, visFps, duration, qId, engine, channels);
    compiledCache.set(`${trackId}_${fmt}`, { blob, ext: fmt, visData, visFps, duration, playlistId: qId, engine, channels });
  }

  function handoffToCompiled(blob, format, targetTrackId, visData, visFps, duration, engine, channels) {
    if (!blob || !format || !targetTrackId || typeof duration !== 'number' || duration <= 0) {
      throw new Error('Handoff error: Invalid compilation parameters.');
    }
    activeDuration = duration;
    const isTracker = !window.XMMeta.NATIVE_STREAM_EXTS.has(`.${currentExt}`);
    const resolvedEngine = isTracker
      ? window.XMMeta.getDetailedTrackerEngine(engine, activeEngine, currentExt)
      : window.XMMeta.resolveTrackerEngine(engine ? engine : activeEngine, currentExt);

    const resolvedChannels = (activeChannels && activeChannels !== '--') ? activeChannels : channels;
    setCachedCompiled(targetTrackId, format, blob, visData, visFps, activeDuration, resolvedEngine, resolvedChannels);
    const currentId = currentTrackItem ? currentTrackItem.id : (currentAudioSrc ? currentAudioSrc : activeTitle);
    if (targetTrackId !== currentId) return;

    activeEngine = resolvedEngine;
    activeChannels = resolvedChannels;
    currentAudioBlob = blob;
    if (visData && window.XMVisualizer && window.XMVisualizer.setVisualizerCache) window.XMVisualizer.setVisualizerCache(visData, visFps);

    const wasPlaying = isPlaying(), curPos = getPosition();
    revokeActiveObjectUrl();
    activeObjectUrl = URL.createObjectURL(blob);
    connectNativeSource();

    if (!wasPlaying) {
      audioEl.pause();
      audioEl.src = activeObjectUrl;
      audioEl.loop = window.XMQueue ? window.XMQueue.isLooping : false;
      if (nativeGainNode && player.context) {
        nativeGainNode.gain.cancelScheduledValues(player.context.currentTime);
        nativeGainNode.gain.setValueAtTime(1.0, player.context.currentTime);
      }
      audioEl.load();
      safeSeekAudio(audioEl, curPos);
      isNativeStream = true;
      player.stop();
      notifyPlayState(false);
      if (window.XMApp) {
        if (window.XMApp.setPlaybackStatus) window.XMApp.setPlaybackStatus('loaded');
        if (window.XMApp.setCompileStatus) window.XMApp.setCompileStatus('ready');
        if (window.XMApp.updateTrackUI) window.XMApp.updateTrackUI(activeTitle, activeArtist, activeEngine, activeChannels, true, window.XMQueue ? window.XMQueue.getTrackNum() : 1);
      }
      return;
    }

    isHandoffPending = true;
    const ctx = player.context, nowStart = ctx.currentTime;
    if (nativeGainNode) {
      nativeGainNode.gain.cancelScheduledValues(nowStart);
      nativeGainNode.gain.setValueAtTime(0.0, nowStart);
    }

    audioEl.pause();
    audioEl.src = activeObjectUrl;
    audioEl.loop = window.XMQueue ? window.XMQueue.isLooping : false;
    audioEl.load();

    const performHandoff = () => {
      if (!isHandoffPending) return;
      const isMp3 = format.toLowerCase() === 'mp3';
      const ENCODER_DELAY = isMp3 ? 0.011 : 0.0, PLAY_START_LEAD = 0.034;
      const targetPos = Math.min(activeDuration, player.getPosition() + ENCODER_DELAY + PLAY_START_LEAD);
      safeSeekAudio(audioEl, targetPos);

      const onSeeked = () => {
        if (!isHandoffPending) return;
        const onPlaying = () => {
          if (!isHandoffPending) return;
          const now = ctx.currentTime, FADE_SEC = 0.015;
          if (player.workletGain) {
            player.workletGain.gain.cancelScheduledValues(now);
            player.workletGain.gain.setValueAtTime(player.workletGain.gain.value, now);
            player.workletGain.gain.linearRampToValueAtTime(0.0, now + FADE_SEC);
          }
          if (nativeGainNode) {
            nativeGainNode.gain.cancelScheduledValues(now);
            nativeGainNode.gain.setValueAtTime(0.0, now);
            nativeGainNode.gain.linearRampToValueAtTime(1.0, now + FADE_SEC);
          }

          setTimeout(() => {
            if (!isHandoffPending) return;
            isHandoffPending = false;
            isNativeStream = true;
            player.stop();
            notifyPlayState(true);
            if (window.XMApp && window.XMApp.setPlaybackStatus) window.XMApp.setPlaybackStatus('loaded');
            if (window.XMApp && window.XMApp.setCompileStatus) window.XMApp.setCompileStatus('ready');
            if (window.XMBackground) {
              window.XMBackground.updateMetadata(activeTitle, activeArtist);
              window.XMBackground.updatePositionState();
            }
            if (window.XMApp && activeDuration > 0) window.XMApp.updateDuration(activeDuration);
            const trackNum = window.XMQueue ? window.XMQueue.getTrackNum() : 1;
            if (window.XMApp && window.XMApp.updateTrackUI) window.XMApp.updateTrackUI(activeTitle, activeArtist, activeEngine, activeChannels, true, trackNum);
          }, 25);
        };
        audioEl.addEventListener('playing', onPlaying, { once: true });
        audioEl.play().catch((err) => {
          console.error('[XMAudio] Native audio play failed:', err);
          isHandoffPending = false;
          audioEl.removeEventListener('playing', onPlaying);
          if (player.workletGain) {
            player.workletGain.gain.cancelScheduledValues(ctx.currentTime);
            player.workletGain.gain.setValueAtTime(1.0, ctx.currentTime);
          }
        });
      };
      audioEl.addEventListener('seeked', onSeeked, { once: true });
    };

    if (audioEl.readyState >= 1) performHandoff();
    else audioEl.addEventListener('loadedmetadata', performHandoff, { once: true });
  }

  function loadTrack(fileOrUrl, fallbackName, trackItemRef, queue, queueIdx) {
    const loadId = ++currentLoadId;
    isHandoffPending = false;
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
    if (!targetTitle || !targetArtist) throw new Error('loadTrack error: Incomplete track metadata.');

    const isDirectNativeAudio = window.XMMeta.NATIVE_STREAM_EXTS.has(`.${currentExt}`);
    player.unlock();
    player.stop();
    audioEl.pause();
    safeSeekAudio(audioEl, 0);
    isNativeStream = false;
    revokeActiveObjectUrl();

    activeTitle = targetTitle;
    activeArtist = targetArtist;
    activeDuration = 0;
    activeEngine = isDirectNativeAudio ? currentExt.toUpperCase() : window.XMMeta.getDetailedTrackerEngine('', '', currentExt);
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
      const hasStaleEngine = window.XMCache && window.XMCache.isStaleEngine
        ? window.XMCache.isStaleEngine(cached.engine, currentExt)
        : (cached.engine === currentExt.toUpperCase() || cached.engine === 'TRACKER');

      if (hasStaleEngine) {
        if (window.XMCache && window.XMCache.clearKey) window.XMCache.clearKey(cacheKey, activeFmt);
        compiledCache.delete(`${cacheKey}_${activeFmt.toLowerCase()}`);
      } else {
        isNativeStream = true;
        currentAudioBlob = cached.blob;
        activeDuration = cached.duration;
        activeEngine = window.XMMeta.getDetailedTrackerEngine(cached.engine, '', currentExt);
        activeChannels = cached.channels;

        activeObjectUrl = URL.createObjectURL(cached.blob);
        audioEl.src = activeObjectUrl;
        safeSeekAudio(audioEl, 0);
        audioEl.loop = window.XMQueue ? window.XMQueue.isLooping : false;
        connectNativeSource();
        if (nativeGainNode && player.context) nativeGainNode.gain.setValueAtTime(1.0, player.context.currentTime);
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
    }

    if (isDirectNativeAudio) {
      isNativeStream = true;
      currentAudioBlob = (fileOrUrl instanceof File || fileOrUrl instanceof Blob) ? fileOrUrl : null;
      activeObjectUrl = currentAudioBlob ? URL.createObjectURL(currentAudioBlob) : null;
      audioEl.src = activeObjectUrl ? activeObjectUrl : fileOrUrl;
      safeSeekAudio(audioEl, 0);
      audioEl.loop = window.XMQueue ? window.XMQueue.isLooping : false;
      connectNativeSource();
      if (nativeGainNode && player.context) nativeGainNode.gain.setValueAtTime(1.0, player.context.currentTime);
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
      activeEngine = window.XMMeta.getDetailedTrackerEngine(meta.tracker, meta.type_long, currentExt);
      if (typeof meta.channels !== 'number' || meta.channels <= 0) throw new Error(`Invalid channel count: ${meta.channels}`);
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