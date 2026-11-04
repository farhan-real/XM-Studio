# XM-Studio

> High-performance offline Digital Signal Processing (DSP) workstation,
> chiptune engine, and tracker module player for desktop and mobile
> browsers.

------------------------------------------------------------------------

## Use the App

XM-Studio is designed to run directly in your browser with zero
installation:

**Launch Online:** **<https://farhan-real.github.io/XM-Studio/>**

-   **Runs Everywhere**: Works on Desktop and Android browsers (Chrome,
    Firefox, Safari, Edge).
-   **100% Client-Side Privacy**: All audio synthesis, DSP mixing, and
    file processing happen locally on your computer via WebAudio.
    Nothing is uploaded to external servers.
-   **Offline Capable**: Progressive web app architecture with a service
    worker for instant runtime caching.

------------------------------------------------------------------------

## Overview

XM-Studio plays, visualizes, curates, and exports classic tracker music
modules along with modern lossless and compressed audio streams:

-   **FastTracker II (`.xm`)**
-   **ProTracker (`.mod`)**
-   **Impulse Tracker (`.it`)**
-   **ScreamTracker (`.s3m`)**
-   **Lossless & Native Streams (`.flac`, `.wav`, `.mp3`, `.ogg`)**

Powered by `libopenmpt` compiled to WebAssembly, XM-Studio provides
sample-accurate hardware synthesis, sinc interpolation, stereo
separation, and responsive frequency spectrum analysis.

------------------------------------------------------------------------

## Features

### Audio Engine & Real-Time DSP

-   **Tracker DSP Engine**: Full module playback via `libopenmpt`
    running at 48 kHz with persistent WASM stereo PCM scratch buffers
    and single-pass metadata extraction.
-   **Ultra-Low-Latency Transport**: Interactive 2048-frame WebAudio
    buffer (~42ms) with instant graph node disconnect/reconnect on
    pause for sub-3ms play/pause response and 0% paused DSP CPU usage.
-   **Lossless FLAC & Native Audio Support**: Direct hardware-accelerated
    playback for `.flac`, `.mp3`, `.wav`, and native audio streams routed
    through WebAudio with automatic ObjectURL lifecycle cleanup.
-   **Seamless Post-Compile Native Playback**: After compiling tracker
    modules into 320kbps MP3 or 16-bit WAV, playback hands off immediately
    into native hardware audio stream mode without losing playback position,
    completely eliminating DSP overhead and audio lag.
-   **Artifact-Free Audio Compilation**: 1152-sample aligned frame blocks
    and continuous soft limiting eliminate bit reservoir underflow, frame drops,
    and harsh clipping distortion during MP3 and WAV rendering.
-   **Phosphor Spectrum Visualizer**: 28-band real-time audio analyzer
    rendered to HTML5 Canvas with device-pixel-ratio display scaling and
    color-batched draw calls for both tracker modules and native streams.
-   **Master Audio Compiler**: Export tracker modules on-demand to MP3
    (320kbps CBR via LAME) or uncompressed WAV (16-bit PCM) without
    interrupting playback.

### High Performance & Mobile Optimization

-   **Background Playback & Lock-Screen Controls**: Continues playing
    seamlessly when switching apps or locking the phone screen via an
    accurate in-memory audio carrier, automatic `AudioContext` resumption,
    and full `navigator.mediaSession` integration for lock-screen,
    notification shade, and Bluetooth headset controls.
-   **Spotify-Style Mobile Miniplayer**: Displays a docked compact
    bottom bar on the mobile Archive & Playlists view showing the track
    number badge, song title, artist, and Prev/Play/Next controls, while
    providing the full hardware deck on the Player Deck tab.
-   **Persistent 32-Node DOM Pool & Custom Scroller**: Virtualizes
    5,000+ track catalogs by recycling a fixed pool of 32 GPU-translated
    (`translate3d`) DOM nodes without detaching active touch targets
    during Android momentum scrolling, paired with a zero-reflow custom
    scrollbar.
-   **Metadata-Only RAM Caching**: Strips raw audio `Blob` payloads from
    in-memory catalog arrays and loads binary blobs from IndexedDB
    strictly on demand, keeping heap usage minimal even with hundreds of
    local tracks mounted.
-   **Multithreaded Background Worker**: Loads `lame.min.js` exclusively
    inside a dedicated Web Worker thread with zero-copy `ArrayBuffer`
    transfers, keeping the main UI thread lightweight and running at 60
    FPS.
-   **Single-Node Event Delegation**: Uses container-level event
    delegation across the Archive, Playlists, and Source managers to
    eliminate per-card closures and garbage collection pauses.
-   **Intelligent Sleep States**: Automatically pauses canvas
    `requestAnimationFrame` loops and UI progress timers when audio is
    paused, stopped, or running in a background tab.
