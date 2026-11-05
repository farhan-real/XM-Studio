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
  let currentTrackItem = null;
  let currentLoadId = 0;

  const NATIVE_STREAM_EXTS = new Set(['.mp3', '.ogg', '.wav', '.flac']);

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
      return (audioEl.duration && !isNaN(audioEl.duration) && isFinite(audioEl.duration)) ? audioEl.duration : 0;
    }
    const d = player.duration ? player.duration() : 0;
    return (isFinite(d) && d > 0) ? d : 0;
  }

  function getPosition() {
    if (isNativeStream) {
      return (audioEl.currentTime && !isNaN(audioEl.currentTime) && isFinite(audioEl.currentTime)) ? Math.max(0, audioEl.currentTime) : 0;
    }
    const p = player.getPosition ? player.getPosition() : 0;
    return (isFinite(p) && p >= 0) ? p : 0;
  }

  function isPlaying() {
    return isNativeStream ? !audioEl.paused : Boolean(player.currentPlayingNode && !player.currentPlayingNode.paused);
  }

  function notifyPlayState(playing) {
    if (window.XMApp && window.XMApp.setPlayingState) window.XMApp.setPlayingState(playing);
    if (window.XMBackground) window.XMBackground.setPlaybackState(playing);
    updateDocumentTitle(playing);
  }

  function safeSeekAudio(element, time) {
    if (!isFinite(time) || time < 0) return;
    try {
      if (element.seekable && element.seekable.length > 0) {
        const end = element.seekable.end(element.seekable.length - 1);
        element.currentTime = Math.max(0, Math.min(time, end));
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
      if (!isNativeStream && player.currentPlayingNode && !player.currentPlayingNode.paused) {
        player.togglePause();
      }
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
        if (!player.currentPlayingNode && currentRawBuffer) {
          player.play(currentRawBuffer);
        } else if (player.currentPlayingNode && player.currentPlayingNode.paused) {
          player.togglePause();
        }
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
    if (window.XMVisualizer) window.XMVisualizer.clear();
    if (window.XMApp) window.XMApp.onTrackEnded();
  }

  function seekTo(targetSec) {
    const s = Math.max(0, Number(targetSec) || 0);
    if (isNativeStream) {
      safeSeekAudio(audioEl, s);
    } else {
      player.seek(s);
      safeSeekAudio(audioEl, s);
    }
    if (window.XMBackground) window.XMBackground.updatePositionState();
  }

  function unload() {
    player.stop();
    audioEl.pause();
    try { audioEl.currentTime = 0; } catch (e) {}
    audioEl.removeAttribute('src');
    audioEl.load();
    if (window.XMBackground) window.XMBackground.releaseCarrier();
    if (window.XMVisualizer) {
      window.XMVisualizer.clearVisualizerCache();
      window.XMVisualizer.clear();
    }
    revokeActiveObjectUrl();
    isNativeStream = false;
    currentRawBuffer = null;
    currentAudioBlob = null;
    currentAudioSrc = '';
    currentTrackItem = null;
    activeTitle = 'No Module Loaded';
    activeArtist = '';
    if (window.XMQueue) window.XMQueue.setQueue(null, -1);
    notifyPlayState(false);
  }

  function getCachedCompiled(trackId, format) {
    if (window.XMCache) {
      const res = window.XMCache.get(trackId, format);
      if (res) return res;
    }
    const key = `${trackId}_${(format || 'mp3').toLowerCase()}`;
    return compiledCache.get(key) || null;
  }

  function setCachedCompiled(trackId, format, blob, visData, visFps) {
    const fmt = (format || 'mp3').toLowerCase();
    if (window.XMCache) {
      window.XMCache.set(trackId, fmt, blob, visData, visFps);
    }
    const key = `${trackId}_${fmt}`;
    compiledCache.set(key, { blob, ext: fmt, visData, visFps });
  }

  function handoffToCompiled(blob, format, targetTrackId, visData, visFps) {
    if (!blob) return;
    const currentId = (currentTrackItem && currentTrackItem.id) || currentAudioSrc || activeTitle;
    const targetExt = (format || 'mp3').toLowerCase();

    setCachedCompiled(targetTrackId || currentId, targetExt, blob, visData, visFps);
    if (targetTrackId && targetTrackId !== currentId) return;

    currentAudioBlob = blob;
    currentExt = targetExt;
    if (visData && window.XMVisualizer) window.XMVisualizer.setVisualizerCache(visData, visFps);

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
      const livePos = (player.currentPlayingNode && !player.currentPlayingNode.paused)
        ? player.getPosition()
        : curPos;

      if (wasPlaying) {
        audioEl.play().then(() => {
          isNativeStream = true;
          safeSeekAudio(audioEl, livePos);
          player.stop();
          notifyPlayState(true);
          if (window.XMApp && window.XMApp.setPlaybackStatus) {
            window.XMApp.setPlaybackStatus('loaded');
          }
          if (window.XMBackground) {
            window.XMBackground.updateMetadata(activeTitle, activeArtist);
            window.XMBackground.updatePositionState();
          }
          if (window.XMApp && audioEl.duration) window.XMApp.updateDuration(audioEl.duration);
        }).catch((err) => {
          console.warn('Native handoff play interrupted, maintaining DSP engine:', err);
          notifyPlayState(true);
        });
      } else {
        isNativeStream = true;
        player.stop();
        safeSeekAudio(audioEl, curPos);
        notifyPlayState(false);
        if (window.XMApp && window.XMApp.setPlaybackStatus) {
          window.XMApp.setPlaybackStatus('loaded');
        }
        if (window.XMApp && audioEl.duration) window.XMApp.updateDuration(audioEl.duration);
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
    const ext = extMatch ? extMatch[0] : '';
    currentExt = ext ? ext.replace('.', '').toLowerCase() : 'xm';

    player.unlock();
    player.stop();
    audioEl.pause();
    try { audioEl.currentTime = 0; } catch (e) {}
    audioEl.removeAttribute('src');
    audioEl.load();
    isNativeStream = false;
    revokeActiveObjectUrl();

    let targetTitle = (trackItemRef && trackItemRef.title) ? trackItemRef.title.trim() : '';
    let targetArtist = (trackItemRef && trackItemRef.artist) ? trackItemRef.artist.trim() : '';
    if (!targetTitle) {
      const parsed = parseTrackInfo(fallbackName, {});
      targetTitle = parsed.title;
      targetArtist = targetArtist || parsed.artist;
    }
    activeTitle = targetTitle;
    activeArtist = targetArtist;

    currentRawBuffer = null;
    currentAudioBlob = null;
    currentAudioSrc = (typeof fileOrUrl === 'string') ? fileOrUrl : '';
    currentTrackItem = trackItemRef || null;
    if (window.XMQueue) window.XMQueue.setQueue(queue, queueIdx);

    const trackNum = window.XMQueue ? window.XMQueue.getTrackNum() : 1;
    if (window.XMVisualizer) window.XMVisualizer.clearVisualizerCache();
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
      activeObjectUrl = URL.createObjectURL(cached.blob);
      audioEl.src = activeObjectUrl;
      try { audioEl.currentTime = 0; } catch (e) {}
      audioEl.loop = window.XMQueue ? window.XMQueue.isLooping : true;
      connectNativeSource();
      if (cached.visData && window.XMVisualizer) window.XMVisualizer.setVisualizerCache(cached.visData, cached.visFps);
      if (window.XMBackground) {
        window.XMBackground.updateMetadata(targetTitle, targetArtist);
        window.XMBackground.setPlaybackState(true);
      }
      audioEl.play().then(() => notifyPlayState(true)).catch(() => notifyPlayState(false));
      if (window.XMApp) {
        window.XMApp.updateTrackUI(targetTitle, targetArtist, currentExt.toUpperCase(), '2CH', true, trackNum);
        if (audioEl.duration && !isNaN(audioEl.duration)) window.XMApp.updateDuration(audioEl.duration);
        if (window.XMApp.setPlaybackStatus) window.XMApp.setPlaybackStatus('loaded');
        if (window.XMApp.setCompileStatus) window.XMApp.setCompileStatus('ready');
      }
      return;
    }

    if (NATIVE_STREAM_EXTS.has(ext)) {
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
        if (audioEl.duration && !isNaN(audioEl.duration)) window.XMApp.updateDuration(audioEl.duration);
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
        notifyPlayState(false);
        if (window.XMApp) window.XMApp.updateTrackUI(targetTitle + ' (Load Failed)', targetArtist, 'ERROR', '--', false, 0);
        return;
      }
      const meta = player.currentMetadata || {};
      const engineName = (meta.type_long || currentExt || 'FT2').toUpperCase();
      if (window.XMBackground) {
        window.XMBackground.updateMetadata(targetTitle, targetArtist);
        window.XMBackground.updatePositionState();
      }
      notifyPlayState(true);
      if (window.XMApp) {
        window.XMApp.updateTrackUI(targetTitle, targetArtist, engineName, `${meta.channels || 8}CH`, false, trackNum);
        window.XMApp.updateDuration(player.duration());
      }
      // Start initial background compilation for seamless handoff & instant future downloads
      if (window.XMExport && window.XMExport.startInitialCompile) {
        const trackId = (trackItemRef && trackItemRef.id) || currentAudioSrc || targetTitle;
        window.XMExport.startInitialCompile(buf, trackId);
      }
    }, () => {
      if (loadId !== currentLoadId) return;
      notifyPlayState(false);
      if (window.XMApp) window.XMApp.updateTrackUI(targetTitle + ' (Load Failed)', targetArtist, 'ERROR', '--', false, 0);
    });
  }

  audioEl.addEventListener('loadedmetadata', () => {
    if (isNativeStream && window.XMApp && window.XMApp.updateDuration) {
      window.XMApp.updateDuration(audioEl.duration);
    }
    if (window.XMBackground) window.XMBackground.updatePositionState();
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