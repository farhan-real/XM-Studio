/**
 * js/engine/audio.js - Master playback coordinator with visualizer pre-caching and seamless native handoff.
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
    player.unlock();
    if (window.XMBackground) window.XMBackground.unlock();
  }
  document.addEventListener('touchstart', unlockOnGesture, { passive: true });
  document.addEventListener('click', unlockOnGesture, { passive: true });

  function revokeActiveObjectUrl() {
    if (activeObjectUrl) {
      URL.revokeObjectURL(activeObjectUrl);
      activeObjectUrl = null;
    }
  }

  function connectNativeSource() {
    if (!player.context) return;
    if (!nativeAudioSource) {
      try {
        nativeAudioSource = player.context.createMediaElementSource(audioEl);
      } catch (e) {}
    }
    if (nativeAudioSource) {
      try {
        nativeAudioSource.disconnect();
      } catch (e) {}
      nativeAudioSource.connect(player.gainNode);
    }
  }

  function updateDocumentTitle(playing) {
    if (playing && activeTitle && activeTitle !== 'No Module Loaded') {
      const art = activeArtist ? ` - ${activeArtist}` : '';
      document.title = `▶ ${activeTitle}${art}`;
    } else if (activeTitle && activeTitle !== 'No Module Loaded') {
      const art = activeArtist ? ` - ${activeArtist}` : '';
      document.title = `${activeTitle}${art} | XM-Studio`;
    } else {
      document.title = 'XM-Studio';
    }
  }

  function parseTrackInfo(filename, internalMeta) {
    internalMeta = internalMeta || {};
    let base = (filename || '').replace(/\.[a-z0-9]+$/i, '').trim();
    if (base.includes('_-_')) {
      base = base.replace(/_-_/g, ' - ').replace(/_/g, ' ');
    } else if (!base.includes(' ') && base.includes('_')) {
      base = base.replace(/_/g, ' ');
    }

    const match = base.match(/^(.+?)\s+[-–—]\s+(.+)$/);
    return {
      title: (match ? match[2].trim() : (internalMeta.title || '').trim()) || base || 'Untitled Track',
      artist: (match ? match[1].trim() : (internalMeta.artist || '').trim()) || (internalMeta.type_long || 'FastTracker II')
    };
  }

  function getDuration() {
    if (isNativeStream) {
      return (audioEl.duration && !isNaN(audioEl.duration)) ? audioEl.duration : 0;
    }
    return player.currentPlayingNode ? player.duration() : 0;
  }

  function getPosition() {
    if (isNativeStream) {
      return audioEl.currentTime || 0;
    }
    return player.currentPlayingNode ? player.getPosition() : 0;
  }

  function isPlaying() {
    return isNativeStream ? !audioEl.paused : Boolean(player.currentPlayingNode && !player.currentPlayingNode.paused);
  }

  function notifyPlayState(playing) {
    if (window.XMApp && window.XMApp.setPlayingState) {
      window.XMApp.setPlayingState(playing);
    }
    if (window.XMBackground) {
      window.XMBackground.setPlaybackState(playing);
    }
    updateDocumentTitle(playing);
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
        audioEl.play().then(() => notifyPlayState(true)).catch(() => notifyPlayState(false));
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

  function togglePlayPause() {
    setPaused(isPlaying());
  }

  function stopPlayback() {
    audioEl.pause();
    try {
      audioEl.currentTime = 0;
    } catch (e) {}
    player.stop();
    notifyPlayState(false);
    if (window.XMApp) window.XMApp.onTrackEnded();
  }

  function seekTo(targetSec) {
    if (isNativeStream) {
      if (audioEl.duration && !isNaN(audioEl.duration)) {
        audioEl.currentTime = targetSec;
      }
    } else {
      player.seek(targetSec);
      if (audioEl.duration && !isNaN(audioEl.duration)) {
        try {
          audioEl.currentTime = Math.min(targetSec, audioEl.duration);
        } catch (e) {}
      }
    }
    if (window.XMBackground) window.XMBackground.updatePositionState();
  }

  function unload() {
    player.stop();
    audioEl.pause();
    audioEl.removeAttribute('src');
    audioEl.load();
    if (window.XMBackground) window.XMBackground.releaseCarrier();
    if (window.XMVisualizer) window.XMVisualizer.clearVisualizerCache();
    revokeActiveObjectUrl();
    currentRawBuffer = null;
    currentAudioBlob = null;
    currentAudioSrc = '';
    currentTrackItem = null;
    activeTitle = 'No Module Loaded';
    activeArtist = '';
    if (window.XMQueue) window.XMQueue.setQueue(null, -1);
    notifyPlayState(false);
  }

  function handoffToCompiled(blob, format, targetTrackId, visData, visFps) {
    if (!blob) return;
    const currentId = (currentTrackItem && currentTrackItem.id) || currentAudioSrc || activeTitle;
    if (targetTrackId && targetTrackId !== currentId) {
      compiledCache.set(targetTrackId, { blob, ext: (format || 'mp3').toLowerCase(), visData, visFps });
      return;
    }

    const wasPlaying = isPlaying();
    const curPos = getPosition();

    isNativeStream = true;
    currentAudioBlob = blob;
    currentExt = (format || 'mp3').toLowerCase();

    revokeActiveObjectUrl();
    activeObjectUrl = URL.createObjectURL(blob);
    audioEl.src = activeObjectUrl;
    audioEl.loop = window.XMQueue ? window.XMQueue.isLooping : true;
    connectNativeSource();

    compiledCache.set(currentId, { blob, ext: currentExt, url: activeObjectUrl, visData, visFps });
    if (visData && window.XMVisualizer) window.XMVisualizer.setVisualizerCache(visData, visFps);

    const onCanPlay = () => {
      const livePos = (player.currentPlayingNode && !player.currentPlayingNode.paused) ? player.getPosition() : curPos;
      if (livePos > 0 && isFinite(livePos)) {
        try {
          audioEl.currentTime = Math.min(livePos, audioEl.duration || livePos);
        } catch (e) {}
      }
      if (wasPlaying) {
        audioEl.play().then(() => {
          player.stop();
          notifyPlayState(true);
        }).catch(() => {
          player.stop();
          notifyPlayState(false);
        });
      } else {
        player.stop();
        notifyPlayState(false);
      }
      if (window.XMBackground) {
        window.XMBackground.updateMetadata(activeTitle, activeArtist);
        window.XMBackground.updatePositionState();
      }
    };

    if (audioEl.readyState >= 3) {
      onCanPlay();
    } else {
      audioEl.addEventListener('canplay', onCanPlay, { once: true });
    }

    const trackNum = window.XMQueue ? window.XMQueue.getTrackNum() : 1;
    if (window.XMApp && window.XMApp.updateTrackUI) {
      window.XMApp.updateTrackUI(activeTitle, activeArtist, currentExt.toUpperCase(), '2 CH', true, trackNum);
    }
  }

  function loadTrack(fileOrUrl, fallbackName, trackItemRef, queue, queueIdx) {
    const loadId = ++currentLoadId;
    const extMatch = (fallbackName || '').toLowerCase().match(/\.[a-z0-9]+$/);
    const ext = extMatch ? extMatch[0] : '';
    currentExt = ext ? ext.replace('.', '').toLowerCase() : 'xm';

    player.unlock();
    player.stop();

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
    if (window.XMApp) window.XMApp.updateTrackUI(targetTitle, targetArtist, currentExt.toUpperCase() || 'AUDIO', '--', false, trackNum);

    const cacheKey = (trackItemRef && trackItemRef.id) || currentAudioSrc || targetTitle;
    if (compiledCache.has(cacheKey)) {
      const cached = compiledCache.get(cacheKey);
      isNativeStream = true;
      currentAudioBlob = cached.blob;
      currentExt = cached.ext;
      activeObjectUrl = cached.url || URL.createObjectURL(cached.blob);
      audioEl.src = activeObjectUrl;
      audioEl.loop = window.XMQueue ? window.XMQueue.isLooping : true;
      connectNativeSource();
      if (cached.visData && window.XMVisualizer) window.XMVisualizer.setVisualizerCache(cached.visData, cached.visFps);
      if (window.XMBackground) {
        window.XMBackground.updateMetadata(targetTitle, targetArtist);
        window.XMBackground.setPlaybackState(true);
      }
      audioEl.play().then(() => notifyPlayState(true)).catch(() => notifyPlayState(false));
      if (window.XMApp) window.XMApp.updateTrackUI(targetTitle, targetArtist, currentExt.toUpperCase(), '2 CH', true, trackNum);
      return;
    }

    if (NATIVE_STREAM_EXTS.has(ext)) {
      isNativeStream = true;
      currentAudioBlob = (fileOrUrl instanceof File || fileOrUrl instanceof Blob) ? fileOrUrl : null;
      activeObjectUrl = currentAudioBlob ? URL.createObjectURL(currentAudioBlob) : null;
      audioEl.src = activeObjectUrl || fileOrUrl;
      audioEl.loop = window.XMQueue ? window.XMQueue.isLooping : true;
      connectNativeSource();
      if (window.XMBackground) {
        window.XMBackground.updateMetadata(targetTitle, targetArtist);
        window.XMBackground.setPlaybackState(true);
      }
      audioEl.play().then(() => notifyPlayState(true)).catch(() => notifyPlayState(false));
      if (window.XMApp) window.XMApp.updateTrackUI(targetTitle, targetArtist, currentExt.toUpperCase(), '2 CH', true, trackNum);
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
      if (window.XMApp) window.XMApp.updateTrackUI(targetTitle, targetArtist, engineName, `${meta.channels || 8} CH`, false, trackNum);
    }, () => {
      if (loadId !== currentLoadId) return;
      notifyPlayState(false);
      if (window.XMApp) window.XMApp.updateTrackUI(targetTitle + ' (Load Failed)', targetArtist, 'ERROR', '--', false, 0);
    });
  }

  audioEl.addEventListener('loadedmetadata', () => {
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