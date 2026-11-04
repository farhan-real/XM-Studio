/**
 * js/engine/background.js - Mobile background audio keep-alive and Chrome MediaSession coordinator.
 */
(function(window) {
  let activeCarrierUrl = null;
  let isActive = false;

  function createCarrierWavBlob(durationSec) {
    const dur = Math.max(10, Math.ceil(durationSec || 180));
    const sampleRate = 8000;
    const numSamples = dur * sampleRate;
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

    // Pure zeros: completely silent, no DC offset, no 4kHz tone, zero harmonics
    return new Blob([buffer], { type: 'audio/wav' });
  }

  function getAudioElement() {
    return document.getElementById('nativeAudio');
  }

  function mountCarrier(durationSec, positionSec, shouldPlay) {
    const audioEl = getAudioElement();
    if (!audioEl) return;

    if (activeCarrierUrl) {
      URL.revokeObjectURL(activeCarrierUrl);
      activeCarrierUrl = null;
    }

    const carrierBlob = createCarrierWavBlob(durationSec);
    activeCarrierUrl = URL.createObjectURL(carrierBlob);
    audioEl.src = activeCarrierUrl;
    audioEl.loop = true;

    const onReady = () => {
      if (positionSec > 0 && isFinite(positionSec)) {
        try { audioEl.currentTime = Math.min(positionSec, audioEl.duration || positionSec); } catch (e) {}
      }
      if (shouldPlay) {
        audioEl.play().catch(() => {});
      }
    };

    if (audioEl.readyState >= 1) {
      onReady();
    } else {
      audioEl.addEventListener('loadedmetadata', onReady, { once: true });
    }
  }

  function releaseCarrier() {
    if (activeCarrierUrl) {
      URL.revokeObjectURL(activeCarrierUrl);
      activeCarrierUrl = null;
    }
  }

  function unlock() {
    const audioEl = getAudioElement();
    if (audioEl && isActive && audioEl.paused) {
      audioEl.play().catch(() => {});
    }
    if (window.XMAudio && window.XMAudio.player) {
      window.XMAudio.player.unlock();
    }
  }

  function setPlaybackState(playing) {
    isActive = Boolean(playing);
    const audioEl = getAudioElement();

    if (isActive) {
      if (audioEl && audioEl.paused && audioEl.src) {
        audioEl.play().catch(() => {});
      }
      if (window.XMAudio && window.XMAudio.player) {
        window.XMAudio.player.unlock();
      }
    } else if (audioEl && !audioEl.paused) {
      audioEl.pause();
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
        album: 'XM-Studio DSP Workstation',
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
      unlock();
    }
    if (!document.hidden && window.XMApp && window.XMApp.onForegroundResume) {
      window.XMApp.onForegroundResume();
    }
  });

  bindMediaSessionHandlers();

  window.XMBackground = {
    unlock,
    mountCarrier,
    releaseCarrier,
    setPlaybackState,
    updateMetadata,
    updatePositionState
  };
})(window);