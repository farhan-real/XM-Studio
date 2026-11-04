/**
 * js/engine/queue.js - Dedicated queue navigation, history, and shuffle/loop coordinator.
 */
(function(window) {
  let isLooping = true;
  let isShuffle = false;
  let currentQueue = null;
  let currentQueueIdx = -1;
  let currentTrackNum = 0;

  function setQueue(queue, idx) {
    currentQueue = queue || null;
    currentQueueIdx = (idx !== undefined) ? idx : -1;
    currentTrackNum = (typeof idx === 'number' && idx >= 0) ? (idx + 1) : 1;
  }

  function getQueue() { return currentQueue; }
  function getIndex() { return currentQueueIdx; }
  function getTrackNum() { return currentTrackNum; }

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
    if (item.isCustom || item.isFolderTrack) {
      let blob = item.blob;
      if (!blob && window.XMCustom) blob = await window.XMCustom.getTrackBlob(item.id);
      if (blob) {
        window.XMAudio.loadTrack(blob, `${item.artist} - ${item.title}.${(item.ext || 'xm').toLowerCase()}`, item, currentQueue, idx);
        return;
      }
    }
    window.XMAudio.loadTrack(resolveTrackUrl(item), `${item.artist} - ${item.title}.${(item.ext || 'xm').toLowerCase()}`, item, currentQueue, idx);
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
    if (window.XMAudio) window.XMAudio.notifyPlayState(false);
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
    if (window.XMLibrary && window.XMLibrary.playRandomArchiveTrack) {
      window.XMLibrary.playRandomArchiveTrack();
      return;
    }
    let pool = currentQueue || (window.XMLibrary && window.XMLibrary.getDisplayCatalog ? window.XMLibrary.getDisplayCatalog() : null);
    if (!pool || pool.length === 0) return;
    let randIdx = Math.floor(Math.random() * pool.length);
    if (pool.length > 1 && randIdx === currentQueueIdx && pool === currentQueue) randIdx = (randIdx + 1) % pool.length;
    if (pool === currentQueue) playTrackAt(randIdx);
    else if (window.XMLibrary && window.XMLibrary.playTrackDirect) window.XMLibrary.playTrackDirect(pool[randIdx], pool, randIdx);
  }

  function toggleLoop() {
    isLooping = !isLooping;
    if (window.XMAudio) {
      window.XMAudio.audioEl.loop = isLooping;
      window.XMAudio.player.setRepeat(isLooping);
    }
    return isLooping;
  }

  function toggleShuffle() {
    isShuffle = !isShuffle;
    return isShuffle;
  }

  window.XMQueue = {
    setQueue,
    getQueue,
    getIndex,
    getTrackNum,
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