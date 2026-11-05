/**
 * js/engine/background.js - Mobile background audio keep-alive and Chrome MediaSession coordinator.
 */
(function(window) {
  let activeCarrierUrl = null;
  let cachedCarrierBlob = null;
  let cachedPngUrl = null;
  let isActive = false;

  function getCarrierBlob(durationSec) {
    const dur = Math.max(10, Math.ceil(durationSec || 180));
    if (cachedCarrierBlob && cachedCarrierBlob._dur >= dur) {
      return cachedCarrierBlob;
    }

    const sampleRate = 8000;
    const numSamples = dur * sampleRate;
    const dataBytes = numSamples * 2;
    const buffer = new ArrayBuffer(44 + dataBytes);
    const view = new DataView(buffer);

    function writeStr(offset, str) {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
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

    cachedCarrierBlob = new Blob([buffer], { type: 'audio/wav' });
    cachedCarrierBlob._dur = dur;
    return cachedCarrierBlob;
  }

  function getAudioElement() {
    return document.getElementById('nativeAudio');
  }

  function getIconPngUrl() {
    if (cachedPngUrl) return cachedPngUrl;
    try {
      const c = document.createElement('canvas');
      c.width = 192;
      c.height = 192;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#080b09';
      ctx.fillRect(0, 0, 192, 192);
      ctx.strokeStyle = 'rgba(34, 197, 94, 0.35)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(96, 96, 60, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#22c55e';
      ctx.beginPath();
      ctx.moveTo(82, 68);
      ctx.lineTo(130, 96);
      ctx.lineTo(82, 124);
      ctx.closePath();
      ctx.fill();
      cachedPngUrl = c.toDataURL('image/png');
      return cachedPngUrl;
    } catch (e) {
      return null;
    }
  }

  function mountCarrier(durationSec, positionSec, shouldPlay) {
    const audioEl = getAudioElement();
    if (!audioEl) return;

    if (!activeCarrierUrl) {
      const blob = getCarrierBlob(durationSec || 180);
      activeCarrierUrl = URL.createObjectURL(blob);
    }

    if (audioEl.src !== activeCarrierUrl) {
      audioEl.src = activeCarrierUrl;
      audioEl.loop = true;
    }

    const onReady = () => {
      if (positionSec > 0 && isFinite(positionSec)) {
        try {
          audioEl.currentTime = Math.min(positionSec, audioEl.duration || positionSec);
        } catch (e) {}
      }
      if (shouldPlay && audioEl.paused) {
        audioEl.play().then(() => {
          if ('mediaSession' in navigator) {
            navigator.mediaSession.playbackState = 'playing';
          }
          updatePositionState();
        }).catch(() => {});
      }
    };

    if (audioEl.readyState >= 1) {
      onReady();
    } else {
      audioEl.addEventListener('loadedmetadata', onReady, { once: true });
    }

    if (shouldPlay && audioEl.paused) {
      audioEl.play().then(() => {
        if ('mediaSession' in navigator) {
          navigator.mediaSession.playbackState = 'playing';
        }
        updatePositionState();
      }).catch(() => {});
    }
  }

  function releaseCarrier() {
    const audioEl = getAudioElement();
    if (audioEl && activeCarrierUrl && audioEl.src === activeCarrierUrl) {
      audioEl.pause();
    }
  }

  function unlock() {
    const audioEl = getAudioElement();
    if (isActive && audioEl && audioEl.paused && audioEl.src) {
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
      const iconSvg = new URL('icon.svg', window.location.href).href;
      const pngUrl = getIconPngUrl();
      const artwork = [];
      if (pngUrl) {
        artwork.push({ src: pngUrl, sizes: '192x192', type: 'image/png' });
        artwork.push({ src: pngUrl, sizes: '512x512', type: 'image/png' });
      }
      artwork.push({ src: iconSvg, sizes: '512x512', type: 'image/svg+xml' });

      navigator.mediaSession.metadata = new MediaMetadata({
        title: title || 'Untitled Track',
        artist: artist || 'XM-Studio',
        album: 'XM-Studio DSP Workstation',
        artwork: artwork
      });
    } catch (e) {}
  }

  function updatePositionState() {
    if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState || !window.XMAudio) return;
    try {
      const dur = window.XMAudio.getDuration();
      const pos = window.XMAudio.getPosition();
      if (dur > 0 && isFinite(dur)) {
        const safePos = Math.max(0, Math.min(dur, Number(pos) || 0));
        navigator.mediaSession.setPositionState({
          duration: dur,
          playbackRate: 1.0,
          position: safePos
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
      ['seekto', (d) => {
        if (window.XMAudio && d && typeof d.seekTime === 'number') {
          window.XMAudio.seekTo(d.seekTime);
          updatePositionState();
        }
      }],
      ['seekbackward', (d) => {
        if (window.XMAudio) {
          const off = (d && d.seekOffset) || 10;
          window.XMAudio.seekTo(Math.max(0, window.XMAudio.getPosition() - off));
          updatePositionState();
        }
      }],
      ['seekforward', (d) => {
        if (window.XMAudio) {
          const off = (d && d.seekOffset) || 10;
          const dur = window.XMAudio.getDuration();
          window.XMAudio.seekTo(Math.min(dur || 0, window.XMAudio.getPosition() + off));
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
    if (window.XMAudio && window.XMAudio.isPlaying()) unlock();
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