/**
 * js/app.js - Main workstation controller with visualizer sleep state and dual status indicators.
 */
document.addEventListener('DOMContentLoaded', () => {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./service-worker.js').catch(() => {});

  const { player, audioEl } = window.XMAudio;
  if (window.XMVisualizer && window.XMVisualizer.start) window.XMVisualizer.start(player);
  if (window.AudioCompiler && window.AudioCompiler.init) window.AudioCompiler.init();
  if (window.XMCache && window.XMCache.init) window.XMCache.init();

  let isSeeking = false;
  let prevVolume = 0.85;
  let lastReportedSec = -1;
  let lastReportedTotalSec = -1;
  let progressTimerId = null;

  const btnPlayPause = document.getElementById('btnPlayPause');
  const svgPlay = document.getElementById('svgPlay');
  const svgPause = document.getElementById('svgPause');
  const btnStop = document.getElementById('btnStop');
  const btnLoop = document.getElementById('btnLoop');
  const btnShuffle = document.getElementById('btnShuffle');
  const btnPrev = document.getElementById('btnPrev');
  const btnNext = document.getElementById('btnNext');
  const btnPlayRandom = document.getElementById('btnPlayRandom');
  const btnDeckFav = document.getElementById('btnDeckFav');
  const btnDeckAddPl = document.getElementById('btnDeckAddPl');
  const btnUnload = document.getElementById('btnUnload');
  const progressBar = document.getElementById('progressBar');
  const timeCurrent = document.getElementById('timeCurrent');
  const timeTotal = document.getElementById('timeTotal');
  const volSlider = document.getElementById('volSlider');
  const volPercent = document.getElementById('volPercent');
  const btnMute = document.getElementById('btnMute');
  const songTitle = document.getElementById('songTitle');
  const songArtist = document.getElementById('songArtist');
  const modType = document.getElementById('modType');
  const badgeEngine = document.querySelector('.badge-engine');
  const channels = document.getElementById('channels');
  const playbackBadge = document.getElementById('playbackBadge');
  const playbackStatus = document.getElementById('playbackStatus');
  const compileBadge = document.getElementById('compileBadge');
  const compileStatus = document.getElementById('compileStatus');
  const miniTrackNum = document.getElementById('miniTrackNum');
  const btnToggleLeft = document.getElementById('btnToggleLeft');
  const btnToggleRight = document.getElementById('btnToggleRight');
  const panelLeft = document.getElementById('panelLeft');
  const dropZone = document.getElementById('dropZone');
  const readoutPanel = document.getElementById('readoutPanel');

  function syncTransportButtons() {
    if (btnLoop) btnLoop.classList.toggle('active', window.XMAudio.isLooping);
    if (btnShuffle) btnShuffle.classList.toggle('active', window.XMAudio.isShuffle);
  }
  syncTransportButtons();

  function showMobileArchiveView() {
    btnToggleLeft.classList.add('active');
    btnToggleRight.classList.remove('active');
    panelLeft.classList.remove('mobile-hide');
    dropZone.classList.remove('mobile-hide');
    dropZone.classList.add('mobile-mini');
    if (window.XMLibrary && window.XMLibrary.refreshScroller) window.XMLibrary.refreshScroller();
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
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
  }

  function resetTimeline() {
    progressBar.value = 0;
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
    const dur = window.XMAudio.getDuration();
    const cur = window.XMAudio.getPosition();
    if (dur > 0 && isFinite(dur)) {
      if (progressBar.disabled) progressBar.disabled = false;
      const safeCur = Math.min(dur, Math.max(0, cur));
      progressBar.value = (safeCur / dur) * 100;
      const curSec = safeCur | 0;
      const totSec = dur | 0;
      if (curSec !== lastReportedSec) {
        lastReportedSec = curSec;
        timeCurrent.textContent = formatTime(safeCur);
      }
      if (totSec !== lastReportedTotalSec) {
        lastReportedTotalSec = totSec;
        timeTotal.textContent = formatTime(dur);
      }
    } else {
      const curSec = Math.max(0, cur) | 0;
      if (curSec !== lastReportedSec) {
        lastReportedSec = curSec;
        timeCurrent.textContent = formatTime(cur);
      }
    }
  }

  function startProgressLoop() {
    if (!progressTimerId && !document.hidden) {
      updateProgress();
      progressTimerId = setInterval(updateProgress, 150);
    }
  }

  function stopProgressLoop() {
    if (progressTimerId) {
      clearInterval(progressTimerId);
      progressTimerId = null;
    }
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

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopProgressLoop();
      if (window.XMVisualizer) window.XMVisualizer.sleep();
    } else if (window.XMAudio && window.XMAudio.isPlaying()) {
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
    compileStatus.textContent = (s === 'compiling' && typeof pct === 'number' && pct > 0)
      ? `${Math.round(pct * 100)}%`
      : s.toUpperCase();
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
    if (!btnDeckFav) return;
    const t = getCurrentDeckTrack();
    const isLoaded = Boolean(t);
    btnDeckFav.disabled = !isLoaded;
    if (btnDeckAddPl) btnDeckAddPl.disabled = !isLoaded;
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
      if (window.XMLibrary && window.XMLibrary.renderCurrentTab) window.XMLibrary.renderCurrentTab();
    });
  }

  if (btnDeckAddPl) {
    btnDeckAddPl.addEventListener('click', () => {
      const t = getCurrentDeckTrack();
      if (t && window.XMPlaylistUI) window.XMPlaylistUI.openPlaylistPicker(t);
    });
  }

  btnPlayPause.addEventListener('click', () => window.XMAudio.togglePlayPause());
  btnStop.addEventListener('click', () => window.XMAudio.stopPlayback());
  btnLoop.addEventListener('click', () => { window.XMAudio.toggleLoop(); syncTransportButtons(); });
  btnShuffle.addEventListener('click', () => { window.XMAudio.toggleShuffle(); syncTransportButtons(); });
  if (btnPrev) btnPrev.addEventListener('click', () => window.XMAudio.playPrevTrack());
  if (btnNext) btnNext.addEventListener('click', () => window.XMAudio.playNextTrack(true));

  if (btnPlayRandom) {
    btnPlayRandom.addEventListener('click', () => {
      if (window.innerWidth <= 900) showMobileArchiveView();
      let played = window.XMLibrary && window.XMLibrary.playRandomArchiveTrack ? Boolean(window.XMLibrary.playRandomArchiveTrack()) : false;
      if (!played && window.XMAudio && window.XMAudio.playRandomTrack) window.XMAudio.playRandomTrack();
    });
  }

  btnUnload.addEventListener('click', () => {
    try {
      if (window.XMExport && window.XMExport.cancelExport) window.XMExport.cancelExport();
      window.XMAudio.unload();
    } catch (e) {
      console.warn('Unload error caught:', e);
    }
    try {
      if (window.XMVisualizer) {
        if (typeof window.XMVisualizer.clear === 'function') window.XMVisualizer.clear();
        else if (typeof window.XMVisualizer.clearCanvas === 'function') window.XMVisualizer.clearCanvas();
      }
    } catch (e) {}

    songTitle.textContent = 'No Module Loaded';
    songArtist.textContent = 'Ready for FastTracker II / Audio input';
    if (miniTrackNum) miniTrackNum.textContent = '--';
    modType.textContent = 'NONE';
    if (badgeEngine) {
      badgeEngine.classList.add('engine-none');
      badgeEngine.classList.remove('engine-error');
    }
    channels.textContent = '--';
    const rateBadge = document.getElementById('rateBadge');
    if (rateBadge) rateBadge.textContent = '--';
    resetTimeline();
    const btnDownload = document.getElementById('btnDownload');
    if (btnDownload) btnDownload.disabled = true;
    setPlaybackStatus('idle');
    setCompileStatus('idle');
    setPlayingState(false);
    updateDeckFavState();
    if (window.XMLibrary && window.XMLibrary.notifyPlaying) window.XMLibrary.notifyPlaying(null);
  });

  progressBar.addEventListener('input', () => {
    isSeeking = true;
    const dur = window.XMAudio.getDuration();
    if (dur > 0 && isFinite(dur)) timeCurrent.textContent = formatTime((progressBar.value / 100) * dur);
  });

  progressBar.addEventListener('change', () => {
    const dur = window.XMAudio.getDuration();
    if (dur > 0 && isFinite(dur)) {
      const targetSec = (progressBar.value / 100) * dur;
      window.XMAudio.seekTo(targetSec);
      timeCurrent.textContent = formatTime(targetSec);
      lastReportedSec = targetSec | 0;
    }
    setTimeout(() => { isSeeking = false; updateProgress(); }, 150);
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
      const isError = (engine === 'ERROR');
      songTitle.textContent = title;
      songArtist.textContent = artist;
      if (miniTrackNum) {
        miniTrackNum.textContent = (!isError && trackNum > 0) ? (trackNum < 10 ? `0${trackNum}` : `${trackNum}`) : '--';
      }
      modType.textContent = engine;
      if (badgeEngine) {
        badgeEngine.classList.remove('engine-none');
        badgeEngine.classList.toggle('engine-error', isError);
      }
      if (channels) {
        const numOnly = String(channelCount || '').replace(/\s*ch/i, '').trim();
        channels.textContent = (!isError && numOnly && numOnly !== '--') ? `${numOnly}CH` : '--';
      }
      const fmt = window.XMExport ? window.XMExport.getActiveFormat() : 'mp3';
      const qualityBadge = document.getElementById('qualityBadge');
      if (qualityBadge) {
        qualityBadge.textContent = isNative ? (fmt === 'wav' ? '16-BIT PCM' : '320 KBPS') : (fmt === 'raw' ? 'TRACKER' : (fmt === 'mp3' ? '320 KBPS' : '16-BIT PCM'));
      }
      const rateBadge = document.getElementById('rateBadge');
      if (rateBadge) rateBadge.textContent = isError ? '--' : '48 KHZ';
      const btnDownload = document.getElementById('btnDownload');
      if (btnDownload) btnDownload.disabled = isError;
      setPlaybackStatus(isError ? 'idle' : (isNative ? 'loaded' : 'live'));
      if (isError) setCompileStatus('error');
      setPlayingState(!isError && (window.XMAudio ? window.XMAudio.isPlaying() : false));
      updateDeckFavState();
    },
    onTrackEnded: () => {
      setPlayingState(false);
      resetTimeline();
    }
  };
});