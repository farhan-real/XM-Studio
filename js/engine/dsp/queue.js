/**
 * js/engine/dsp/queue.js - Dedicated queue navigation, shuffle sequence, and lookahead preview coordinator.
 */
(function(window) {
  let isLooping = false;
  let isShuffle = false;

  try {
    isLooping = localStorage.getItem('xm_loop') === '1';
    isShuffle = localStorage.getItem('xm_shuffle') === '1';
  } catch (e) {}

  let currentQueue = null;
  let currentQueueIdx = -1;
  let currentTrackNum = 0;
  let currentQueueId = null;
  let shuffleSequence = [];
  let shufflePos = 0;

  function rebuildShuffleSequence() {
    if (!currentQueue || currentQueue.length === 0) {
      shuffleSequence = [];
      shufflePos = 0;
      return;
    }
    const indices = [];
    for (let i = 0; i < currentQueue.length; i++) {
      if (i !== currentQueueIdx) indices.push(i);
    }
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const temp = indices[i];
      indices[i] = indices[j];
      indices[j] = temp;
    }
    shuffleSequence = indices;
    shufflePos = 0;
  }

  function setQueue(queue, idx, queueId) {
    currentQueue = queue || null;
    currentQueueIdx = (idx !== undefined) ? idx : -1;
    currentQueueId = queueId || (queue && queue._playlistId) || null;
    const cur = (queue && typeof idx === 'number' && queue[idx]) ? queue[idx] : null;
    currentTrackNum = (cur && cur.catalogIndex) ? cur.catalogIndex : ((typeof idx === 'number' && idx >= 0) ? (idx + 1) : 0);
    rebuildShuffleSequence();
  }

  function getQueue() { return currentQueue; }
  function getIndex() { return currentQueueIdx; }
  function getTrackNum() { return currentTrackNum; }
  function getQueueId() { return currentQueueId; }

  function getUpcomingTracks(count = 2) {
    if (!currentQueue || currentQueue.length <= 1) return [];
    const targetCount = Math.min(count, currentQueue.length - 1);
    const upcoming = [];
    if (isShuffle) {
      if (shuffleSequence.length === 0 || shufflePos >= shuffleSequence.length) {
        rebuildShuffleSequence();
      }
      for (let i = 0; i < targetCount; i++) {
        const idx = shuffleSequence[(shufflePos + i) % shuffleSequence.length];
        if (currentQueue[idx]) upcoming.push(currentQueue[idx]);
      }
    } else {
      for (let i = 1; i <= targetCount; i++) {
        const idx = (currentQueueIdx + i) % currentQueue.length;
        if (currentQueue[idx]) upcoming.push(currentQueue[idx]);
      }
    }
    return upcoming;
  }

  function resolveTrackUrl(item) {
    if (item.url) return item.url;
    if (!item.path) return null;
    if (item.path.startsWith('http://') || item.path.startsWith('https://')) return item.path;
    return 'https://farhan-real.github.io/XM-Music/' + encodeURI(item.path.replace(/^\/+/, ''));
  }

  async function playTrackAt(idx) {
    if (!currentQueue || idx < 0 || idx >= currentQueue.length) return;
    if (window.XMAudio && window.XMAudio.player) window.XMAudio.player.unlock();
    const item = currentQueue[idx];
    currentTrackNum = item.catalogIndex ? item.catalogIndex : (idx + 1);
    if (item.isCustom || item.isFolderTrack) {
      let blob = item.blob;
      if (!blob && window.XMCustom) blob = await window.XMCustom.getTrackBlob(item.id);
      if (blob) {
        window.XMAudio.loadTrack(blob, `${item.artist} - ${item.title}.${(item.ext || 'xm').toLowerCase()}`, item, currentQueue, idx);
        return;
      }
    }
    const targetUrl = resolveTrackUrl(item);
    window.XMAudio.loadTrack(targetUrl, `${item.artist} - ${item.title}.${(item.ext || 'xm').toLowerCase()}`, item, currentQueue, idx);
  }

  function ensureQueue() {
    if (!currentQueue || currentQueue.length === 0) {
      if (window.XMLibrary && window.XMLibrary.getDisplayCatalog) {
        const cat = window.XMLibrary.getDisplayCatalog();
        if (cat && cat.length > 0) {
          currentQueue = cat;
          currentQueueIdx = -1;
          currentQueueId = cat._playlistId || null;
          rebuildShuffleSequence();
        }
      }
    }
  }

  function playNextTrack(force) {
    if (isLooping && !force && !isShuffle) return;
    ensureQueue();
    if (currentQueue && currentQueue.length > 0) {
      if (isShuffle) {
        if (shuffleSequence.length === 0 || shufflePos >= shuffleSequence.length) {
          rebuildShuffleSequence();
        }
        if (shuffleSequence.length > 0) {
          const nextIdx = shuffleSequence[shufflePos % shuffleSequence.length];
          shufflePos = (shufflePos + 1) % shuffleSequence.length;
          playTrackAt(nextIdx);
          return;
        }
      }
      playTrackAt(currentQueueIdx >= 0 && currentQueueIdx + 1 < currentQueue.length ? currentQueueIdx + 1 : 0);
      return;
    }
    if (window.XMAudio) window.XMAudio.notifyPlayState(false);
    if (window.XMApp) window.XMApp.onTrackEnded();
  }

  function playPrevTrack() {
    ensureQueue();
    if (!currentQueue || currentQueue.length === 0) return;
    if (isShuffle) {
      if (shuffleSequence.length > 0) {
        shufflePos = (shufflePos - 1 + shuffleSequence.length) % shuffleSequence.length;
        playTrackAt(shuffleSequence[shufflePos]);
        return;
      }
    }
    playTrackAt(currentQueueIdx > 0 ? currentQueueIdx - 1 : currentQueue.length - 1);
  }

  function playRandomTrack() {
    ensureQueue();
    let pool = currentQueue;
    if (!pool || pool.length === 0) {
      pool = (window.XMLibrary && window.XMLibrary.getFullCatalog) ? window.XMLibrary.getFullCatalog() : null;
    }
    if (!pool || pool.length === 0) return false;

    let randIdx = Math.floor(Math.random() * pool.length);
    if (pool.length > 1 && randIdx === currentQueueIdx && pool === currentQueue) {
      randIdx = (randIdx + 1) % pool.length;
    }
    if (pool === currentQueue) {
      playTrackAt(randIdx);
      return true;
    }
    if (window.XMLibrary && window.XMLibrary.playTrackDirect) {
      window.XMLibrary.playTrackDirect(pool[randIdx], pool, randIdx);
      return true;
    }
    return false;
  }

  function toggleLoop() {
    isLooping = !isLooping;
    if (isLooping && isShuffle) {
      isShuffle = false;
      try { localStorage.setItem('xm_shuffle', '0'); } catch (e) {}
    }
    try { localStorage.setItem('xm_loop', isLooping ? '1' : '0'); } catch (e) {}
    if (window.XMAudio) {
      window.XMAudio.audioEl.loop = isLooping;
      window.XMAudio.player.setRepeat(isLooping);
    }
    return isLooping;
  }

  function toggleShuffle() {
    isShuffle = !isShuffle;
    if (isShuffle && isLooping) {
      isLooping = false;
      try { localStorage.setItem('xm_loop', '0'); } catch (e) {}
      if (window.XMAudio) {
        window.XMAudio.audioEl.loop = false;
        window.XMAudio.player.setRepeat(false);
      }
    }
    try { localStorage.setItem('xm_shuffle', isShuffle ? '1' : '0'); } catch (e) {}
    rebuildShuffleSequence();
    return isShuffle;
  }

  window.XMQueue = {
    setQueue,
    getQueue,
    getIndex,
    getTrackNum,
    getQueueId,
    getUpcomingTracks,
    playTrackAt,
    playNextTrack,
    playPrevTrack,
    playRandomTrack,
    toggleLoop,
    toggleShuffle,
    get isLooping() { return isLooping; },
    get isShuffle() { return isShuffle; }
  };
})(window);