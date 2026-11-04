/**
 * js/engine/audio.js - Master playback coordinator with seamless native MP3 handoff and Chrome media visibility.
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
  let activeTitle = "No Module Loaded";
  let activeArtist = "";
  let currentTrackItem = null;
  let currentLoadId = 0;

  let isLooping = true;
  let isShuffle = false;
  let currentQueue = null;
  let currentQueueIdx = -1;
  let currentTrackNum = 0;

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

  function routeNativeAudioToWebAudio() {
    if (!nativeAudioSource && player.context) {
      try {
        nativeAudioSource = player.context.createMediaElementSource(audioEl);
        nativeAudioSource.connect(player.gainNode);
      } catch (e) {}
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

  function getFileExtension(filename) {
    const match = (filename || '').toLowerCase().match(/\.[a-z0-9]+$/);
    return match ? match[0] : '';
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

  function resolveTrackUrl(item) {
    if (item.url) return item.url;
    if (!item.path) return null;
    if (item.path.startsWith('http://') || item.path.startsWith('https://')) return item.path;
    return 'https://farhan-real.github.io/XM-Music/' + encodeURI(item.path.replace(/^\/+/, ''));
  }

  function getDuration() {
    if (isNativeStream) return (audioEl.duration && !isNaN(audioEl.duration)) ? audioEl.duration : 0;
    return player.currentPlayingNode ? player.duration() : 0;
  }

  function getPosition() {
    if (isNativeStream) return audioEl.currentTime || 0;
    return player.currentPlayingNode ? player.getPosition() : 0;
  }

  function isPlaying() {
    return isNativeStream ? !audioEl.paused : Boolean(player.currentPlayingNode && !player.currentPlayingNode.paused);
  }

  function notifyPlayState(playing) {
    if (window.XMApp && window.XMApp.setPlayingState) window.XMApp.setPlayingState(playing);
    if (window.XMBackground) window.XMBackground.setPlaybackState(playing);
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
        audioEl.play().catch(() => {});
        notifyPlayState(true);
      }
    }
  }

  function togglePlayPause() {
    setPaused(isPlaying());
  }

  function stopPlayback() {
    audioEl.pause();
    try { audioEl.currentTime = 0; } catch (e) {}
    player.stop();
    notifyPlayState(false);
    if (window.XMApp) window.XMApp.onTrackEnded();
  }

  function seekTo(targetSec) {
    if (isNativeStream) {
      if (audioEl.duration && !isNaN(audioEl.duration)) audioEl.currentTime = targetSec;
    } else {
      player.seek(targetSec);
      if (audioEl.duration && !isNaN(audioEl.duration)) {
        try { audioEl.currentTime = Math.min(targetSec, audioEl.duration); } catch (e) {}
      }
    }
    if (window.XMBackground) window.XMBackground.updatePositionState();
  }

  async function playTrackAt(idx) {
    if (!currentQueue || idx < 0 || idx >= currentQueue.length) return;
    player.unlock();
    const item = currentQueue[idx];
    if (item.isCustom || item.isFolderTrack) {
      let blob = item.blob;
      if (!blob && window.XMCustom) blob = await window.XMCustom.getTrackBlob(item.id);
      if (blob) {
        loadTrack(blob, `${item.artist} - ${item.title}.${(item.ext || 'xm').toLowerCase()}`, item, currentQueue, idx);
        return;
      }
    }
    loadTrack(resolveTrackUrl(item), `${item.artist} - ${item.title}.${(item.ext || 'xm').toLowerCase()}`, item, currentQueue, idx);
  }

  function playNextTrack(force) {
    if (isLooping && !force) return;
    if ((!currentQueue || currentQueue.length === 0) && window.XMLibrary && window.XMLibrary.getDisplayCatalog) {
      const cat = window.XMLibrary.getDisplayCatalog();
      if (cat && cat.length > 0 && window.XMLibrary.playTrackDirect) {
        window.XMLibrary.playTrackDirect(cat[0], cat, 0);
        return;
      }
    }
    if (currentQueue && currentQueue.length > 0) {
      if (isShuffle) {
        let randIdx = Math.floor(Math.random() * currentQueue.length);
        if (currentQueue.length > 1 && randIdx === currentQueueIdx) randIdx = (randIdx + 1) % currentQueue.length;
        playTrackAt(randIdx);
        return;
      }
      playTrackAt(currentQueueIdx >= 0 && currentQueueIdx + 1 < currentQueue.length ? currentQueueIdx + 1 : 0);
      return;
    }
    notifyPlayState(false);
    if (window.XMApp) window.XMApp.onTrackEnded();
  }

  function playPrevTrack() {
    if (!currentQueue || currentQueue.length === 0) return;
    if (isShuffle) {
      let randIdx = Math.floor(Math.random() * currentQueue.length);
      if (currentQueue.length > 1 && randIdx === currentQueueIdx) randIdx = (randIdx + currentQueue.length - 1) % currentQueue.length;
      playTrackAt(randIdx);
      return;
    }
    playTrackAt(currentQueueIdx > 0 ? currentQueueIdx - 1 : currentQueue.length - 1);
  }

  function playRandomTrack() {
    let pool = currentQueue || (window.XMLibrary && window.XMLibrary.getDisplayCatalog ? window.XMLibrary.getDisplayCatalog() : null);
    if (!pool || pool.length === 0) return;
    let randIdx = Math.floor(Math.random() * pool.length);
    if (pool.length > 1 && randIdx === currentQueueIdx && pool === currentQueue) randIdx = (randIdx + 1) % pool.length;
    if (pool === currentQueue) playTrackAt(randIdx);
    else if (window.XMLibrary && window.XMLibrary.playTrackDirect) window.XMLibrary.playTrackDirect(pool[randIdx], pool, randIdx);
  }

  function unload() {
    player.stop();
    audioEl.pause();
    audioEl.removeAttribute('src');
    audioEl.load();
    if (window.XMBackground) window.XMBackground.releaseCarrier();
    revokeActiveObjectUrl();
    currentRawBuffer = null;
    currentAudioBlob = null;
    currentAudioSrc = '';
    currentTrackItem = null;
    currentTrackNum = 0;
    activeTitle = "No Module Loaded";
    activeArtist = "";
    notifyPlayState(false);
  }

  function handoffToCompiled(blob, format) {
    if (!blob) return;
    const wasPlaying = isPlaying();
    const curPos = getPosition();

    player.stop();
    if (window.XMBackground) window.XMBackground.releaseCarrier();

    isNativeStream = true;
    currentAudioBlob = blob;
    currentExt = (format || 'mp3').toLowerCase();

    revokeActiveObjectUrl();
    activeObjectUrl = URL.createObjectURL(blob);
    audioEl.src = activeObjectUrl;
    routeNativeAudioToWebAudio();
    audioEl.loop = isLooping;

    const cacheKey = (currentTrackItem && currentTrackItem.id) || currentAudioSrc || activeTitle;
    compiledCache.set(cacheKey, { blob, ext: currentExt });

    const onReady = () => {
      if (curPos > 0 && isFinite(curPos)) {
        try { audioEl.currentTime = Math.min(curPos, audioEl.duration || curPos); } catch (e) {}
      }
      if (wasPlaying) {
        audioEl.play().then(() => notifyPlayState(true)).catch(() => notifyPlayState(false));
      }
      if (window.XMBackground) window.XMBackground.updatePositionState();
    };

    if (audioEl.readyState >= 1) onReady();
    else audioEl.addEventListener('loadedmetadata', onReady, { once: true });

    if (window.XMApp && window.XMApp.updateTrackUI) {
      window.XMApp.updateTrackUI(activeTitle, activeArtist, currentExt.toUpperCase(), '2 CH', true, currentTrackNum);
    }
  }

  function loadTrack(fileOrUrl, fallbackName, trackItemRef, queue, queueIdx) {
    const loadId = ++currentLoadId;
    const ext = getFileExtension(fallbackName);
    currentExt = ext ? ext.replace('.', '').toLowerCase() : 'xm';

    player.unlock();
    player.stop();
    audioEl.pause();
    if (window.XMBackground) window.XMBackground.releaseCarrier();
    revokeActiveObjectUrl();

    currentRawBuffer = null;
    currentAudioBlob = null;
    currentAudioSrc = (typeof fileOrUrl === 'string') ? fileOrUrl : '';
    currentTrackItem = trackItemRef || null;
    currentQueue = queue || null;
    currentQueueIdx = (queueIdx !== undefined) ? queueIdx : -1;
    currentTrackNum = (typeof queueIdx === 'number' && queueIdx >= 0) ? (queueIdx + 1) : 1;

    let targetTitle = (trackItemRef && trackItemRef.title) ? trackItemRef.title.trim() : '';
    let targetArtist = (trackItemRef && trackItemRef.artist) ? trackItemRef.artist.trim() : '';
    if (!targetTitle) {
      const parsed = parseTrackInfo(fallbackName, {});
      targetTitle = parsed.title;
      targetArtist = targetArtist || parsed.artist;
    }
    activeTitle = targetTitle;
    activeArtist = targetArtist;

    if (window.XMBackground) window.XMBackground.updateMetadata(targetTitle, targetArtist);
    if (window.XMApp) window.XMApp.updateTrackUI(targetTitle, targetArtist, currentExt.toUpperCase() || 'AUDIO', '--', false, currentTrackNum);
    if (window.XMLibrary && trackItemRef) window.XMLibrary.notifyPlaying(trackItemRef.id);

    const cacheKey = (trackItemRef && trackItemRef.id) || currentAudioSrc || targetTitle;
    if (compiledCache.has(cacheKey)) {
      const cached = compiledCache.get(cacheKey);
      isNativeStream = true;
      currentAudioBlob = cached.blob;
      currentExt = cached.ext;
      activeObjectUrl = URL.createObjectURL(cached.blob);
      audioEl.src = activeObjectUrl;
      routeNativeAudioToWebAudio();
      audioEl.loop = isLooping;
      audioEl.play().then(() => notifyPlayState(true)).catch(() => notifyPlayState(false));
      if (window.XMApp) window.XMApp.updateTrackUI(targetTitle, targetArtist, currentExt.toUpperCase(), '2 CH', true, currentTrackNum);
      return;
    }

    if (NATIVE_STREAM_EXTS.has(ext)) {
      isNativeStream = true;
      if (fileOrUrl instanceof File || fileOrUrl instanceof Blob) {
        currentAudioBlob = fileOrUrl;
        activeObjectUrl = URL.createObjectURL(fileOrUrl);
        audioEl.src = activeObjectUrl;
      } else {
        audioEl.src = fileOrUrl;
      }
      routeNativeAudioToWebAudio();
      audioEl.loop = isLooping;
      audioEl.play().then(() => notifyPlayState(true)).catch(() => notifyPlayState(false));
      if (window.XMApp) window.XMApp.updateTrackUI(targetTitle, targetArtist, currentExt.toUpperCase(), '2 CH', true, currentTrackNum);
      return;
    }

    isNativeStream = false;
    player.load(fileOrUrl, (buf) => {
      if (loadId !== currentLoadId) return;
      currentRawBuffer = buf;
      player.setRepeat(isLooping);
      const node = player.play(buf);
      if (!node) {
        notifyPlayState(false);
        if (window.XMApp) window.XMApp.updateTrackUI(targetTitle + " (Load Failed)", targetArtist, "ERROR", "--", false, 0);
        return;
      }
      const meta = player.currentMetadata || {};
      const engineName = (meta.type_long || currentExt || "FT2").toUpperCase();
      routeNativeAudioToWebAudio();
      if (window.XMBackground) {
        window.XMBackground.mountCarrier(meta.duration || 180, 0, true);
      }
      notifyPlayState(true);
      if (window.XMApp) window.XMApp.updateTrackUI(targetTitle, targetArtist, engineName, `${meta.channels || 8} CH`, false, currentTrackNum);
    }, () => {
      if (loadId !== currentLoadId) return;
      notifyPlayState(false);
      if (window.XMApp) window.XMApp.updateTrackUI(targetTitle + " (Load Failed)", targetArtist, "ERROR", "--", false, 0);
    });
  }

  audioEl.addEventListener('loadedmetadata', () => {
    if (window.XMBackground) window.XMBackground.updatePositionState();
  });
  audioEl.addEventListener('ended', () => {
    if (isNativeStream) playNextTrack(false);
  });
  player.on('onEnded', () => {
    if (!isNativeStream) playNextTrack(false);
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
    get isNativeStream() { return isNativeStream; },
    get currentRawBuffer() { return currentRawBuffer; },
    get currentAudioBlob() { return currentAudioBlob; },
    get currentAudioSrc() { return currentAudioSrc; },
    getCurrentExtension: () => currentExt,
    loadTrack,
    handoffToCompiled,
    playNextTrack,
    playPrevTrack,
    playRandomTrack,
    toggleLoop: () => {
      isLooping = !isLooping;
      audioEl.loop = isLooping;
      player.setRepeat(isLooping);
      return isLooping;
    },
    toggleShuffle: () => {
      isShuffle = !isShuffle;
      return isShuffle;
    },
    get isLooping() { return isLooping; },
    get isShuffle() { return isShuffle; },
    getCurrentInfo: () => ({ title: activeTitle, artist: activeArtist, trackNum: currentTrackNum })
  };
})(window);