# XM-Studio

> High-performance offline Digital Signal Processing (DSP) workstation, chiptune engine, and tracker module player for desktop and mobile browsers.

---

## Use the App

XM-Studio is designed to run directly in your browser with zero installation:

**Launch Online:** **[https://farhan-real.github.io/XM-Studio/](https://farhan-real.github.io/XM-Studio/)**

- **Runs Everywhere**: Works on Desktop and Android browsers (Chrome, Firefox, Safari, Edge).
- **100% Client-Side Privacy**: All audio synthesis, DSP mixing, and file processing happen locally on your computer via WebAudio. Nothing is uploaded to external servers.
- **Offline Capable**: Progressive web app architecture with a service worker for instant runtime caching.

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

### High Performance & Mobile Optimization
- **Offline Audio Compilation & Saving**: Compiles and exports tracker modules into standalone audio files (MP3/WAV), avoiding perpetual real-time DSP re-synthesis and eliminating the playback lag and audio stutter common in other tracker player websites.
- **Multithreaded Background Worker**: Offloads heavy tracker module rendering and LAME MP3 compilation to a dedicated Web Worker thread, keeping the UI running at a fluid 60 FPS during audio exports.
- **Native CSS Layout Virtualization**: Uses modern `content-visibility: auto` and `contain-intrinsic-size` to skip layout and paint passes for off-screen track cards, reducing DOM render time for 5,000+ tracks from ~400ms down to ~3ms.
- **Single-Node Event Delegation**: Replaces thousands of per-card event closures with container delegation, eliminating memory leaks and garbage collection stutters on mobile.
- **Intelligent Visualizer Sleep State**: Automatically pauses canvas render loops when audio stops or pauses, saving mobile CPU cycles and battery life.
- **DPR Throttling**: Caps canvas resolution to 1.5× DPR on high-density screens (reducing fill-rate overhead by up to 75% on 3×/4× mobile displays) and throttles rendering to a stable ~35 FPS.
- **Fast Polynomial DSP Soft-Clipping**: Replaces tens of thousands of continuous `Math.exp()` calculations per buffer with branch-predicted polynomial limiting, cutting audio process cycle time by up to 80% on mobile processors.

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
- **Local Directory Folder Sources**: Ingest entire local directories into the workstation via the Source tab. Subdirectories and metadata are preserved and persisted offline in IndexedDB.
- **Full ZIP Workstation Backup & Restore**: Export a complete `.zip` archive containing repository configurations, mounted local folders, playlist JSONs, `favorites.json`, `config.json`, `custom_music.json`, and raw custom audio files, or restore everything seamlessly.

---

## Music Repositories & XM-Music Integration

XM-Studio decouples the audio library from the player chassis to keep deployment packages small while streaming music over HTTPS only when required. By leveraging open CORS headers, it streams audio on demand directly into client-side DSP memory, eliminating proxy overhead and audio stutter while keeping the app ultra-lightweight and responsive.

### Default Repository: `XM-Music`
By default, XM-Studio connects to [**XM-Music**](https://github.com/farhan-real/XM-Music) (`https://farhan-real.github.io/XM-Music/`), streaming thousands of indexed chiptunes and demoscene tracker modules directly through GitHub Pages.

---

### How to Set Up Another Music Repository

You can host your own collection on GitHub Pages or any standard static web server and mount it directly into XM-Studio.

#### 1. Repository Directory Structure
Organize your audio files within a `music/` folder:

```text
My-Music-Repo/
├── tracks.json             <-- Root index manifest consumed by XM-Studio
├── generate_index.py       <-- Script to build tracks.json automatically
└── music/
    ├── Demoscene/
    │   └── Skaven - Catch That Goblin.xm
    └── Amiga/
        └── Jochen Hippel - Wings of Death.mod
```

File naming convention: `Artist - Title.ext` (e.g. `Purple Motion - Satellite One.s3m`).

#### 2. The `tracks.json` Manifest Format
At the root of your repository, supply a `tracks.json` array containing an entry for every track:

```json
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
| Field | Type | Description |
| :--- | :--- | :--- |
| `title` | `string` | Track song title displayed in the player and card lists. |
| `artist` | `string` | Composer or musician name. |
| `folder` | `string` | Category, subfolder, or collection label for searching and grouping. |
| `path` | `string` | Relative path to the audio file from the repository root. |
| `ext` | `string` | Uppercase audio format extension (`XM`, `MOD`, `IT`, `S3M`, `FLAC`, etc.). |

#### 3. Indexing Script (`generate_index.py`)
Use this Python script inside your repository to generate `tracks.json` recursively:

```python
import os, json, re

MUSIC_DIR = "music"
EXTS = (".xm", ".mod", ".it", ".s3m", ".mtm", ".flac", ".mp3", ".ogg", ".wav", ".v2m", ".mid", ".ahx", ".sid")

tracks = []
for root, _, files in os.walk(MUSIC_DIR):
    for f in sorted(files):
        ext = os.path.splitext(f)[1].lower()
        if ext in EXTS:
            rel = os.path.relpath(os.path.join(root, f), ".").replace("\\", "/")
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
1. Push your repository to GitHub.
2. Go to **Settings** → **Pages** → select **Deploy from a branch** (`main` / root).
3. GitHub Pages automatically serves files with open `Access-Control-Allow-Origin: *` headers, allowing XM-Studio to stream and decode files into WebAudio buffers.

#### 5. Connect to XM-Studio
1. In XM-Studio, click the **Source** tab in the navigation bar.
2. Under **Online Repositories (Multiple)**, enter your repository URL:
   ```text
   https://<your-username>.github.io/<repo-name>/
   ```
3. Click **+ Add**, then click **Sync All Repos**.
4. Tracks from all active repositories will blend into the unified **Archive** list.

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
        ├── sources.js       # Multiple repository aggregator & local folder sources
        ├── library.js       # Catalog fetcher, live search & archive list
        ├── playlist.js      # Playlist CRUD storage, export/import & dialogs
        └── zip.js           # Client-side ZIP writer and extractor
```

---

## License

XM-Studio is open source under the MIT License. Built with `libopenmpt` (BSD-3-Clause) and `lamejs` (LGPL).