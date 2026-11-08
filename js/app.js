/**
 * js/app.js - Main workstation transport coordinator and deck status manager.
 */
document.addEventListener('DOMContentLoaded', () => {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js').catch((err) => {
      console.error('[App] Service worker registration failed:', err);
    });
  }

  const { player, audioEl } = window.XMAudio;
  if (window.XMVisualizer?.start) window.XMVisualizer.start(player);
  if (window.AudioCompiler?.init) window.AudioCompiler.init();
  if (window.XMCache?.init) window.XMCache.init();
  if (window.XMPrecompiler?.init) window.XMPrecompiler.init();

  let isSeeking = false, prevVolume = 0.85, lastReportedSec = -1, lastReportedTotalSec = -1, progressTimerId = null;
  let deferredInstallPrompt = null;

  const btnPlayPause = document.getElementById('btnPlayPause');
  const svgPlay = document.getElementById('svgPlay'), svgPause = document.getElementById('svgPause');
  const btnPrev = document.getElementById('btnPrev'), btnNext = document.getElementById('btnNext');
  const btnPlayRandom = document.getElementById('btnPlayRandom'), btnLocateTrack = document.getElementById('btnLocateTrack');
  const modeSwitchSlider = document.getElementById('modeSwitchSlider');
  const btnDeckFav = document.getElementById('btnDeckFav'), btnDeckAddPl = document.getElementById('btnDeckAddPl');
  const btnUnload = document.getElementById('btnUnload'), progressBar = document.getElementById('progressBar');
  const timeCurrent = document.getElementById('timeCurrent'), timeTotal = document.getElementById('timeTotal');
  const volSlider = document.getElementById('volSlider'), volPercent = document.getElementById('volPercent');
  const btnMute = document.getElementById('btnMute'), songTitle = document.getElementById('songTitle');
  const songArtist = document.getElementById('songArtist'), modType = document.getElementById('modType');
  const badgeEngine = document.querySelector('.badge-engine'), channels = document.getElementById('channels');
  const playbackBadge = document.getElementById('playbackBadge'), playbackStatus = document.getElementById('playbackStatus');
  const compileBadge = document.getElementById('compileBadge'), compileStatus = document.getElementById('compileStatus');
  const miniTrackNum = document.getElementById('miniTrackNum');
  const btnToggleLeft = document.getElementById('btnToggleLeft'), btnToggleRight = document.getElementById('btnToggleRight');
  const panelLeft = document.getElementById('panelLeft'), dropZone = document.getElementById('dropZone');
  const readoutPanel = document.getElementById('readoutPanel');
  const btnInstallApp = document.getElementById('btnInstallApp'), mobileInstallRow = document.getElementById('mobileInstallRow');

  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  if (isStandalone && mobileInstallRow) mobileInstallRow.classList.add('hide');

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    if (mobileInstallRow && !isStandalone) mobileInstallRow.classList.remove('hide');
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    if (mobileInstallRow) mobileInstallRow.classList.add('hide');
  });

  if (btnInstallApp) {
    btnInstallApp.addEventListener('click', async () => {
      if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        const { outcome } = await deferredInstallPrompt.userChoice;
        if (outcome === 'accepted') {
          deferredInstallPrompt = null;
          if (mobileInstallRow) mobileInstallRow.classList.add('hide');
        }
      } else {
        alert('To install XM-Studio:\n\n• On Android Chrome: Tap the three dots (⋮) menu and select "Install app".\n• On iOS Safari: Tap Share and select "Add to Home Screen".');
      }
    });
  }

  function syncPlayModeUI(mode) {
    const active = mode || (window.XMQueue ? window.XMQueue.playMode : 'next');
    document.querySelectorAll('.mode-switch-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.mode === active);
    });
  }
  syncPlayModeUI();

  if (modeSwitchSlider) {
    function setModeFromPointer(clientX) {
      const btns = Array.from(modeSwitchSlider.querySelectorAll('.mode-switch-btn'));
      for (const btn of btns) {
        const rect = btn.getBoundingClientRect();
        if (clientX >= rect.left && clientX <= rect.right) {
          if (window.XMQueue) window.XMQueue.setPlayMode(btn.dataset.mode);
          break;
        }
      }
    }

    modeSwitchSlider.addEventListener('click', (e) => {
      const btn = e.target.closest('.mode-switch-btn');
      if (btn?.dataset.mode && window.XMQueue) window.XMQueue.setPlayMode(btn.dataset.mode);
    });

    let isDragging = false, startX = 0;
    modeSwitchSlider.addEventListener('pointerdown', (e) => {
      startX = e.clientX;
      isDragging = false;
      function onMove(me) {
        if (Math.abs(me.clientX - startX) > 8) {
          isDragging = true;
          setModeFromPointer(me.clientX);
        }
      }
      function onUp(ue) {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        if (isDragging) setModeFromPointer(ue.clientX);
      }
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
  }

  function showMobileArchiveView() {
    btnToggleLeft.classList.add('active');
    btnToggleRight.classList.remove('active');
    panelLeft.classList.remove('mobile-hide');
    dropZone.classList.remove('mobile-hide');
    dropZone.classList.add('mobile-mini');
    if (window.XMLibrary?.refreshScroller) window.XMLibrary.refreshScroller();
    if (window.XMVisualizer) window.XMVisualizer.sleep();
  }

  function showMobilePlayerView() {
    btnToggleRight.classList.add('active');
    btnToggleLeft.classList.remove('active');
    panelLeft.classList.add('mobile-hide');
    dropZone.classList.remove('mobile-hide', 'mobile-mini');
    if (window.XMVisualizer) {
      window.XMVisualizer.resize();
      window.XMVisualizer.wake();
    }
  }

  if (btnToggleLeft && btnToggleRight) {
    btnToggleLeft.addEventListener('click', showMobileArchiveView);
    btnToggleRight.addEventListener('click', showMobilePlayerView);
  }

  if (readoutPanel) {
    readoutPanel.addEventListener('click', () => {
      if (window.innerWidth <= 900 && dropZone.classList.contains('mobile-mini')) showMobilePlayerView();
    });
  }

  function formatTime(sec) {
    if (!sec || isNaN(sec) || !isFinite(sec) || sec < 0) return '00:00';
    const totalSec = Math.floor(sec);
    const m = Math.floor(totalSec / 60), s = totalSec % 60;
    return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
  }

  function resetTimeline() {
    progressBar.value = 0;
    progressBar.style.setProperty('--progress', '0%');
    progressBar.disabled = true;
    timeCurrent.textContent = '00:00';
    timeTotal.textContent = '00:00';
    lastReportedSec = -1;
    lastReportedTotalSec = -1;
    const progressTrack = document.getElementById('readoutProgressTrack');
    const progressBarEl = document.getElementById('readoutProgressBar');
    if (progressTrack) progressTrack.classList.add('hide');
    if (progressBarEl) progressBarEl.style.width = '0%';
  }

  function updateProgress() {
    if (isSeeking || document.hidden) return;
    const dur = window.XMAudio.getDuration(), cur = window.XMAudio.getPosition();
    if (dur > 0 && isFinite(dur)) {
      if (progressBar.disabled) progressBar.disabled = false;
      const safeCur = Math.min(dur, Math.max(0, cur));
      const pct = (safeCur / dur) * 100;
      progressBar.value = pct;
      progressBar.style.setProperty('--progress', `${pct}%`);
      const curSec = safeCur | 0, totSec = dur | 0;
      if (curSec !== lastReportedSec) { lastReportedSec = curSec; timeCurrent.textContent = formatTime(safeCur); }
      if (totSec !== lastReportedTotalSec) { lastReportedTotalSec = totSec; timeTotal.textContent = formatTime(dur); }
    } else {
      const curSec = Math.max(0, cur) | 0;
      if (curSec !== lastReportedSec) { lastReportedSec = curSec; timeCurrent.textContent = formatTime(cur); }
    }
  }

  function startProgressLoop() {
    if (!progressTimerId && !document.hidden) {
      updateProgress();
      progressTimerId = setInterval(updateProgress, 100);
    }
  }

  function stopProgressLoop() {
    if (progressTimerId) { clearInterval(progressTimerId); progressTimerId = null; }
  }

  function setPlayingState(isPlaying) {
    if (isPlaying) {
      svgPlay.classList.add('hide');
      svgPause.classList.remove('hide');
      if (!document.hidden) {
        startProgressLoop();
        if (window.XMVisualizer) window.XMVisualizer.wake(player);
      }
    } else {
      svgPlay.classList.remove('hide');
      svgPause.classList.add('hide');
      stopProgressLoop();
      updateProgress();
      if (window.XMVisualizer) window.XMVisualizer.sleep();
    }
  }

  audioEl.addEventListener('timeupdate', updateProgress);
  audioEl.addEventListener('durationchange', () => {
    const d = window.XMAudio.getDuration();
    if (d > 0) window.XMApp.updateDuration(d);
  });
  audioEl.addEventListener('error', () => {
    const err = audioEl.error;
    const msg = err ? `Media Error Code ${err.code}: ${err.message || 'Decode/Network failure'}` : 'Unknown HTMLAudioElement error';
    console.error('[Audio Error]', msg);
    alert('Audio Stream Error: ' + msg);
    setPlaybackStatus('idle');
    setCompileStatus('error');
    setPlayingState(false);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopProgressLoop();
      if (window.XMVisualizer) window.XMVisualizer.sleep();
    } else if (window.XMAudio?.isPlaying()) {
      startProgressLoop();
      updateProgress();
      if (window.XMVisualizer) window.XMVisualizer.wake(player);
    }
  });

  function setPlaybackStatus(state) {
    if (!playbackBadge || !playbackStatus) return;
    const s = (state || 'idle').toLowerCase();
    playbackBadge.className = `badge badge-playback status-${s}`;
    playbackStatus.textContent = s.toUpperCase();
  }

  function setCompileStatus(state, pct) {
    if (!compileBadge || !compileStatus) return;
    const s = (state || 'idle').toLowerCase();
    compileBadge.className = `badge badge-compile status-${s}`;
    compileStatus.textContent = (s === 'compiling' && typeof pct === 'number' && pct > 0) ? `${Math.round(pct * 100)}%` : s.toUpperCase();
  }

  function getCurrentDeckTrack() {
    let t = window.XMAudio.currentTrackItem;
    if (!t) {
      const info = window.XMAudio.getCurrentInfo();
      if (!info || !info.title || info.title === 'No Module Loaded') return null;
      t = {
        id: window.XMAudio.currentAudioSrc || `track_${encodeURIComponent(info.title)}`,
        title: info.title,
        artist: info.artist,
        ext: (window.XMAudio.getCurrentExtension() || 'XM').toUpperCase(),
        url: window.XMAudio.currentAudioSrc || '',
        blob: window.XMAudio.currentAudioBlob || null
      };
    }
    return t;
  }

  function updateDeckFavState() {
    const t = getCurrentDeckTrack();
    const isLoaded = Boolean(t);
    if (btnDeckFav) btnDeckFav.disabled = !isLoaded;
    if (btnDeckAddPl) btnDeckAddPl.disabled = !isLoaded;
    if (btnLocateTrack) btnLocateTrack.disabled = !isLoaded;
    if (!btnDeckFav) return;
    const isFav = isLoaded && window.XMPlaylist ? window.XMPlaylist.isFavorited(t.id) : false;
    btnDeckFav.classList.toggle('active', isFav);
    const svg = btnDeckFav.querySelector('svg');
    if (svg) {
      svg.setAttribute('fill', isFav ? 'var(--col-gold)' : 'none');
      svg.setAttribute('stroke', isFav ? 'var(--col-gold)' : 'currentColor');
    }
  }

  if (btnDeckFav) {
    btnDeckFav.addEventListener('click', () => {
      const t = getCurrentDeckTrack();
      if (!t || !window.XMPlaylist) return;
      window.XMPlaylist.toggleFavorite(t);
      updateDeckFavState();
      if (window.XMLibrary?.renderCurrentTab) window.XMLibrary.renderCurrentTab();
    });
  }

  if (btnDeckAddPl) {
    btnDeckAddPl.addEventListener('click', () => {
      const t = getCurrentDeckTrack();
      if (t && window.XMPlaylistUI) window.XMPlaylistUI.openPlaylistPicker(t);
    });
  }

  if (btnLocateTrack) {
    btnLocateTrack.addEventListener('click', () => {
      const t = getCurrentDeckTrack();
      if (!t || !t.id) return;
      if (window.innerWidth <= 900) showMobileArchiveView();
      if (window.XMLibrary?.jumpToArchiveTrack) window.XMLibrary.jumpToArchiveTrack(t.id);
    });
  }

  btnPlayPause.addEventListener('click', () => window.XMAudio.togglePlayPause());
  if (btnPrev) btnPrev.addEventListener('click', () => window.XMAudio.playPrevTrack());
  if (btnNext) btnNext.addEventListener('click', () => window.XMAudio.playNextTrack(true));

  if (btnPlayRandom) {
    btnPlayRandom.addEventListener('click', () => {
      let played = window.XMLibrary && window.XMLibrary.playRandomArchiveTrack ? Boolean(window.XMLibrary.playRandomArchiveTrack()) : false;
      if (!played && window.XMAudio && window.XMAudio.playRandomTrack) window.XMAudio.playRandomTrack();
    });
  }

  btnUnload.addEventListener('click', () => {
    try {
      if (window.XMExport?.cancelExport) window.XMExport.cancelExport();
      if (window.XMPrecompiler) window.XMPrecompiler.cancel();
      window.XMAudio.unload();
    } catch (err) {
      console.error('[App] Error during track unload:', err);
    }
    if (window.XMVisualizer?.clear) window.XMVisualizer.clear();

    songTitle.textContent = 'No Module Loaded';
    songArtist.textContent = 'Ready for FastTracker II / Audio input';
    if (miniTrackNum) miniTrackNum.textContent = '--';
    modType.textContent = 'NONE';
    if (badgeEngine) { badgeEngine.classList.add('engine-none'); badgeEngine.classList.remove('engine-error'); }
    channels.textContent = '--';
    const rateBadge = document.getElementById('rateBadge');
    if (rateBadge) rateBadge.textContent = '--';
    const qualityBadge = document.getElementById('qualityBadge');
    if (qualityBadge) qualityBadge.textContent = '--';
    resetTimeline();
    const btnDownload = document.getElementById('btnDownload');
    if (btnDownload) btnDownload.disabled = true;
    if (btnLocateTrack) btnLocateTrack.disabled = true;
    setPlaybackStatus('idle');
    setCompileStatus('idle');
    setPlayingState(false);
    updateDeckFavState();
    if (window.XMLibrary?.notifyPlaying) window.XMLibrary.notifyPlaying(null);
  });

  progressBar.addEventListener('input', () => {
    isSeeking = true;
    const dur = window.XMAudio.getDuration();
    if (dur > 0 && isFinite(dur)) {
      const targetSec = (progressBar.value / 100) * dur;
      timeCurrent.textContent = formatTime(targetSec);
      progressBar.style.setProperty('--progress', `${progressBar.value}%`);
    }
  });

  progressBar.addEventListener('change', () => {
    const dur = window.XMAudio.getDuration();
    if (dur > 0 && isFinite(dur)) {
      const targetSec = (progressBar.value / 100) * dur;
      window.XMAudio.seekTo(targetSec);
      timeCurrent.textContent = formatTime(targetSec);
      lastReportedSec = targetSec | 0;
    }
    setTimeout(() => { isSeeking = false; updateProgress(); }, 120);
  });

  volSlider.addEventListener('input', (e) => {
    const v = parseFloat(e.target.value);
    audioEl.volume = v;
    player.setVolume(v);
    volPercent.textContent = `${Math.round(v * 100)}%`;
    if (v > 0) prevVolume = v;
  });

  btnMute.addEventListener('click', () => {
    const curV = parseFloat(volSlider.value);
    const target = curV > 0 ? 0 : (prevVolume || 0.85);
    if (curV > 0) prevVolume = curV;
    audioEl.volume = target;
    player.setVolume(target);
    volSlider.value = target;
    volPercent.textContent = `${Math.round(target * 100)}%`;
  });

  window.XMApp = {
    setPlayingState,
    setStatus: (s) => {
      if (s === 'compiling' || s === 'ready' || s === 'error') setCompileStatus(s);
      else if (s === 'idle') { setPlaybackStatus('idle'); setCompileStatus('idle'); }
    },
    setPlaybackStatus,
    setCompileStatus,
    syncPlayModeUI,
    updateDeckFav: updateDeckFavState,
    showMobileArchiveView,
    showMobilePlayerView,
    resetTimeline,
    updateDuration: (dur) => {
      if (dur > 0 && isFinite(dur)) {
        timeTotal.textContent = formatTime(dur);
        progressBar.disabled = false;
        updateProgress();
      }
    },
    onForegroundResume: () => {
      const playing = window.XMAudio.isPlaying();
      setPlayingState(playing);
      if (playing) {
        startProgressLoop();
        updateProgress();
        if (window.XMVisualizer) window.XMVisualizer.wake(player);
      }
    },
    updateTrackUI: (title, artist, engine, channelCount, isNative, trackNum) => {
      const isError = (engine === 'ERROR' || engine === 'UNSUPPORTED' || engine === 'NONE');
      songTitle.textContent = title;
      songArtist.textContent = artist;
      if (miniTrackNum) {
        miniTrackNum.textContent = (!isError && trackNum > 0) ? (trackNum < 10 ? `0${trackNum}` : `${trackNum}`) : '--';
      }
      modType.textContent = engine;
      if (badgeEngine) {
        badgeEngine.classList.toggle('engine-none', engine === 'NONE');
        badgeEngine.classList.toggle('engine-error', engine === 'ERROR' || engine === 'UNSUPPORTED');
      }
      if (channels) {
        const numOnly = String(channelCount || '').replace(/\s*ch/i, '').trim();
        channels.textContent = (!isError && numOnly && numOnly !== '--') ? `${numOnly}CH` : '--';
      }
      const fmt = window.XMExport ? window.XMExport.getActiveFormat() : 'mp3';
      const qualityBadge = document.getElementById('qualityBadge');
      if (qualityBadge) {
        qualityBadge.textContent = isError
          ? '--'
          : (isNative
            ? (fmt === 'wav' ? '16-BIT PCM' : '320 KBPS')
            : (fmt === 'raw' ? 'TRACKER' : (fmt === 'mp3' ? '320 KBPS' : '16-BIT PCM')));
      }
      const rateBadge = document.getElementById('rateBadge');
      if (rateBadge) rateBadge.textContent = isError ? '--' : '48 KHZ';
      const btnDownload = document.getElementById('btnDownload');
      if (btnDownload) btnDownload.disabled = isError;
      if (btnLocateTrack) btnLocateTrack.disabled = isError;
      if (isError) {
        setPlaybackStatus('idle');
        setCompileStatus('error');
      } else {
        setPlaybackStatus(isNative ? 'loaded' : 'live');
        setCompileStatus(isNative ? 'ready' : 'compiling');
      }
      setPlayingState(!isError && (window.XMAudio ? window.XMAudio.isPlaying() : false));
      updateDeckFavState();
    },
    onTrackEnded: () => {
      setPlayingState(false);
      resetTimeline();
    }
  };
});