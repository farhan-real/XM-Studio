/**
 * js/engine/export/precompiler.js - Lookahead playlist precompiler with battery and priority throttling.
 */
(function(window) {
  let isRunning = false;
  let currentPrecompileTrackId = null;
  let scheduleTimer = null;
  let abortController = null;
  const LOOKAHEAD_COUNT = 2;
  const NATIVE_EXTS = new Set(['mp3', 'ogg', 'wav', 'flac', 'aac', 'm4a', 'weba']);

  function isTrackerTrack(track) {
    if (!track) return false;
    const ext = (track.ext || '').replace(/^\./, '').toLowerCase();
    if (ext && NATIVE_EXTS.has(ext)) return false;
    return true;
  }

  async function resolveTrackBuffer(track) {
    if (!track) return null;
    if (track.isCustom || track.isFolderTrack) {
      let blob = track.blob;
      if (!blob && window.XMCustom) blob = await window.XMCustom.getTrackBlob(track.id);
      if (blob) return await blob.arrayBuffer();
    }
    const resolvedUrl = track.url || (track.path ? (track.path.startsWith('http') ? track.path : 'https://farhan-real.github.io/XM-Music/' + encodeURI(track.path.replace(/^\/+/, ''))) : null);
    if (!resolvedUrl) return null;

    const res = await fetch(resolvedUrl, { signal: abortController ? abortController.signal : undefined });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.arrayBuffer();
  }

  async function checkBatteryAllowPrecompile() {
    try {
      if ('getBattery' in navigator) {
        const b = await navigator.getBattery();
        if (!b.charging && b.level < 0.15) return false;
      }
    } catch (e) {}
    return true;
  }

  async function runCycle() {
    if (isRunning || document.hidden) return;
    if (!window.AudioCompiler || window.AudioCompiler.isCompilingActive) return;
    if (!window.XMQueue) return;

    const allowed = await checkBatteryAllowPrecompile();
    if (!allowed) return;

    const upcoming = window.XMQueue.getUpcomingTracks(LOOKAHEAD_COUNT);
    if (!upcoming || upcoming.length === 0) return;

    let targetTrack = null;
    for (let i = 0; i < upcoming.length; i++) {
      const t = upcoming[i];
      if (t && t.id && isTrackerTrack(t) && (!window.XMCache || !window.XMCache.has(t.id, 'mp3'))) {
        targetTrack = t;
        break;
      }
    }

    if (!targetTrack) return;

    isRunning = true;
    currentPrecompileTrackId = targetTrack.id;
    abortController = new AbortController();

    try {
      const buf = await resolveTrackBuffer(targetTrack);
      if (!buf || currentPrecompileTrackId !== targetTrack.id) {
        isRunning = false;
        return;
      }

      if (window.AudioCompiler.isCompilingActive) {
        isRunning = false;
        return;
      }

      const qId = window.XMQueue.getQueueId();
      const fallbackEngine = (targetTrack.ext || 'XM').replace(/^\./, '').toUpperCase();
      window.AudioCompiler.compilePreload(
        buf,
        'mp3',
        targetTrack.id,
        (blob, visData, visFps, duration, engine, channels) => {
          isRunning = false;
          currentPrecompileTrackId = null;
          if (window.XMCache && blob) {
            window.XMCache.set(
              targetTrack.id,
              'mp3',
              blob,
              visData,
              visFps,
              duration,
              qId,
              engine || fallbackEngine,
              channels || ''
            );
          }
          schedule(400);
        },
        () => {
          isRunning = false;
          currentPrecompileTrackId = null;
        }
      );
    } catch (err) {
      isRunning = false;
      currentPrecompileTrackId = null;
    }
  }

  function schedule(delayMs = 600) {
    cancelSchedule();
    scheduleTimer = setTimeout(() => runCycle(), delayMs);
  }

  function cancelSchedule() {
    if (scheduleTimer) {
      clearTimeout(scheduleTimer);
      scheduleTimer = null;
    }
  }

  function cancel() {
    cancelSchedule();
    if (abortController) {
      try { abortController.abort(); } catch (e) {}
      abortController = null;
    }
    if (isRunning && window.AudioCompiler && window.AudioCompiler.isPreload) {
      window.AudioCompiler.cancel();
    }
    isRunning = false;
    currentPrecompileTrackId = null;
  }

  function init() {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) cancel();
      else schedule(1000);
    });

    const audioEl = document.getElementById('nativeAudio');
    if (audioEl) {
      audioEl.addEventListener('play', () => schedule(1500));
    }
  }

  window.XMPrecompiler = {
    init,
    schedule,
    cancel,
    onActiveCompileComplete: () => schedule(600),
    onTrackLoaded: () => schedule(1200),
    isPrecompiling: () => isRunning,
    getCurrentTrackId: () => currentPrecompileTrackId
  };
})(window);