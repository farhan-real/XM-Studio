# XM-Studio

> High-performance offline Digital Signal Processing (DSP) workstation, chiptune engine, and tracker module player for desktop and mobile browsers.

---

## Use the App

XM-Studio is designed to run directly in your browser with zero installation:

**Launch Online:** **[https://farhan-real.github.io/XM-Studio/](https://farhan-real.github.io/XM-Studio/)**

- **Runs Everywhere**: Works on Desktop and Android browsers (Chrome, Firefox, Safari, Edge).
- **100% Client-Side Privacy**: All audio synthesis, DSP mixing, and file processing happen locally on your computer via WebAudio. Nothing is uploaded to external servers.
- **Offline Capable**: Progressive web app structure with a service worker for instant runtime caching.

---

## Overview

XM-Studio plays, visualizes, curates, and exports classic tracker music modules along with modern lossless and compressed audio streams:
- **FastTracker II (`.xm`)**
- **ProTracker (`.mod`)**
- **Impulse Tracker (`.it`)**
- **ScreamTracker (`.s3m`)**
- **Lossless & Native Streams (`.flac`, `.wav`, `.mp3`, `.ogg`)**

Powered by `libopenmpt` compiled to WebAssembly, XM-Studio provides sample-accurate hardware synthesis, sinc interpolation, stereo separation, and responsive frequency spectrum analysis.

---

## Features

### Audio Engine & Real-Time DSP
- **Tracker DSP Engine**: Full module playback via `libopenmpt` running at 48 kHz.
- **Lossless FLAC Support**: Direct hardware-accelerated playback for `.flac` and native audio streams routed through WebAudio.
- **Phosphor Spectrum Visualizer**: 28-band real-time audio analyzer rendered to HTML5 Canvas with device-pixel-ratio display scaling.
- **Master Audio Compiler**: Export tracker modules on-demand to MP3 (320kbps CBR via LAME) or uncompressed WAV (16-bit PCM) without interrupting playback.

### Workstation Transport Controls
- **Shuffle & Loop Controls**: Dedicated transport buttons for queue randomization and track looping.
- **Interactive Scrubber**: Timeline progress slider with elapsed and total time readouts.
- **Master Volume Fader**: Hardware fader cluster with percentage display and mute toggle.
- **Drag-and-Drop Files**: Drop tracker files or audio tracks directly onto the deck chassis.

### Collection Explorer & Playlists
- **Numbered Multi-Line Track Cards**: Sequential numerical track indices (`1`, `2`, `3`...) with track title, artist, and format tags. Entire card surface is clickable to play.
- **Bold Favorites**: Starred favorites stand out in bold typography with a warm gold ambient tone.
- **Playlist Manager with Shuffle**: Create, rename, delete playlists, launch randomized shuffle playback, and add tracks from the collection.
- **Per-Playlist Import & Export**: Export any individual playlist to a clean `.json` file or import playlists directly.
- **Local Custom Music (IndexedDB)**: Add custom music files directly in the Source tab. Files persist permanently in your browser's local database and blend into the Archive.
- **Full ZIP Workstation Backup & Restore**: Export a complete `.zip` archive containing individual playlist JSONs, `favorites.json`, `config.json`, `custom_music.json`, and raw custom audio files, or restore everything seamlessly.

---

## Supported Formats

| Category | File Extensions |
| :--- | :--- |
| **Tracker Modules** | `.xm`, `.mod`, `.it`, `.s3m`, `.mtm`, `.mo3`, `.med`, `.669`, `.far`, `.ptm` |
| **Chiptune & Retro** | `.v2m`, `.ahx`, `.sid`, `.sap`, `.ym`, `.nsf`, `.spc`, `.mid` |
| **Native Audio Streams** | `.flac` (Lossless), `.wav` (PCM), `.mp3` (MPEG Layer 3), `.ogg` (Vorbis) |

---

## Local Development (Python)

If you prefer to run or test XM-Studio locally, serve the directory with Python:

```bash
# Clone the repository
git clone https://github.com/farhan-real/XM-Studio.git
cd XM-Studio

# Start local server with Python
python3 -m http.server 8080
```

Open `http://localhost:8080` in your web browser.

---

## Dependencies Reference

All runtime dependencies (`libopenmpt.js`, `libopenmpt.js.mem`, and `lame.min.js`) are already included inside the `js/` directory.

If you ever need to manually re-download or update them, run:

```bash
curl -L -o js/libopenmpt.js https://cdn.jsdelivr.net/gh/deskjet/chiptune2.js@master/libopenmpt.js
curl -L -o js/libopenmpt.js.mem https://cdn.jsdelivr.net/gh/deskjet/chiptune2.js@master/libopenmpt.js.mem
curl -L -o js/lame.min.js https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.min.js
```

---

## Directory Architecture

```
.
├── index.html               # Workstation HTML layout
├── manifest.json            # PWA manifest
├── service-worker.js        # Offline asset caching with zero UI caching
├── icon.svg                 # Application chassis icon
├── README.md                # Documentation
├── css/
│   ├── main.css             # Chassis layout, typography & wide scrollbars
│   ├── player.css           # Hardware badges, visualizer & transport controls
│   ├── tracks.css           # Multi-line track card list, numbering & format tags
│   └── library.css          # Navigation tabs, playlists & source configuration
└── js/
    ├── app.js               # Application coordinator & transport bindings
    ├── engine/
    │   ├── audio.js         # Master audio coordinator, queue & shuffle
    │   ├── chiptune2.js     # libopenmpt WebAudio DSP player engine
    │   ├── compiler.js      # On-demand WAV & LAME MP3 background compiler
    │   └── visualizer.js    # 28-band canvas spectrum visualizer loop
    └── data/
        ├── backup.js        # ZIP backup export & restore manager
        ├── custom.js        # IndexedDB storage for user-uploaded custom tracks
        ├── library.js       # Catalog fetcher, live search & archive list
        ├── playlist.js      # Playlist CRUD storage, export/import & dialogs
        └── zip.js           # Client-side ZIP writer and extractor
```

---

## License

XM-Studio is open source under the MIT License. Built with `libopenmpt` (BSD-3-Clause) and `lamejs` (LGPL).