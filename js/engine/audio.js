/**
 * js/engine/audio.js - Master playback coordinator with FLAC lossless stream support.
 */
(function(window) {
  const player = new ChiptuneJsPlayer();
  const audioEl = document.getElementById('nativeAudio');

  let currentRawBuffer = null;
  let isNativeStream = false;
  let nativeAudioSource = null;
  let activeTitle = "No Module Loaded";
  let activeArtist = "";
  let currentLoadId = 0;

  let isLooping = true;
  let isShuffle = false;
  let currentQueue = null;
  let currentQueueIdx = -1;

  const NATIVE_STREAM_EXTS = ['.mp3', '.ogg', '.wav', '.flac'];

  function routeNativeAudioToWebAudio() {
    if (!nativeAudioSource && player.context) {
      try {
        nativeAudioSource = player.context.createMediaElementSource(audioEl);
        nativeAudioSource.connect(player.gainNode);
      } catch (e) {}
    }
  }

  function getFileExtension(filename) {
    const match = (filename || '').toLowerCase().match(/\.[a-z0-9]+$/);
    return match ? match[0] : '';
  }

  function parseTrackInfo(filename, internalMeta) {
    internalMeta = internalMeta || {};
    let base = filename.replace(/\.[a-z0-9]+$/i, '').trim();
    if (base.includes('_-_')) base = base.replace(/_-_/g, ' - ').replace(/_/g, ' ');
    else if (!base.includes(' ') && base.includes('_')) base = base.replace(/_/g, ' ');

    let rawArtist = (internalMeta.artist || '').trim();
    let rawTitle = (internalMeta.title || '').trim();

    const match = base.match(/^(.+?)\s+[-–—]\s+(.+)$/);
    if (match) {
      if (!rawArtist) rawArtist = match[1].trim();
      if (!rawTitle) rawTitle = match[2].trim();
    } else {
      if (!rawTitle) rawTitle = base;
      if (!rawArtist) rawArtist = internalMeta.type_long || "FastTracker II";
    }

    return {
      artist: rawArtist || "Unknown Artist",
      title: rawTitle || "Untitled Track"
    };
  }

  async function playTrackAt(idx) {
    if (!currentQueue || idx < 0 || idx >= currentQueue.length) return;
    const item = currentQueue[idx];
    if (item.isCustom) {
      let blob = item.blob;
      if (!blob && window.XMCustom) blob = await window.XMCustom.getTrackBlob(item.id);
      if (blob) {
        loadTrack(blob, `${item.artist} - ${item.title}.${(item.ext || 'xm').toLowerCase()}`, item, currentQueue, idx);
        return;
      }
    }
    const baseUrl = window.XMLibrary ? window.XMLibrary.getBaseUrl() : 'https://farhan-real.github.io/XM-Music/';
    const fullUrl = item.path ? `${baseUrl}${item.path}` : (item.url || null);
    loadTrack(fullUrl, `${item.artist} - ${item.title}.${(item.ext || 'xm').toLowerCase()}`, item, currentQueue, idx);
  }

  function playNextTrack() {
    if (isLooping) return;

    if (currentQueue && currentQueue.length > 0) {
      if (isShuffle) {
        let randIdx = Math.floor(Math.random() * currentQueue.length);
        if (currentQueue.length > 1 && randIdx === currentQueueIdx) {
          randIdx = (randIdx + 1) % currentQueue.length;
        }
        playTrackAt(randIdx);
        return;
      }

      if (currentQueueIdx >= 0 && currentQueueIdx + 1 < currentQueue.length) {
        playTrackAt(currentQueueIdx + 1);
        return;
      }
    }

    if (window.XMApp) window.XMApp.onTrackEnded();
  }

  function loadTrack(fileOrUrl, fallbackName, trackItemRef, queue, queueIdx) {
    const loadId = ++currentLoadId;
    const ext = getFileExtension(fallbackName);

    player.stop();
    audioEl.pause();
    currentQueue = queue || null;
    currentQueueIdx = (queueIdx !== undefined) ? queueIdx : -1;

    if (NATIVE_STREAM_EXTS.includes(ext)) {
      isNativeStream = true;
      currentRawBuffer = null;

      if (fileOrUrl instanceof File || fileOrUrl instanceof Blob) {
        audioEl.src = URL.createObjectURL(fileOrUrl);
      } else {
        audioEl.src = fileOrUrl;
      }

      const info = parseTrackInfo(fallbackName, {});
      activeTitle = info.title;
      activeArtist = info.artist;

      routeNativeAudioToWebAudio();
      audioEl.loop = isLooping;
      audioEl.play().catch(() => {});

      if (window.XMApp) {
        window.XMApp.updateTrackUI(info.title, info.artist, ext.replace('.', '').toUpperCase(), '2 CH', true);
      }
      if (window.XMLibrary && trackItemRef) {
        window.XMLibrary.notifyPlaying(trackItemRef.id);
      }
      return;
    }

    isNativeStream = false;
    player.load(fileOrUrl, (buf) => {
      if (loadId !== currentLoadId) return;
      currentRawBuffer = buf;

      const meta = player.readMetadata(buf) || {};
      const info = parseTrackInfo(fallbackName, meta);
      activeTitle = info.title;
      activeArtist = info.artist;

      player.setRepeat(isLooping);
      player.play(buf);

      if (window.XMApp) {
        window.XMApp.updateTrackUI(info.title, info.artist, (meta.type_long || "FT2").toUpperCase(), `${meta.channels || 8} CH`, false);
      }
      if (window.XMLibrary && trackItemRef) {
        window.XMLibrary.notifyPlaying(trackItemRef.id);
      }
    });
  }

  audioEl.addEventListener('ended', playNextTrack);
  player.on('onEnded', playNextTrack);

  window.XMAudio = {
    player: player,
    audioEl: audioEl,
    get isNativeStream() { return isNativeStream; },
    get currentRawBuffer() { return currentRawBuffer; },
    isPlaying: function() {
      return isNativeStream ? (!audioEl.paused) : (player.currentPlayingNode && !player.currentPlayingNode.paused);
    },
    loadTrack: loadTrack,
    playNextTrack: playNextTrack,
    toggleLoop: function() {
      isLooping = !isLooping;
      audioEl.loop = isLooping;
      player.setRepeat(isLooping);
      return isLooping;
    },
    toggleShuffle: function() {
      isShuffle = !isShuffle;
      return isShuffle;
    },
    get isLooping() { return isLooping; },
    get isShuffle() { return isShuffle; },
    getCurrentInfo: function() {
      return { title: activeTitle, artist: activeArtist };
    }
  };
})(window);