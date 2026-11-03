document.addEventListener('DOMContentLoaded', () => {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js').catch(() => {});
  }

  // DEFAULT LIBRARY SOURCE: farhan-real/XM-Music
  const DEFAULT_MUSIC_BASE_URL = 'https://farhan-real.github.io/XM-Music/';

  function getActiveLibraryBaseUrl() {
    const saved = localStorage.getItem('xm_custom_library_url');
    if (saved && saved.trim()) return saved.trim();
    return DEFAULT_MUSIC_BASE_URL;
  }

  const player = new ChiptuneJsPlayer();
  const audioEl = document.getElementById('nativeAudio');
  
  let currentRawBuffer = null;
  let currentAudioBlob = null;
  let currentAudioUrl = null;
  let activeFormat = 'mp3';
  let isSeeking = false;
  let activeTitle = "No Module Loaded";
  let activeArtist = "";
  let isNativeStream = false;
  let nativeAudioSource = null;
  let prevVolume = 0.85;

  // Track queue & active playing item state
  let currentActiveTrackItem = null;
  let activePlaylistQueue = null;
  let activeQueueIndex = -1;

  // Cloud Library & Local State
  let fullLibraryTracks = [];
  let filteredLibraryTracks = [];
  let isLibraryLoaded = false;
  const BATCH_SIZE = 50;
  let renderedCount = 0;
  let activeTab = 'cloud';
  let viewingPlaylistId = null;
  let pendingTrackToAddToPlaylist = null;

  // IndexedDB Storage for Uploaded Tracks (Persistent Offline Playlists)
  const IDB_NAME = 'XMStudioDB';
  const IDB_STORE = 'uploaded_tracks';

  function openIDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function saveTrackToIDB(id, buffer, meta) {
    try {
      const db = await openIDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put({ id, buffer, meta });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (e) {
      console.warn('IDB save failed:', e);
    }
  }

  async function getTrackFromIDB(id) {
    try {
      const db = await openIDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readonly');
        const req = tx.objectStore(IDB_STORE).get(id);
        req.onsuccess = () => resolve(req.result ? req.result.buffer : null);
        req.onerror = () => reject(req.error);
      });
    } catch (e) {
      return null;
    }
  }

  // Favorites & Playlist Store
  function getFavorites() {
    try {
      return JSON.parse(localStorage.getItem('xm_favorites')) || [];
    } catch (e) {
      return [];
    }
  }

  function saveFavorites(favs) {
    localStorage.setItem('xm_favorites', JSON.stringify(favs));
  }

  function isTrackFavorited(id) {
    return getFavorites().some(f => f.id === id);
  }

  function toggleFavoriteTrack(trackItem) {
    let favs = getFavorites();
    const idx = favs.findIndex(f => f.id === trackItem.id);
    if (idx >= 0) {
      favs.splice(idx, 1);
    } else {
      favs.push(trackItem);
    }
    saveFavorites(favs);
    updateFavCurrentButton();
    if (activeTab === 'favs') renderLibraryList(true);
  }

  function getPlaylists() {
    try {
      return JSON.parse(localStorage.getItem('xm_playlists')) || [
        { id: 'pl_favorites_sync', name: 'Favorites Mix', tracks: [] }
      ];
    } catch (e) {
      return [];
    }
  }

  function savePlaylists(pls) {
    localStorage.setItem('xm_playlists', JSON.stringify(pls));
  }

  // Native streaming extensions that bypass OpenMPT
  const NATIVE_STREAM_EXTS = ['.mp3', '.ogg', '.wav'];

  function routeNativeAudioToWebAudio() {
    if (!nativeAudioSource && player.context) {
      try {
        nativeAudioSource = player.context.createMediaElementSource(audioEl);
        nativeAudioSource.connect(player.gainNode);
      } catch (e) {}
    }
  }

  // UI Elements
  const btnPlayPause = document.getElementById('btnPlayPause');
  const svgPlay = document.getElementById('svgPlay');
  const svgPause = document.getElementById('svgPause');
  const btnStop = document.getElementById('btnStop');
  const btnLoop = document.getElementById('btnLoop');
  const btnDownload = document.getElementById('btnDownload');
  const btnBrowse = document.getElementById('btnBrowse');
  const btnDemo = document.getElementById('btnDemo');
  const btnLibrary = document.getElementById('btnLibrary');
  const btnCloseLibrary = document.getElementById('btnCloseLibrary');
  const libraryDrawer = document.getElementById('libraryDrawer');
  const librarySearch = document.getElementById('librarySearch');
  const libraryList = document.getElementById('libraryList');
  const libraryCount = document.getElementById('libraryCount');

  // Tabs & Panes
  const tabCloud = document.getElementById('tabCloud');
  const tabFavs = document.getElementById('tabFavs');
  const tabPlaylists = document.getElementById('tabPlaylists');
  const tabSource = document.getElementById('tabSource');
  const paneTracks = document.getElementById('paneTracks');
  const panePlaylists = document.getElementById('panePlaylists');
  const paneSource = document.getElementById('paneSource');

  const playlistNewName = document.getElementById('playlistNewName');
  const btnCreatePlaylist = document.getElementById('btnCreatePlaylist');
  const playlistContainer = document.getElementById('playlistContainer');
  const playlistViewHeader = document.getElementById('playlistViewHeader');
  const playlistActiveTitle = document.getElementById('playlistActiveTitle');
  const btnBackPlaylists = document.getElementById('btnBackPlaylists');
  const btnPlayAllPlaylist = document.getElementById('btnPlayAllPlaylist');

  const inputCustomSource = document.getElementById('inputCustomSource');
  const btnSaveSource = document.getElementById('btnSaveSource');
  const btnResetSource = document.getElementById('btnResetSource');
  const sourceStatusMsg = document.getElementById('sourceStatusMsg');

  const playlistModal = document.getElementById('playlistModal');
  const playlistModalList = document.getElementById('playlistModalList');
  const btnCloseModal = document.getElementById('btnCloseModal');

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
  const btnFavCurrent = document.getElementById('btnFavCurrent');
  const svgFavCurrent = document.getElementById('svgFavCurrent');

  const modType = document.getElementById('modType');
  const channels = document.getElementById('channels');
  const qualityBadge = document.getElementById('qualityBadge');
  const rateBadge = document.getElementById('rateBadge');
  const btnFmtMp3 = document.getElementById('btnFmtMp3');
  const btnFmtWav = document.getElementById('btnFmtWav');

  const statusBadge = document.getElementById('statusBadge');
  const btnUnload = document.getElementById('btnUnload');
  const readoutProgressTrack = document.getElementById('readoutProgressTrack');
  const readoutProgressBar = document.getElementById('readoutProgressBar');

  // Canvas Studio Meter
  const canvas = document.getElementById('visualizer');
  const ctx = canvas.getContext('2d');
  function resizeCanvas() {
    canvas.width = canvas.parentElement.clientWidth * window.devicePixelRatio;
    canvas.height = canvas.parentElement.clientHeight * window.devicePixelRatio;
  }
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

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
    } else {
      svgPlay.classList.remove('hide');
      svgPause.classList.add('hide');
    }
  }

  function setStatus(state) {
    statusBadge.className = 'badge status-badge';
    if (state === 'idle') {
      statusBadge.classList.add('status-idle');
      statusBadge.textContent = 'STATUS: IDLE';
    } else if (state === 'compiling') {
      statusBadge.classList.add('status-compiling');
      statusBadge.textContent = 'STATUS: COMPILING';
    } else if (state === 'ready') {
      statusBadge.classList.add('status-ready');
      statusBadge.textContent = 'STATUS: READY';
    }
  }

  function updateVolumeDisplay(val) {
    const pct = Math.round(val * 100);
    volPercent.textContent = `${pct}%`;
    volSlider.value = val;
  }

  function updateFavCurrentButton() {
    if (!currentActiveTrackItem) {
      btnFavCurrent.classList.add('hide');
      return;
    }
    btnFavCurrent.classList.remove('hide');
    const isFav = isTrackFavorited(currentActiveTrackItem.id);
    if (isFav) {
      btnFavCurrent.classList.add('active');
      svgFavCurrent.setAttribute('fill', '#f59e0b');
      svgFavCurrent.setAttribute('stroke', '#f59e0b');
    } else {
      btnFavCurrent.classList.remove('active');
      svgFavCurrent.setAttribute('fill', 'none');
      svgFavCurrent.setAttribute('stroke', 'currentColor');
    }
  }

  function getFileExtension(filename) {
    const match = filename.toLowerCase().match(/\.[a-z0-9]+$/);
    return match ? match[0] : '';
  }

  function normalizeArtist(str) {
    if (!str) return '';
    let s = str.trim();
    s = s.replace(/\s+and\s+/gi, ' & ');
    s = s.replace(/\s+(?:featuring|feat\.?|ft\.?)\s+/gi, ' ft. ');
    s = s.replace(/\s+(?:versus|vs\.?)\s+/gi, ' vs. ');
    s = s.replace(/([^\s&])&/g, '$1 &').replace(/&([^\s&])/g, '& $1');
    s = s.replace(/\s+/g, ' ').trim();
    return s;
  }

  function smartCapitalize(str) {
    if (!str) return '';
    if (str !== str.toLowerCase()) return str;

    const minorWords = ['and', 'or', 'the', 'of', 'in', 'on', 'at', 'to', 'for', 'a', 'an', 'ft.', 'vs.', '&'];
    return str.split(' ').map((word, index) => {
      if (!word) return '';
      const lower = word.toLowerCase();
      if (index > 0 && minorWords.includes(lower)) {
        return lower;
      }
      return word.charAt(0).toUpperCase() + word.slice(1);
    }).join(' ');
  }

  function parseTrackInfo(filename, internalMeta) {
    internalMeta = internalMeta || {};
    let base = filename.replace(/\.[a-z0-9]+$/i, '').trim();

    if (base.includes('_-_')) {
      base = base.replace(/_-_/g, ' - ').replace(/_/g, ' ');
    } else if (!base.includes(' ') && base.includes('_')) {
      base = base.replace(/_/g, ' ');
    }

    let rawArtist = (internalMeta.artist || '').trim();
    let rawTitle = (internalMeta.title || '').trim();

    const match = base.match(/^(.+?)\s+[-–—]\s+(.+)$/);

    if (match) {
      let fileArtist = match[1].trim();
      let fileTitle = match[2].trim();

      const featInTitle = fileTitle.match(/\s*[\(\[\{]?(?:ft\.?|feat\.?|featuring)\s+([^\)\]\}]+)[\)\]\}]?/i);
      if (featInTitle) {
        const featured = featInTitle[1].trim();
        fileTitle = fileTitle.replace(featInTitle[0], '').trim();
        fileArtist = `${fileArtist} ft. ${featured}`;
      }

      if (!rawTitle || fileTitle.toLowerCase().startsWith(rawTitle.toLowerCase())) {
        rawTitle = fileTitle;
      } else {
        rawTitle = fileTitle || rawTitle;
      }

      if (!rawArtist) {
        rawArtist = fileArtist;
      }
    } else {
      const featMatch = base.match(/^(.+?)\s+[\(\[\{]?(?:ft\.?|feat\.?|featuring)\s+([^\)\]\}]+)[\)\]\}]?/i);
      if (featMatch) {
        rawTitle = featMatch[1].trim();
        if (!rawArtist) rawArtist = featMatch[2].trim();
      } else {
        if (!rawTitle) rawTitle = base;
        if (!rawArtist) rawArtist = internalMeta.type_long || "FastTracker II";
      }
    }

    let artist = normalizeArtist(rawArtist);
    let title = rawTitle.trim();

    artist = smartCapitalize(artist);
    title = smartCapitalize(title);

    return {
      artist: artist || "Unknown Artist",
      title: title || "Untitled Track"
    };
  }

  // Visualizer Loop
  const dataArray = new Uint8Array(32);
  function renderVisualizer() {
    requestAnimationFrame(renderVisualizer);

    ctx.fillStyle = '#090a0d';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    var isLive = isNativeStream 
      ? (!audioEl.paused) 
      : (player.currentPlayingNode && !player.currentPlayingNode.paused);

    if (isLive) {
      player.analyser.getByteFrequencyData(dataArray);
      const totalBars = 28;
      const spacing = 3 * window.devicePixelRatio;
      const totalSpacing = spacing * (totalBars - 1);
      const barWidth = (canvas.width - totalSpacing) / totalBars;
      let x = 0;

      for (let i = 0; i < totalBars; i++) {
        const val = dataArray[i] / 255;
        const barHeight = Math.max(3 * window.devicePixelRatio, val * (canvas.height - 8));

        if (val > 0.82) {
          ctx.fillStyle = '#f59e0b';
        } else if (val > 0.5) {
          ctx.fillStyle = '#d4d4d8';
        } else {
          ctx.fillStyle = '#52525b';
        }

        ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
        x += barWidth + spacing;
      }
    }
  }
  renderVisualizer();

  // Unified Real-Time Scrubber & Timeline Loop
  setInterval(() => {
    if (isSeeking) return;

    if (!isNativeStream && player.currentPlayingNode && !player.currentPlayingNode.paused) {
      const cur = player.getPosition();
      const dur = player.duration();
      if (dur > 0) {
        progressBar.value = (cur / dur) * 100;
        timeCurrent.textContent = formatTime(cur);
        timeTotal.textContent = formatTime(dur);
      }
    } else if (isNativeStream && !audioEl.paused && audioEl.duration) {
      progressBar.value = (audioEl.currentTime / audioEl.duration) * 100;
      timeCurrent.textContent = formatTime(audioEl.currentTime);
      timeTotal.textContent = formatTime(audioEl.duration);
    }
  }, 100);

  // UNLOAD MODULE
  function unloadModule() {
    player.cancelCompilation();
    player.stop();
    audioEl.pause();
    audioEl.currentTime = 0;
    
    if (currentAudioUrl) {
      URL.revokeObjectURL(currentAudioUrl);
      currentAudioUrl = null;
    }
    currentRawBuffer = null;
    currentAudioBlob = null;
    isNativeStream = false;
    currentActiveTrackItem = null;

    activeTitle = "No Module Loaded";
    activeArtist = "";

    songTitle.textContent = "No Module Loaded";
    songArtist.textContent = "Ready for FastTracker II / Audio input";
    modType.textContent = "NONE";
    channels.textContent = "--";

    readoutProgressTrack.classList.add('hide');
    readoutProgressBar.style.width = '0%';

    progressBar.value = 0;
    progressBar.disabled = true;
    timeCurrent.textContent = "00:00";
    timeTotal.textContent = "00:00";
    btnDownload.disabled = true;

    updateFavCurrentButton();
    setStatus('idle');
    setPlayingState(false);

    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = null;
    }
  }

  // Play next in active playlist queue when track finishes
  function playNextInQueue() {
    if (!audioEl.loop && activePlaylistQueue && activeQueueIndex >= 0) {
      const nextIdx = activeQueueIndex + 1;
      if (nextIdx < activePlaylistQueue.length) {
        playTrackItem(activePlaylistQueue[nextIdx], activePlaylistQueue, nextIdx);
        return;
      }
    }
    setPlayingState(false);
    progressBar.value = 0;
    timeCurrent.textContent = "00:00";
  }

  // LOAD & PLAY WITH AUTOMATIC HARDWARE HANDOFF
  function loadModule(fileOrUrl, fallbackName, trackItemRef) {
    const ext = getFileExtension(fallbackName);
    player.stop();
    audioEl.pause();

    // 1. NATIVE HARDWARE STREAM (.mp3, .ogg, .wav)
    if (NATIVE_STREAM_EXTS.includes(ext)) {
      isNativeStream = true;
      readoutProgressTrack.classList.add('hide');

      if (fileOrUrl instanceof File || fileOrUrl instanceof Blob) {
        if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl);
        currentAudioBlob = fileOrUrl;
        currentAudioUrl = URL.createObjectURL(fileOrUrl);
        audioEl.src = currentAudioUrl;
      } else {
        audioEl.src = fileOrUrl;
      }

      const info = parseTrackInfo(fallbackName, {});
      activeTitle = info.title;
      activeArtist = info.artist;

      currentActiveTrackItem = trackItemRef || {
        id: `stream_${fallbackName}`,
        title: info.title,
        artist: info.artist,
        ext: ext.replace('.', '').toUpperCase(),
        url: typeof fileOrUrl === 'string' ? fileOrUrl : null
      };

      songTitle.textContent = info.title;
      songArtist.textContent = info.artist;
      modType.textContent = ext.replace('.', '').toUpperCase();
      channels.textContent = "2 CH";
      qualityBadge.textContent = ext.replace('.', '').toUpperCase();
      rateBadge.textContent = "DIRECT";

      progressBar.disabled = false;
      btnDownload.disabled = false;
      updateFavCurrentButton();
      setStatus('ready');

      if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: info.title,
          artist: info.artist,
          album: "XM-Studio"
        });
      }

      routeNativeAudioToWebAudio();
      audioEl.play().catch(() => {});
      setPlayingState(true);
      return;
    }

    // 2. TRACKER MODULE
    isNativeStream = false;
    btnDownload.disabled = true;

    player.load(fileOrUrl, (buf) => {
      currentRawBuffer = buf;

      const meta = player.readMetadata(buf) || {};
      const info = parseTrackInfo(fallbackName, meta);

      activeTitle = info.title;
      activeArtist = info.artist;

      currentActiveTrackItem = trackItemRef || {
        id: `track_${fallbackName}`,
        title: info.title,
        artist: info.artist,
        ext: (meta.type_long || "FT2").toUpperCase(),
        url: typeof fileOrUrl === 'string' ? fileOrUrl : null
      };
      
      songTitle.textContent = info.title;
      songArtist.textContent = info.artist;
      modType.textContent = (meta.type_long || "FT2").toUpperCase();
      channels.textContent = `${meta.channels || 8} CH`;

      qualityBadge.textContent = activeFormat === 'mp3' ? "320 KBPS" : "16-BIT PCM";
      rateBadge.textContent = "48 KHZ";

      readoutProgressTrack.classList.remove('hide');
      readoutProgressBar.style.width = '0%';
      updateFavCurrentButton();
      setStatus('compiling');

      // Cache locally uploaded buffer in IndexedDB for persistent custom playlists
      if (fileOrUrl instanceof File || fileOrUrl instanceof Blob) {
        saveTrackToIDB(currentActiveTrackItem.id, buf, {
          title: info.title,
          artist: info.artist,
          filename: fallbackName
        });
      }

      // Instant 8k buffer real-time playback
      player.play(buf);
      setPlayingState(true);
      progressBar.disabled = false;

      if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: info.title,
          artist: info.artist,
          album: "XM-Studio"
        });
      }

      // Background compilation + hardware handoff
      player.compileAudio(
        buf,
        activeFormat,
        (progress) => {
          const pct = Math.round(progress * 100);
          readoutProgressBar.style.width = `${pct}%`;
        },
        (compiledBlob) => {
          if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl);
          currentAudioBlob = compiledBlob;
          currentAudioUrl = URL.createObjectURL(compiledBlob);

          readoutProgressBar.style.width = '100%';
          setTimeout(() => readoutProgressTrack.classList.add('hide'), 500);

          setStatus('ready');
          btnDownload.disabled = false;

          // Seamless hardware handoff
          if (player.currentPlayingNode) {
            const currentPos = player.getPosition();
            const wasPlaying = !player.currentPlayingNode.paused;

            player.stop();
            routeNativeAudioToWebAudio();
            audioEl.src = currentAudioUrl;
            audioEl.currentTime = currentPos;
            isNativeStream = true;

            if (wasPlaying) {
              audioEl.play().catch(() => {});
              setPlayingState(true);
            }
          }
        },
        (err) => {
          readoutProgressTrack.classList.add('hide');
          setStatus('idle');
          console.error("Background compilation error:", err);
        }
      );
    });
  }

  // Play any unified track item (Cloud or Local IDB)
  async function playTrackItem(item, queue, index) {
    if (queue) {
      activePlaylistQueue = queue;
      activeQueueIndex = index;
    }

    if (item.path) {
      const url = `${getActiveLibraryBaseUrl()}${item.path}`;
      loadModule(url, `${item.artist} - ${item.title}.${(item.ext || 'xm').toLowerCase()}`, item);
    } else if (item.url) {
      loadModule(item.url, `${item.artist} - ${item.title}.${(item.ext || 'xm').toLowerCase()}`, item);
    } else if (item.id) {
      const buffer = await getTrackFromIDB(item.id);
      if (buffer) {
        loadModule(buffer, `${item.artist} - ${item.title}.${(item.ext || 'xm').toLowerCase()}`, item);
      } else {
        alert("Local file buffer not found. Re-import file.");
      }
    }
  }

  // Cloud Library Fetcher
  async function fetchCloudLibrary() {
    const baseUrl = getActiveLibraryBaseUrl();
    libraryList.innerHTML = `<div class="library-empty-msg">Connecting to default XM-Music repository...<br><span style="font-size:0.72rem;color:var(--text-muted);">${baseUrl}</span></div>`;
    
    try {
      const res = await fetch(`${baseUrl}tracks.json`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      fullLibraryTracks = await res.json();
      
      // Ensure all tracks have consistent ID
      fullLibraryTracks.forEach((t) => {
        if (!t.id) t.id = `cloud_${t.path}`;
      });

      filteredLibraryTracks = fullLibraryTracks;
      isLibraryLoaded = true;
      libraryCount.textContent = `${fullLibraryTracks.length} TRACKS`;
      renderLibraryList(true);
    } catch (err) {
      libraryList.innerHTML = `
        <div class="library-empty-msg">
          Could not fetch tracks.json from ${baseUrl}<br>
          <span style="font-size:0.72rem;color:var(--text-muted);">Ensure XM-Music is deployed to GitHub Pages with tracks.json, or configure your source in the Source tab.</span>
        </div>
      `;
    }
  }

  // Render Track List with Action Buttons (Play, Star, Add to Playlist)
  function renderLibraryList(reset) {
    if (reset) {
      libraryList.innerHTML = '';
      renderedCount = 0;
    }

    let sourceList = filteredLibraryTracks;
    if (activeTab === 'favs') {
      const favs = getFavorites();
      const q = librarySearch.value.toLowerCase().trim();
      sourceList = q ? favs.filter(t => t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q)) : favs;
      libraryCount.textContent = `${favs.length} FAVORITES`;
    }

    const nextBatch = sourceList.slice(renderedCount, renderedCount + BATCH_SIZE);
    if (nextBatch.length === 0 && renderedCount === 0) {
      libraryList.innerHTML = `<div class="library-empty-msg">${activeTab === 'favs' ? 'No favorited tracks yet. Tap ★ on any track to add.' : 'No matching tracks found.'}</div>`;
      return;
    }

    const frag = document.createDocumentFragment();
    nextBatch.forEach((item, idx) => {
      const actualIdx = renderedCount + idx;
      const el = document.createElement('div');
      el.className = 'library-item';
      const isFav = isTrackFavorited(item.id);

      el.innerHTML = `
        <div class="lib-item-info">
          <span class="lib-item-title">${item.title}</span>
          <span class="lib-item-sub">${item.artist} ${item.folder ? '• ' + item.folder : ''}</span>
        </div>
        <div class="lib-item-actions">
          <button class="btn-item-action ${isFav ? 'active' : ''}" data-action="fav" title="Toggle Favorite">
            <svg viewBox="0 0 24 24" class="t-icon-xs" fill="${isFav ? '#f59e0b' : 'none'}" stroke="${isFav ? '#f59e0b' : 'currentColor'}">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
            </svg>
          </button>
          <button class="btn-item-action" data-action="add-pl" title="Add to Playlist">
            <svg viewBox="0 0 24 24" class="t-icon-xs">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
          </button>
          <span class="badge">${item.ext || 'XM'}</span>
        </div>
      `;

      // Play on title click
      el.querySelector('.lib-item-info').addEventListener('click', () => {
        libraryDrawer.classList.add('hide');
        playTrackItem(item, sourceList, actualIdx);
      });

      // Favorite toggle
      el.querySelector('[data-action="fav"]').addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFavoriteTrack(item);
      });

      // Add to playlist
      el.querySelector('[data-action="add-pl"]').addEventListener('click', (e) => {
        e.stopPropagation();
        openAddToPlaylistModal(item);
      });

      frag.appendChild(el);
    });

    libraryList.appendChild(frag);
    renderedCount += nextBatch.length;
  }

  // Playlists UI View
  function renderPlaylistsList() {
    playlistViewHeader.classList.add('hide');
    playlistContainer.innerHTML = '';
    const playlists = getPlaylists();
    libraryCount.textContent = `${playlists.length} PLAYLISTS`;

    if (playlists.length === 0) {
      playlistContainer.innerHTML = '<div class="library-empty-msg">No custom playlists created.</div>';
      return;
    }

    playlists.forEach(pl => {
      const el = document.createElement('div');
      el.className = 'library-item';
      el.innerHTML = `
        <div class="lib-item-info">
          <span class="lib-item-title">${pl.name}</span>
          <span class="lib-item-sub">${pl.tracks.length} tracks</span>
        </div>
        <div class="lib-item-actions">
          <button class="btn-item-action" data-action="play-pl" title="Play Playlist">▶</button>
          <button class="btn-item-action" data-action="del-pl" title="Delete Playlist">
            <svg viewBox="0 0 24 24" class="t-icon-xs">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
      `;

      el.querySelector('.lib-item-info').addEventListener('click', () => viewPlaylistDetails(pl.id));
      el.querySelector('[data-action="play-pl"]').addEventListener('click', (e) => {
        e.stopPropagation();
        if (pl.tracks.length > 0) {
          libraryDrawer.classList.add('hide');
          playTrackItem(pl.tracks[0], pl.tracks, 0);
        }
      });
      el.querySelector('[data-action="del-pl"]').addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm(`Delete playlist "${pl.name}"?`)) {
          const updated = getPlaylists().filter(p => p.id !== pl.id);
          savePlaylists(updated);
          renderPlaylistsList();
        }
      });

      playlistContainer.appendChild(el);
    });
  }

  function viewPlaylistDetails(plId) {
    viewingPlaylistId = plId;
    const pl = getPlaylists().find(p => p.id === plId);
    if (!pl) return;

    playlistViewHeader.classList.remove('hide');
    playlistActiveTitle.textContent = pl.name;
    playlistContainer.innerHTML = '';

    if (pl.tracks.length === 0) {
      playlistContainer.innerHTML = '<div class="library-empty-msg">Playlist is empty. Add tracks from Library or Favorites.</div>';
      return;
    }

    pl.tracks.forEach((track, idx) => {
      const el = document.createElement('div');
      el.className = 'library-item';
      el.innerHTML = `
        <div class="lib-item-info">
          <span class="lib-item-title">${track.title}</span>
          <span class="lib-item-sub">${track.artist}</span>
        </div>
        <div class="lib-item-actions">
          <button class="btn-item-action" data-action="remove-item" title="Remove from playlist">
            <svg viewBox="0 0 24 24" class="t-icon-xs">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
      `;

      el.querySelector('.lib-item-info').addEventListener('click', () => {
        libraryDrawer.classList.add('hide');
        playTrackItem(track, pl.tracks, idx);
      });

      el.querySelector('[data-action="remove-item"]').addEventListener('click', (e) => {
        e.stopPropagation();
        const pls = getPlaylists();
        const target = pls.find(p => p.id === plId);
        if (target) {
          target.tracks.splice(idx, 1);
          savePlaylists(pls);
          viewPlaylistDetails(plId);
        }
      });

      playlistContainer.appendChild(el);
    });
  }

  btnPlayAllPlaylist.addEventListener('click', () => {
    if (!viewingPlaylistId) return;
    const pl = getPlaylists().find(p => p.id === viewingPlaylistId);
    if (pl && pl.tracks.length > 0) {
      libraryDrawer.classList.add('hide');
      playTrackItem(pl.tracks[0], pl.tracks, 0);
    }
  });

  btnBackPlaylists.addEventListener('click', renderPlaylistsList);

  btnCreatePlaylist.addEventListener('click', () => {
    const name = playlistNewName.value.trim();
    if (!name) return;
    const pls = getPlaylists();
    pls.push({ id: `pl_${Date.now()}`, name, tracks: [] });
    savePlaylists(pls);
    playlistNewName.value = '';
    renderPlaylistsList();
  });

  // Add to Playlist Popover Modal
  function openAddToPlaylistModal(track) {
    pendingTrackToAddToPlaylist = track;
    playlistModal.classList.remove('hide');
    playlistModalList.innerHTML = '';
    const pls = getPlaylists();

    if (pls.length === 0) {
      playlistModalList.innerHTML = '<div class="library-empty-msg">No playlists created yet.</div>';
      return;
    }

    pls.forEach(pl => {
      const btn = document.createElement('button');
      btn.className = 'modal-pl-btn';
      btn.textContent = `${pl.name} (${pl.tracks.length} tracks)`;
      btn.addEventListener('click', () => {
        const allPls = getPlaylists();
        const target = allPls.find(p => p.id === pl.id);
        if (target) {
          if (!target.tracks.some(t => t.id === track.id)) {
            target.tracks.push(track);
            savePlaylists(allPls);
          }
        }
        playlistModal.classList.add('hide');
        if (activeTab === 'playlists' && viewingPlaylistId === pl.id) {
          viewPlaylistDetails(pl.id);
        }
      });
      playlistModalList.appendChild(btn);
    });
  }

  btnCloseModal.addEventListener('click', () => playlistModal.classList.add('hide'));

  // Drawer Tabs Switcher
  function switchDrawerTab(tabId) {
    activeTab = tabId;
    [tabCloud, tabFavs, tabPlaylists, tabSource].forEach(t => t.classList.remove('active'));
    [paneTracks, panePlaylists, paneSource].forEach(p => p.classList.add('hide'));

    if (tabId === 'cloud') {
      tabCloud.classList.add('active');
      paneTracks.classList.remove('hide');
      librarySearch.placeholder = "Search title, artist, or subfolder...";
      if (!isLibraryLoaded) fetchCloudLibrary();
      else renderLibraryList(true);
    } else if (tabId === 'favs') {
      tabFavs.classList.add('active');
      paneTracks.classList.remove('hide');
      librarySearch.placeholder = "Search favorites...";
      renderLibraryList(true);
    } else if (tabId === 'playlists') {
      tabPlaylists.classList.add('active');
      panePlaylists.classList.remove('hide');
      renderPlaylistsList();
    } else if (tabId === 'source') {
      tabSource.classList.add('active');
      paneSource.classList.remove('hide');
      inputCustomSource.value = localStorage.getItem('xm_custom_library_url') || '';
      libraryCount.textContent = "SOURCE CONFIG";
    }
  }

  tabCloud.addEventListener('click', () => switchDrawerTab('cloud'));
  tabFavs.addEventListener('click', () => switchDrawerTab('favs'));
  tabPlaylists.addEventListener('click', () => switchDrawerTab('playlists'));
  tabSource.addEventListener('click', () => switchDrawerTab('source'));

  // Source Configuration Events
  btnSaveSource.addEventListener('click', () => {
    let url = inputCustomSource.value.trim();
    if (url) {
      if (!url.endsWith('/')) url += '/';
      localStorage.setItem('xm_custom_library_url', url);
      sourceStatusMsg.textContent = 'Custom source saved. Syncing...';
    } else {
      localStorage.removeItem('xm_custom_library_url');
      sourceStatusMsg.textContent = 'Source reset to default XM-Music. Syncing...';
    }
    isLibraryLoaded = false;
    setTimeout(() => {
      sourceStatusMsg.textContent = '';
      switchDrawerTab('cloud');
    }, 800);
  });

  btnResetSource.addEventListener('click', () => {
    localStorage.removeItem('xm_custom_library_url');
    inputCustomSource.value = '';
    sourceStatusMsg.textContent = 'Reset to default XM-Music repository.';
    isLibraryLoaded = false;
    setTimeout(() => {
      sourceStatusMsg.textContent = '';
      switchDrawerTab('cloud');
    }, 600);
  });

  // Infinite Scroll Batching for 5,500 Tracks
  libraryList.addEventListener('scroll', () => {
    if (libraryList.scrollTop + libraryList.clientHeight >= libraryList.scrollHeight - 60) {
      const sourceList = (activeTab === 'favs') ? getFavorites() : filteredLibraryTracks;
      if (renderedCount < sourceList.length) {
        renderLibraryList(false);
      }
    }
  });

  // Instant Search Filter
  librarySearch.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase().trim();
    if (activeTab === 'favs') {
      renderLibraryList(true);
    } else {
      if (!q) {
        filteredLibraryTracks = fullLibraryTracks;
      } else {
        filteredLibraryTracks = fullLibraryTracks.filter(t => 
          (t.title && t.title.toLowerCase().includes(q)) ||
          (t.artist && t.artist.toLowerCase().includes(q)) ||
          (t.folder && t.folder.toLowerCase().includes(q))
        );
      }
      renderLibraryList(true);
    }
  });

  btnLibrary.addEventListener('click', () => {
    libraryDrawer.classList.remove('hide');
    switchDrawerTab(activeTab);
  });
  btnCloseLibrary.addEventListener('click', () => libraryDrawer.classList.add('hide'));
  btnFavCurrent.addEventListener('click', () => {
    if (currentActiveTrackItem) toggleFavoriteTrack(currentActiveTrackItem);
  });

  // Format Switchers
  btnFmtMp3.addEventListener('click', () => {
    if (activeFormat === 'mp3') return;
    activeFormat = 'mp3';
    btnFmtMp3.classList.add('active');
    btnFmtWav.classList.remove('active');
    qualityBadge.textContent = "320 KBPS";
    if (currentRawBuffer) {
      loadModule(currentRawBuffer, `${activeArtist ? activeArtist + ' - ' : ''}${activeTitle}`);
    }
  });

  btnFmtWav.addEventListener('click', () => {
    if (activeFormat === 'wav') return;
    activeFormat = 'wav';
    btnFmtWav.classList.add('active');
    btnFmtMp3.classList.remove('active');
    qualityBadge.textContent = "16-BIT PCM";
    if (currentRawBuffer) {
      loadModule(currentRawBuffer, `${activeArtist ? activeArtist + ' - ' : ''}${activeTitle}`);
    }
  });

  // Master Transport Controls
  btnPlayPause.addEventListener('click', () => {
    player.unlock();
    if (isNativeStream) {
      if (audioEl.paused) audioEl.play().catch(() => {});
      else audioEl.pause();
      setPlayingState(!audioEl.paused);
    } else {
      if (!player.currentPlayingNode && currentRawBuffer) {
        player.play(currentRawBuffer);
        setPlayingState(true);
      } else if (player.currentPlayingNode) {
        const isPaused = player.togglePause();
        setPlayingState(!isPaused);
      }
    }
  });

  btnStop.addEventListener('click', () => {
    if (isNativeStream) {
      audioEl.pause();
      audioEl.currentTime = 0;
    } else {
      player.stop();
    }
    progressBar.value = 0;
    timeCurrent.textContent = "00:00";
    setPlayingState(false);
  });

  let isLooping = true;
  btnLoop.addEventListener('click', () => {
    isLooping = !isLooping;
    btnLoop.classList.toggle('active', isLooping);
    audioEl.loop = isLooping;
    player.setRepeat(isLooping);
  });

  btnUnload.addEventListener('click', unloadModule);

  progressBar.addEventListener('input', () => { isSeeking = true; });
  progressBar.addEventListener('change', () => {
    const target = (progressBar.value / 100);
    if (isNativeStream && audioEl.duration) {
      audioEl.currentTime = target * audioEl.duration;
    } else if (!isNativeStream) {
      const dur = player.duration();
      if (dur > 0) player.seek(target * dur);
    }
    isSeeking = false;
  });

  volSlider.addEventListener('input', (e) => {
    const v = parseFloat(e.target.value);
    audioEl.volume = v;
    player.setVolume(v);
    updateVolumeDisplay(v);
    if (v > 0) prevVolume = v;
  });

  btnMute.addEventListener('click', () => {
    if (parseFloat(volSlider.value) > 0) {
      prevVolume = parseFloat(volSlider.value) || 0.85;
      audioEl.volume = 0;
      player.setVolume(0);
      updateVolumeDisplay(0);
    } else {
      const restore = prevVolume || 0.85;
      audioEl.volume = restore;
      player.setVolume(restore);
      updateVolumeDisplay(restore);
    }
  });

  btnDownload.addEventListener('click', () => {
    if (!currentAudioBlob) return;
    const ext = isNativeStream ? getFileExtension(activeTitle) : `.${activeFormat}`;
    const baseName = activeArtist ? `${activeArtist} - ${activeTitle}` : activeTitle;
    const filename = baseName.endsWith(ext) ? baseName : `${baseName}${ext}`;
    const a = document.createElement('a');
    a.href = currentAudioUrl;
    a.download = filename.replace(/[/\\?%*:|"<>]/g, '_');
    a.click();
  });

  btnBrowse.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      loadModule(e.target.files[0], e.target.files[0].name);
    }
  });

  btnDemo.addEventListener('click', () => {
    loadModule('https://deskjet.github.io/chiptune2.js/tunes/chipsounds.mod', 'Dubmood - Chipsounds.mod');
  });

  ['dragenter', 'dragover'].forEach(n => dropZone.addEventListener(n, (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  }));
  ['dragleave', 'drop'].forEach(n => dropZone.addEventListener(n, (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
  }));
  dropZone.addEventListener('drop', (e) => {
    if (e.dataTransfer.files.length > 0) {
      loadModule(e.dataTransfer.files[0], e.dataTransfer.files[0].name);
    }
  });

  audioEl.addEventListener('ended', playNextInQueue);
  player.on('onEnded', playNextInQueue);
});