-   **DPR Throttling**: Caps canvas resolution to 1.5× DPR on
    high-density screens (reducing fill-rate overhead by up to 75% on
    3×/4× mobile displays) and throttles rendering to a stable ~33 FPS.

### Workstation Transport Controls

-   **Shuffle & Loop Controls**: Dedicated transport buttons for queue
    randomization and track looping.
-   **Interactive Scrubber**: Timeline progress slider with elapsed and
    total time readouts.
-   **Master Volume Fader**: Hardware fader cluster with percentage
    display and mute toggle.
-   **Drag-and-Drop Files**: Drop tracker files or audio tracks directly
    onto the deck chassis.

### Collection Explorer & Playlists

-   **Numbered Multi-Line Track Cards**: Sequential numerical track
    indices (`1`, `2`, `3`...) with track title, artist, and format
    tags. Entire card surface is clickable to play.
-   **Bold Favorites**: Starred favorites stand out in bold typography
    with a warm gold ambient tone and $O(1)$ `Set` lookup caching.
-   **Playlist Manager with Shuffle**: Create, rename, delete playlists,
    launch randomized shuffle playback, and add tracks from the
    collection.
-   **Per-Playlist Import & Export**: Export any individual playlist to
    a clean `.json` file or import playlists directly.
-   **Local Directory Folder Sources**: Ingest entire local directories
    into the workstation via the Source tab using single-transaction
    batch IndexedDB writes. Subdirectories and metadata are preserved
    and persisted offline in IndexedDB.
-   **Full ZIP Workstation Backup & Restore**: Export a complete `.zip`
    archive containing repository configurations, mounted local folders,
    playlist JSONs, `favorites.json`, `config.json`,
    `custom_music.json`, and raw custom audio files, or restore
    everything seamlessly.

------------------------------------------------------------------------

## Music Repositories & XM-Music Integration

XM-Studio decouples the audio library from the player chassis to keep
deployment packages small while streaming music over HTTPS only when
required. By leveraging open CORS headers, it streams audio on demand
directly into client-side DSP memory, eliminating proxy overhead and
audio stutter while keeping the app ultra-lightweight and responsive.

### Default Repository: `XM-Music`

