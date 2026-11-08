/**
 * js/engine/dsp/queue.js - Dedicated queue navigation, shuffle sequence, and lookahead preview coordinator.
 */
(function(window) {
  let playMode = 'next';
  try {
    const saved = localStorage.getItem('xm_play_mode');
    if (['stop', 'next', 'repeat', 'shuffle'].includes(saved)) {
      playMode = saved;
    }
  } catch (err) {
    console.error('[XMQueue] Corrupted play mode in localStorage:', err);
  }

  let currentQueue = null;
  let currentQueueIdx = -1;
  let currentTrackNum = 0;
  let currentQueueId = null;
  let shuffleSequence = [];
  let shufflePos = 0;

  function isTrackPlayable(track) {
    if (!track) return false;
    if (window.XMMeta && typeof window.XMMeta.isSupportedFormat === 'function') {
      return window.XMMeta.isSupportedFormat(track);
    }
    if (!track.ext) return false;
    const e = String(track.ext).replace(/^\.+/, '').trim().toLowerCase();
    const unsupported = new Set(['v2m', 'ahx', 'sid', 'mid', 'midi', 'sap', 'ym', 'nsf', 'spc']);
    return !unsupported.has(e);
  }

  function rebuildShuffleSequence() {
    if (!currentQueue || currentQueue.length === 0) {
      shuffleSequence = [];
      shufflePos = 0;
      return;
    }
    const indices = [];
    for (let i = 0; i < currentQueue.length; i++) {
      if (i !== currentQueueIdx && isTrackPlayable(currentQueue[i])) {
        indices.push(i);
      }
    }
    if (indices.length === 0 && currentQueueIdx >= 0 && isTrackPlayable(currentQueue[currentQueueIdx])) {
      indices.push(currentQueueIdx);
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

  function setPlayMode(mode) {
    if (!['stop', 'next', 'repeat', 'shuffle'].includes(mode)) {
      throw new Error(`Unsupported play mode: "${mode}". Valid modes: stop, next, repeat, shuffle.`);
    }
    playMode = mode;
    const isLooping = (mode === 'repeat');
    const isShuffle = (mode === 'shuffle');
    localStorage.setItem('xm_play_mode', mode);

    if (window.XMAudio) {
      window.XMAudio.audioEl.loop = isLooping;
      window.XMAudio.player.setRepeat(isLooping);
    }
    if (isShuffle) rebuildShuffleSequence();
    if (window.XMApp && window.XMApp.syncPlayModeUI) window.XMApp.syncPlayModeUI(playMode);
    return playMode;
  }

  function setQueue(queue, idx, queueId) {
    currentQueue = queue ? queue : null;
    currentQueueIdx = (idx !== undefined) ? idx : -1;
    currentQueueId = queueId ? queueId : ((queue && queue._playlistId) ? queue._playlistId : null);
    const cur = (queue && typeof idx === 'number' && queue[idx]) ? queue[idx] : null;
    currentTrackNum = (cur && cur.catalogIndex) ? cur.catalogIndex : ((typeof idx === 'number' && idx >= 0) ? (idx + 1) : 0);
    rebuildShuffleSequence();
  }

  function getQueue() { return currentQueue; }
  function getIndex() { return currentQueueIdx; }
  function getTrackNum() { return currentTrackNum; }
  function getQueueId() { return currentQueueId; }

  function getUpcomingTracks(count = 2) {
    if (playMode === 'stop' || !currentQueue || currentQueue.length <= 1) return [];
    const upcoming = [];
    if (playMode === 'shuffle') {
      if (shuffleSequence.length === 0 || shufflePos >= shuffleSequence.length) {
        rebuildShuffleSequence();
      }
      for (let i = 0; i < shuffleSequence.length && upcoming.length < count; i++) {
        const idx = shuffleSequence[(shufflePos + i) % shuffleSequence.length];
        const t = currentQueue[idx];
        if (t && isTrackPlayable(t)) upcoming.push(t);
      }
    } else {
      for (let i = 1; i < currentQueue.length && upcoming.length < count; i++) {
        const idx = (currentQueueIdx + i) % currentQueue.length;
        const t = currentQueue[idx];
        if (t && isTrackPlayable(t)) upcoming.push(t);
      }
    }
    return upcoming;
  }

  function resolveTrackUrl(item) {
    if (item.url) return item.url;
    if (item.path) {
      if (item.path.startsWith('http://') || item.path.startsWith('https://')) return item.path;
      return 'https://farhan-real.github.io/XM-Music/' + encodeURI(item.path.replace(/^\/+/, ''));
    }
    throw new Error(`Track "${item.title ? item.title : item.id}" has no valid url or path defined.`);
  }

  async function playTrackAt(idx) {
    if (!currentQueue || idx < 0 || idx >= currentQueue.length) {
      throw new Error(`Cannot play track: index ${idx} out of queue bounds.`);
    }
    if (window.XMAudio && window.XMAudio.player) window.XMAudio.player.unlock();
    const item = currentQueue[idx];
    currentTrackNum = item.catalogIndex ? item.catalogIndex : (idx + 1);
    if (item.isCustom || item.isFolderTrack) {
      let blob = item.blob;
      if (!blob && window.XMCustom) blob = await window.XMCustom.getTrackBlob(item.id);
      if (!blob) throw new Error(`Custom track blob not found in IndexedDB: "${item.title}"`);
      window.XMAudio.loadTrack(blob, `${item.artist} - ${item.title}.${(item.ext ? item.ext : 'xm').toLowerCase()}`, item, currentQueue, idx);
      return;
    }
    const targetUrl = resolveTrackUrl(item);
    window.XMAudio.loadTrack(targetUrl, `${item.artist} - ${item.title}.${(item.ext ? item.ext : 'xm').toLowerCase()}`, item, currentQueue, idx);
  }

  function ensureQueue() {
    if (!currentQueue || currentQueue.length === 0) {
      if (!window.XMLibrary || !window.XMLibrary.getDisplayCatalog) {
        throw new Error('No active queue and XMLibrary display catalog is not available.');
      }
      const cat = window.XMLibrary.getDisplayCatalog();
      if (!cat || cat.length === 0) {
        throw new Error('Cannot navigate queue: Catalog is empty.');
      }
      currentQueue = cat;
      currentQueueIdx = -1;
      currentQueueId = cat._playlistId ? cat._playlistId : null;
      rebuildShuffleSequence();
    }
  }

  function playNextTrack(force) {
    if (playMode === 'repeat' && !force) {
      if (window.XMAudio) {
        window.XMAudio.seekTo(0);
        window.XMAudio.setPaused(false);
      }
      return;
    }
    if (playMode === 'stop' && !force) {
      if (window.XMAudio) window.XMAudio.stopPlayback();
      return;
    }
    ensureQueue();
    if (currentQueue && currentQueue.length > 0) {
      if (playMode === 'shuffle') {
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
      let nextIdx = (currentQueueIdx >= 0 && currentQueueIdx + 1 < currentQueue.length) ? currentQueueIdx + 1 : 0;
      let count = 0;
      while (count < currentQueue.length && !isTrackPlayable(currentQueue[nextIdx])) {
        nextIdx = (nextIdx + 1) % currentQueue.length;
        count++;
      }
      if (count < currentQueue.length) {
        playTrackAt(nextIdx);
        return;
      }
    }
    const err = new Error('Cannot play next track: No supported playable tracks in queue.');
    console.error('[XMQueue]', err);
    alert('Queue Error: ' + err.message);
  }

  function playPrevTrack() {
    ensureQueue();
    if (!currentQueue || currentQueue.length === 0) {
      const err = new Error('Cannot play previous track: Queue is empty.');
      console.error('[XMQueue]', err);
      alert('Queue Error: ' + err.message);
      return;
    }
    if (playMode === 'shuffle') {
      if (shuffleSequence.length > 0) {
        shufflePos = (shufflePos - 1 + shuffleSequence.length) % shuffleSequence.length;
        playTrackAt(shuffleSequence[shufflePos]);
        return;
      }
    }
    let prevIdx = currentQueueIdx > 0 ? currentQueueIdx - 1 : currentQueue.length - 1;
    let count = 0;
    while (count < currentQueue.length && !isTrackPlayable(currentQueue[prevIdx])) {
      prevIdx = prevIdx > 0 ? prevIdx - 1 : currentQueue.length - 1;
      count++;
    }
    if (count < currentQueue.length) {
      playTrackAt(prevIdx);
      return;
    }
    const err = new Error('Cannot play previous track: No supported playable tracks in queue.');
    console.error('[XMQueue]', err);
    alert('Queue Error: ' + err.message);
  }

  function playRandomTrack() {
    ensureQueue();
    if (!currentQueue || currentQueue.length === 0) {
      const err = new Error('No tracks available in queue or catalog to select randomly.');
      console.error('[XMQueue]', err);
      alert('Random Play Error: ' + err.message);
      return false;
    }

    const playableIndices = [];
    for (let i = 0; i < currentQueue.length; i++) {
      if (isTrackPlayable(currentQueue[i])) playableIndices.push(i);
    }

    if (playableIndices.length === 0) {
      const err = new Error('No supported playable tracks available to select randomly.');
      console.error('[XMQueue]', err);
      alert('Random Play Error: ' + err.message);
      return false;
    }

    let candidates = playableIndices;
    if (playableIndices.length > 1 && currentQueueIdx >= 0) {
      const withoutCurrent = playableIndices.filter((idx) => idx !== currentQueueIdx);
      if (withoutCurrent.length > 0) candidates = withoutCurrent;
    }

    const chosenIdx = candidates[Math.floor(Math.random() * candidates.length)];
    playTrackAt(chosenIdx);
    return true;
  }

  function toggleLoop() {
    return setPlayMode(playMode === 'repeat' ? 'next' : 'repeat') === 'repeat';
  }

  function toggleShuffle() {
    return setPlayMode(playMode === 'shuffle' ? 'next' : 'shuffle') === 'shuffle';
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
    setPlayMode,
    toggleLoop,
    toggleShuffle,
    isTrackPlayable,
    get playMode() { return playMode; },
    get isLooping() { return playMode === 'repeat'; },
    get isShuffle() { return playMode === 'shuffle'; }
  };
})(window);