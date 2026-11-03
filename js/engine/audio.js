/**
 * js/engine/audio.js - Master playback coordinator with exact track fidelity and instant UI sync.
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
    let base = (filename || '').replace(/\.[a-z0-9]+$/i, '').trim();
    if (base.includes('_-_')) base = base.replace(/_-_/g, ' - ').replace(/_/g, ' ');
    else if (!base.includes(' ') && base.includes('_')) base = base.replace(/_/g, ' ');

    const match = base.match(/^(.+?)\s+[-–—]\s+(.+)$/);
    let artist = '';
    let title = '';

    if (match) {
      artist = match[1].trim();
      title = match[2].trim();
    } else {
      title = (internalMeta.title || '').trim() || base;
      artist = (internalMeta.artist || '').trim();
    }

    return {
      title: title || 'Untitled Track',
      artist: artist || (internalMeta.type_long || 'FastTracker II')
    };
  }

  function resolveTrackUrl(item) {
    if (item.url) return item.url;
    if (!item.path) return null;
    if (item.path.startsWith('http://') || item.path.startsWith('https://')) return item.path;
    const baseUrl = window.XMLibrary ? window.XMLibrary.getBaseUrl() : 'https://farhan-real.github.io/XM-Music/';
    const cleanBase = baseUrl.replace(/\/+$/, '') + '/';
    const cleanPath = item.path.replace(/^\/+/, '');
    return cleanBase + encodeURI(cleanPath);
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
    const fullUrl = resolveTrackUrl(item);
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
    currentRawBuffer = null;
    currentQueue = queue || null;
    currentQueueIdx = (queueIdx !== undefined) ? queueIdx : -1;

    let targetTitle = (trackItemRef && trackItemRef.title) ? trackItemRef.title.trim() : '';
    let targetArtist = (trackItemRef && trackItemRef.artist) ? trackItemRef.artist.trim() : '';

    if (!targetTitle) {
      const parsed = parseTrackInfo(fallbackName, {});
      targetTitle = parsed.title;
      targetArtist = targetArtist || parsed.artist;
    }

    activeTitle = targetTitle;
    activeArtist = targetArtist;

    if (window.XMApp) {
      window.XMApp.updateTrackUI(targetTitle, targetArtist, ext.replace('.', '').toUpperCase() || 'AUDIO', '--', false);
    }
    if (window.XMLibrary && trackItemRef) {
      window.XMLibrary.notifyPlaying(trackItemRef.id);
    }

    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: targetTitle,
          artist: targetArtist,
          album: "XM-Studio"
        });
      } catch (e) {}
    }

    if (NATIVE_STREAM_EXTS.includes(ext)) {
      isNativeStream = true;

      if (fileOrUrl instanceof File || fileOrUrl instanceof Blob) {
        audioEl.src = URL.createObjectURL(fileOrUrl);
      } else {
        audioEl.src = fileOrUrl;
      }

      routeNativeAudioToWebAudio();
      audioEl.loop = isLooping;
      audioEl.play().catch(() => {});

      if (window.XMApp) {
        window.XMApp.updateTrackUI(targetTitle, targetArtist, ext.replace('.', '').toUpperCase(), '2 CH', true);
      }
      return;
    }

    isNativeStream = false;
    player.load(
      fileOrUrl,
      (buf) => {
        if (loadId !== currentLoadId) return;
        currentRawBuffer = buf;

        const meta = player.readMetadata(buf) || {};
        const engineName = (meta.type_long || ext.replace('.', '') || "FT2").toUpperCase();
        const channelCount = `${meta.channels || 8} CH`;

        player.setRepeat(isLooping);
        player.play(buf);

        if (window.XMApp) {
          window.XMApp.updateTrackUI(targetTitle, targetArtist, engineName, channelCount, false);
        }
      },
      (err) => {
        if (loadId !== currentLoadId) return;
        if (window.XMApp) {
          window.XMApp.updateTrackUI(targetTitle + " (Load Failed)", targetArtist, "ERROR", "--", false);
        }
      }
    );
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