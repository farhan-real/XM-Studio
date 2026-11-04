/**
 * js/engine/background.js - Mobile background audio keep-alive and MediaSession controller.
 */
(function(window) {
  let keepAliveAudio = null;
  let keepAliveUrl = null;
  let isActive = false;

  function createSilentWavUrl() {
    if (keepAliveUrl) return keepAliveUrl;
    const sampleRate = 8000;
    const numSamples = sampleRate;
    const dataBytes = numSamples * 2;
    const buffer = new ArrayBuffer(44 + dataBytes);
    const view = new DataView(buffer);

    function writeStr(offset, str) {
      for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    }

    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + dataBytes, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeStr(36, 'data');
    view.setUint32(40, dataBytes, true);

    // 1-LSB alternating value prevents mobile OS zero-amplitude stream killers while remaining completely inaudible
    for (let i = 0; i < numSamples; i++) {
      view.setInt16(44 + i * 2, (i & 1) ? 1 : -1, true);
    }

    keepAliveUrl = URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
    return keepAliveUrl;
  }

  function ensureKeepAliveElement() {
    if (keepAliveAudio) return keepAliveAudio;
    keepAliveAudio = document.createElement('audio');
    keepAliveAudio.src = createSilentWavUrl();
    keepAliveAudio.loop = true;
    keepAliveAudio.preload = 'auto';
    keepAliveAudio.volume = 0.01;
    keepAliveAudio.setAttribute('playsinline', '');
    keepAliveAudio.setAttribute('webkit-playsinline', '');
    return keepAliveAudio;
  }

  function unlock() {
    const el = ensureKeepAliveElement();
    if (isActive && el.paused) {
      el.play().catch(() => {});
    }
  }

  function setPlaybackState(playing) {
    isActive = Boolean(playing);
    const el = ensureKeepAliveElement();

    if (isActive) {
      if (el.paused) el.play().catch(() => {});
      if (window.XMAudio && window.XMAudio.player) {
        window.XMAudio.player.unlock();
      }
    } else if (!el.paused) {
      el.pause();
    }

    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.playbackState = isActive ? 'playing' : 'paused';
      } catch (e) {}
    }
    updatePositionState();
  }

  function updateMetadata(title, artist) {
    if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
    try {
      const iconUrl = new URL('icon.svg', window.location.href).href;
      navigator.mediaSession.metadata = new MediaMetadata({
        title: title || 'Untitled Track',
        artist: artist || 'XM-Studio',
        album: 'XM-Studio',
        artwork: [
          { src: iconUrl, sizes: '96x96', type: 'image/svg+xml' },
          { src: iconUrl, sizes: '192x192', type: 'image/svg+xml' },
          { src: iconUrl, sizes: '512x512', type: 'image/svg+xml' }
        ]
      });
    } catch (e) {}
  }

  function updatePositionState() {
    if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState || !window.XMAudio) return;
    try {
      const dur = window.XMAudio.getDuration();
      const pos = window.XMAudio.getPosition();
      if (dur > 0 && isFinite(dur)) {
        navigator.mediaSession.setPositionState({
          duration: dur,
          playbackRate: 1.0,
          position: Math.max(0, Math.min(dur, pos || 0))
        });
      }
    } catch (e) {}
  }

  function bindMediaSessionHandlers() {
    if (!('mediaSession' in navigator)) return;
    const actions = [
      ['play', () => { if (window.XMAudio) window.XMAudio.setPaused(false); }],
      ['pause', () => { if (window.XMAudio) window.XMAudio.setPaused(true); }],
      ['previoustrack', () => { if (window.XMAudio) window.XMAudio.playPrevTrack(); }],
      ['nexttrack', () => { if (window.XMAudio) window.XMAudio.playNextTrack(true); }],
      ['stop', () => { if (window.XMAudio) window.XMAudio.stopPlayback(); }],
      ['seekto', (details) => {
        if (window.XMAudio && details && typeof details.seekTime === 'number') {
          window.XMAudio.seekTo(details.seekTime);
          updatePositionState();
        }
      }],
      ['seekbackward', (details) => {
        if (window.XMAudio) {
          const offset = (details && details.seekOffset) || 10;
          window.XMAudio.seekTo(Math.max(0, window.XMAudio.getPosition() - offset));
          updatePositionState();
        }
      }],
      ['seekforward', (details) => {
        if (window.XMAudio) {
          const offset = (details && details.seekOffset) || 10;
          const dur = window.XMAudio.getDuration();
          window.XMAudio.seekTo(Math.min(dur || 0, window.XMAudio.getPosition() + offset));
          updatePositionState();
        }
      }]
    ];

    for (let i = 0; i < actions.length; i++) {
      try {
        navigator.mediaSession.setActionHandler(actions[i][0], actions[i][1]);
      } catch (e) {}
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (window.XMAudio && window.XMAudio.isPlaying()) {
      window.XMAudio.player.unlock();
      if (keepAliveAudio && keepAliveAudio.paused) {
        keepAliveAudio.play().catch(() => {});
      }
    }
    if (!document.hidden && window.XMApp && window.XMApp.onForegroundResume) {
      window.XMApp.onForegroundResume();
    }
  });

  bindMediaSessionHandlers();

  window.XMBackground = {
    unlock,
    setPlaybackState,
    updateMetadata,
    updatePositionState
  };
})(window);