By default, XM-Studio connects to
**[XM-Music](https://github.com/farhan-real/XM-Music)**
(`https://farhan-real.github.io/XM-Music/`),
streaming thousands of indexed chiptunes and demoscene tracker modules
directly through GitHub Pages.

------------------------------------------------------------------------

### How to Set Up Another Music Repository

You can host your own collection on GitHub Pages or any standard static
web server and mount it directly into XM-Studio.

#### 1. Repository Directory Structure

Organize your audio files within a `music/` folder:

``` text
My-Music-Repo/
├── tracks.json             <-- Root index manifest consumed by XM-Studio
├── generate_index.py       <-- Script to build tracks.json automatically
└── music/
    ├── Demoscene/
    │   └── Skaven - Catch That Goblin.xm
    └── Amiga/
        └── Jochen Hippel - Wings of Death.mod
```

File naming convention: `Artist - Title.ext`
(e.g. `Purple Motion - Satellite One.s3m`).

#### 2. The `tracks.json` Manifest Format

At the root of your repository, supply a `tracks.json` array containing
an entry for every track:

``` json
[
  {
    "title": "Catch That Goblin",
    "artist": "Skaven",
    "folder": "Demoscene",
    "path": "music/Demoscene/Skaven - Catch That Goblin.xm",
    "ext": "XM"
  },
  {
    "title": "Wings of Death",
    "artist": "Jochen Hippel",
    "folder": "Amiga",
    "path": "music/Amiga/Jochen Hippel - Wings of Death.mod",
    "ext": "MOD"
  }
]
```

#### Field Specifications

-------------------------------------------------------------------------
Field                   Type                    Description
----------------------- ----------------------- -------------------------
`title`                 `string`                Track song title
                                                displayed in the player
                                                and card lists.

`artist`                `string`                Composer or musician
                                                name.

`folder`                `string`                Category, subfolder, or
                                                collection label for
                                                searching and grouping.

`path`                  `string`                Relative path to the
                                                audio file from the
                                                repository root.

`ext`                   `string`                Uppercase audio format
                                                extension (`XM`, `MOD`,
                                                `IT`, `S3M`, `FLAC`,
                                                etc.).
-------------------------------------------------------------------------

#### 3. Indexing Script (`generate_index.py`)

Use this Python script inside your repository to generate `tracks.json`
recursively:

``` python
import os, json, re

MUSIC_DIR = "music"
EXTS = (".xm", ".mod", ".it", ".s3m", ".mtm", ".flac", ".mp3", ".ogg", ".wav", ".v2m", ".mid", ".ahx", ".sid")

tracks = []
for root, _, files in os.walk(MUSIC_DIR):
    for f in sorted(files):
        ext = os.path.splitext(f)[1].lower()
        if ext in EXTS:
            rel = os.path.relpath(os.path.join(root, f), ".").replace("\\\\", "/")
            base = re.sub(r'\s+', ' ', f.rsplit(".", 1)[0].replace("_-_", " - ").replace("_", " ")).strip()
            artist, title = base.split(" - ", 1) if " - " in base else ("Unknown Artist", base)
            folder = os.path.basename(root)
            tracks.append({
                "title": title.strip(),
                "artist": artist.strip(),
                "folder": folder if folder.lower() != "music" else "Root",
                "path": rel,
                "ext": ext.replace(".", "").upper()
            })

with open("tracks.json", "w", encoding="utf-8") as out:
    json.dump(tracks, out, indent=2, ensure_ascii=False)
```

#### 4. Enable GitHub Pages & Cross-Origin Access

1.  Push your repository to GitHub.
2.  Go to **Settings** → **Pages** → select **Deploy from a branch**
    (`main` / root).
3.  GitHub Pages automatically serves files with open
    `Access-Control-Allow-Origin: *` headers, allowing XM-Studio to
    stream and decode files into WebAudio buffers.

#### 5. Connect to XM-Studio

1.  In XM-Studio, click the **Source** tab in the navigation bar.
2.  Under **Online Repositories (Multiple)**, enter your repository URL:

``` text
https://<your-username>.github.io/<repo-name>/
```

3.  Click **+ Add**, then click **Sync All Repos**.
4.  Tracks from all active repositories will blend into the unified
    **Archive** list.

------------------------------------------------------------------------

## Supported Formats

-------------------------------------------------------------------------
Category                            File Extensions
----------------------------------- -------------------------------------
**Tracker Modules**                 `.xm`, `.mod`, `.it`, `.s3m`,
                                    `.mtm`, `.mo3`, `.med`, `.669`,
                                    `.far`, `.ptm`

**Chiptune & Retro**                `.v2m`, `.ahx`, `.sid`, `.sap`,
                                    `.ym`, `.nsf`, `.spc`, `.mid`

**Native Audio Streams**            `.flac` (Lossless), `.wav` (PCM),
                                    `.mp3` (MPEG Layer 3), `.ogg`
                                    (Vorbis)
-------------------------------------------------------------------------

------------------------------------------------------------------------

## Local Development (Python)

If you prefer to run or test XM-Studio locally, serve the directory with
Python:

``` bash
# Clone the repository
git clone https://github.com/farhan-real/XM-Studio.git
cd XM-Studio

# Start local server with Python
python3 -m http.server 8080
```

Open `http://localhost:8080` in your web browser.

------------------------------------------------------------------------

## Directory Architecture

``` text
.
├── index.html               # Workstation HTML layout
├── manifest.json            # PWA manifest
├── service-worker.js        # Offline asset caching with zero UI caching
├── icon.svg                 # Application chassis icon
├── README.md                # Documentation
├── css/
│   ├── main.css             # Chassis layout, mobile miniplayer dock & scrollbars
│   ├── player.css           # Hardware badges, visualizer & miniplayer rules
│   ├── controls.css         # Dual-row transport buttons, fader & ingest deck
│   ├── tracks.css           # Pooled virtual track cards & custom scrollbar
│   └── library.css          # Navigation tabs, playlists & source configuration
└── js/
    ├── app.js               # Application coordinator, transport & view toggles
    ├── engine/
    │   ├── audio.js         # Master audio coordinator, handoff & playback queue
    │   ├── background.js    # Chrome MediaSession, carrier sync & lock-screen API
    │   ├── chiptune2.js     # Low-latency libopenmpt WebAudio DSP player engine
    │   ├── compiler.js      # Background Worker coordinator for WAV/MP3 exports
    │   ├── visualizer.js    # 28-band canvas spectrum visualizer loop
    │   └── worker.js        # Multithreaded OpenMPT & LAME MP3 encoding worker
    └── data/
        ├── backup.js        # ZIP backup export & batched restore manager
        ├── custom.js        # Metadata-cached IndexedDB manager for custom tracks
        ├── sources.js       # Multi-repository aggregator & local folder sources
        ├── scroller.js      # Zero-reflow custom scrollbar & touch momentum engine
        ├── library.js       # 32-node pooled virtual list & pre-indexed search
        ├── playlist.js      # Cached Playlist CRUD, Set favorites & modals
        └── zip.js           # Client-side ZIP writer and extractor
```

------------------------------------------------------------------------

## License

XM-Studio is open source under the MIT License. Built with `libopenmpt`
(BSD-3-Clause) and `lamejs` (LGPL).