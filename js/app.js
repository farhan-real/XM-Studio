/**
 * js/app.js - Main workstation controller, drag-drop ingestion, format target, and transport.
 */
document.addEventListener('DOMContentLoaded', () => {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js').catch(() => {});
  }

  const { player, audioEl } = window.XMAudio;
  window.XMVisualizer.start(player, audioEl);

  let activeFormat = 'mp3';
  let isSeeking = false;
  let prevVolume = 0.85;
  let lastReportedSec = -1;

  const btnPlayPause = document.getElementById('btnPlayPause');
  const svgPlay = document.getElementById('svgPlay');
  const svgPause = document.getElementById('svgPause');
  const btnStop = document.getElementById('btnStop');
  const btnLoop = document.getElementById('btnLoop');
  const btnShuffle = document.getElementById('btnShuffle');
  const btnPrev = document.getElementById('btnPrev');
  const btnNext = document.getElementById('btnNext');
  const btnPlayRandom = document.getElementById('btnPlayRandom');
  const btnDownload = document.getElementById('btnDownload');
  const btnBrowse = document.getElementById('btnBrowse');
  const btnDemo = document.getElementById('btnDemo');
  const fileInput = document.getElementById('fileInput');
  const dropZone = document.getElementById('dropZone');

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
  const qualityBadge = document.getElementById('qualityBadge');
  const rateBadge = document.getElementById('rateBadge');
  const statusBadge = document.getElementById('statusBadge');
  const btnUnload = document.getElementById('btnUnload');

  const btnFmtMp3 = document.getElementById('btnFmtMp3');
  const btnFmtWav = document.getElementById('btnFmtWav');
  const btnFmtRaw = document.getElementById('btnFmtRaw');
  const readoutProgressTrack = document.getElementById('readoutProgressTrack');
  const readoutProgressBar = document.getElementById('readoutProgressBar');

  const btnToggleLeft = document.getElementById('btnToggleLeft');
  const btnToggleRight = document.getElementById('btnToggleRight');
  const panelLeft = document.getElementById('panelLeft');
  if (btnToggleLeft && btnToggleRight) {
    btnToggleLeft.addEventListener('click', () => {
      btnToggleLeft.classList.add('active');
      btnToggleRight.classList.remove('active');
      panelLeft.classList.remove('mobile-hide');
      dropZone.classList.add('mobile-hide');
    });
    btnToggleRight.addEventListener('click', () => {
      btnToggleRight.classList.add('active');
      btnToggleLeft.classList.remove('active');
      dropZone.classList.remove('mobile-hide');
      panelLeft.classList.add('mobile-hide');
    });
  }

  function formatTime(sec) {
    if (!sec || isNaN(sec)) return "00:00";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }

  function setPlayingState(isPlaying) {
    if (isPlaying) {
      svgPlay.classList.add('hide');
      svgPause.classList.remove('hide');
      if (window.XMVisualizer) window.XMVisualizer.wake(player, audioEl);
    } else {
      svgPlay.classList.remove('hide');
      svgPause.classList.add('hide');
    }
  }

  function setStatus(state) {
    statusBadge.className = 'badge status-badge';
    if (state === 'idle') { statusBadge.classList.add('status-idle'); statusBadge.textContent = 'STATUS: IDLE'; }
    else if (state === 'compiling') { statusBadge.classList.add('status-compiling'); statusBadge.textContent = 'STATUS: COMPILING'; }
    else if (state === 'ready') { statusBadge.classList.add('status-ready'); statusBadge.textContent = 'STATUS: READY'; }
    else if (state === 'error') { statusBadge.classList.add('status-error'); statusBadge.textContent = 'STATUS: ERROR'; }
  }

  function getTrackDuration() {
    if (window.XMAudio.isNativeStream) return (audioEl.duration && !isNaN(audioEl.duration)) ? audioEl.duration : 0;
    return player.currentPlayingNode ? player.duration() : 0;
  }

  function getTrackCurrentTime() {
    if (window.XMAudio.isNativeStream) return audioEl.currentTime || 0;
    return player.currentPlayingNode ? player.getPosition() : 0;
  }

  setInterval(() => {
    if (isSeeking) return;
    const dur = getTrackDuration();
    const cur = getTrackCurrentTime();
    if (dur > 0) {
      progressBar.value = (cur / dur) * 100;
      const currentSec = Math.floor(cur);
      if (currentSec !== lastReportedSec) {
        lastReportedSec = currentSec;
        timeCurrent.textContent = formatTime(cur);
        timeTotal.textContent = formatTime(dur);
      }
    }
  }, 100);

  btnPlayPause.addEventListener('click', () => {
    player.unlock();
    if (window.XMAudio.isNativeStream) {
      if (audioEl.paused) audioEl.play().catch(() => {});
      else audioEl.pause();
      setPlayingState(!audioEl.paused);
    } else {
      if (!player.currentPlayingNode && window.XMAudio.currentRawBuffer) {
        player.play(window.XMAudio.currentRawBuffer);
        setPlayingState(true);
      } else if (player.currentPlayingNode) {
        const isPaused = player.togglePause();
        setPlayingState(!isPaused);
      }
    }
  });

  btnStop.addEventListener('click', () => {
    if (window.XMAudio.isNativeStream) { audioEl.pause(); audioEl.currentTime = 0; }
    else player.stop();
    progressBar.value = 0;
    timeCurrent.textContent = "00:00";
    lastReportedSec = -1;
    setPlayingState(false);
  });

  btnLoop.addEventListener('click', () => btnLoop.classList.toggle('active', window.XMAudio.toggleLoop()));
  btnShuffle.addEventListener('click', () => btnShuffle.classList.toggle('active', window.XMAudio.toggleShuffle()));
  if (btnPrev) btnPrev.addEventListener('click', () => window.XMAudio.playPrevTrack());
  if (btnNext) btnNext.addEventListener('click', () => window.XMAudio.playNextTrack(true));
  if (btnPlayRandom) btnPlayRandom.addEventListener('click', () => window.XMAudio.playRandomTrack());

  btnUnload.addEventListener('click', () => {
    player.stop();
    audioEl.pause();
    audioEl.currentTime = 0;
    songTitle.textContent = "No Module Loaded";
    songArtist.textContent = "Ready for FastTracker II / Audio input";
    modType.textContent = "NONE";
    if (badgeEngine) { badgeEngine.classList.add('engine-none'); badgeEngine.classList.remove('engine-error'); }
    channels.textContent = "--";
    progressBar.value = 0;
    progressBar.disabled = true;
    timeCurrent.textContent = "00:00";
    timeTotal.textContent = "00:00";
    lastReportedSec = -1;
    btnDownload.disabled = true;
    setStatus('idle');
    setPlayingState(false);
    if (window.XMLibrary) window.XMLibrary.notifyPlaying(null);
  });

  function applySeek(targetSec) {
    if (window.XMAudio.isNativeStream) {
      if (audioEl.duration && !isNaN(audioEl.duration)) audioEl.currentTime = targetSec;
    } else player.seek(targetSec);
    timeCurrent.textContent = formatTime(targetSec);
    lastReportedSec = Math.floor(targetSec);
  }

  progressBar.addEventListener('input', () => {
    isSeeking = true;
    const dur = getTrackDuration();
    if (dur > 0) {
      const targetSec = (progressBar.value / 100) * dur;
      timeCurrent.textContent = formatTime(targetSec);
      if (window.XMAudio.isNativeStream && audioEl.paused) audioEl.currentTime = targetSec;
    }
  });

  progressBar.addEventListener('change', () => {
    const dur = getTrackDuration();
    if (dur > 0) applySeek((progressBar.value / 100) * dur);
    isSeeking = false;
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

  function updateFmtButtons(activeId) {
    [btnFmtMp3, btnFmtWav, btnFmtRaw].forEach(b => { if (b) b.classList.toggle('active', b.id === activeId); });
  }

  btnFmtMp3.addEventListener('click', () => { activeFormat = 'mp3'; updateFmtButtons('btnFmtMp3'); qualityBadge.textContent = "320 KBPS"; });
  btnFmtWav.addEventListener('click', () => { activeFormat = 'wav'; updateFmtButtons('btnFmtWav'); qualityBadge.textContent = "16-BIT PCM"; });
  if (btnFmtRaw) btnFmtRaw.addEventListener('click', () => { activeFormat = 'raw'; updateFmtButtons('btnFmtRaw'); qualityBadge.textContent = "TRACKER"; });

  btnDownload.addEventListener('click', async () => {
    const info = window.XMAudio.getCurrentInfo();
    const ext = window.XMAudio.getCurrentExtension ? window.XMAudio.getCurrentExtension() : 'xm';
    const safeName = `${info.artist} - ${info.title}.${ext}`.replace(/[/\\?%*:|"<>]/g, '_');

    if (activeFormat === 'raw') {
      let blob = window.XMAudio.currentAudioBlob;
      if (!blob && window.XMAudio.currentRawBuffer) blob = new Blob([window.XMAudio.currentRawBuffer], { type: 'application/octet-stream' });
      if (!blob && window.XMAudio.currentAudioSrc) {
        try { const res = await fetch(window.XMAudio.currentAudioSrc); blob = await res.blob(); } catch (e) {}
      }
      if (blob) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = safeName;
        a.click();
        URL.revokeObjectURL(a.href);
      }
      return;
    }

    const raw = window.XMAudio.currentRawBuffer;
    if (!raw) return;
    setStatus('compiling');
    readoutProgressTrack.classList.remove('hide');
    readoutProgressBar.style.width = '0%';

    window.AudioCompiler.compile(raw, activeFormat, (p) => { readoutProgressBar.style.width = `${Math.round(p * 100)}%`; }, (blob) => {
      readoutProgressTrack.classList.add('hide');
      setStatus('ready');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${info.artist} - ${info.title}.${activeFormat}`.replace(/[/\\?%*:|"<>]/g, '_');
      a.click();
      URL.revokeObjectURL(a.href);
    }, () => { readoutProgressTrack.classList.add('hide'); setStatus('error'); });
  });

  btnBrowse.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) window.XMAudio.loadTrack(e.target.files[0], e.target.files[0].name);
  });
  btnDemo.addEventListener('click', () => {
    window.XMAudio.loadTrack('https://deskjet.github.io/chiptune2.js/tunes/chipsounds.mod', 'Dubmood - Chipsounds.mod');
  });

  ['dragenter', 'dragover'].forEach(n => dropZone.addEventListener(n, (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); }));
  ['dragleave', 'drop'].forEach(n => dropZone.addEventListener(n, (e) => { e.preventDefault(); dropZone.classList.remove('drag-over'); }));
  dropZone.addEventListener('drop', (e) => {
    if (e.dataTransfer.files.length > 0) window.XMAudio.loadTrack(e.dataTransfer.files[0], e.dataTransfer.files[0].name);
  });

  window.XMApp = {
    updateTrackUI: function(title, artist, engine, channelCount, isNative) {
      const isError = (engine === 'ERROR');
      songTitle.textContent = title;
      songArtist.textContent = artist;
      modType.textContent = engine;
      if (badgeEngine) { badgeEngine.classList.remove('engine-none'); badgeEngine.classList.toggle('engine-error', isError); }
      channels.textContent = channelCount;
      qualityBadge.textContent = isNative ? engine : (activeFormat === 'raw' ? 'TRACKER' : (activeFormat === 'mp3' ? '320 KBPS' : '16-BIT PCM'));
      rateBadge.textContent = isError ? "--" : "48 KHZ";
      progressBar.disabled = isError;
      btnDownload.disabled = isError;
      setStatus(isError ? 'error' : 'ready');
      if (!isError) setPlayingState(true);
    },
    onTrackEnded: function() {
      setPlayingState(false);
      progressBar.value = 0;
      timeCurrent.textContent = "00:00";
      lastReportedSec = -1;
    }
  };
});