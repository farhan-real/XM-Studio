# XM-Studio

> High-performance offline Digital Signal Processing (DSP) workstation, chiptune engine, and tracker module player for desktop and mobile browsers.

---

## Use the App

XM-Studio runs directly in any modern web browser with zero installation:

**Launch Online:** **<https://farhan-real.github.io/XM-Studio/>**

* **Runs Everywhere:** Works seamlessly across Desktop and Android browsers (Chrome, Firefox, Safari, Edge).
* **100% Client-Side Privacy:** All audio synthesis, DSP mixing, and file processing happen locally via WebAssembly and Web Audio. Nothing is uploaded to external servers.
* **Offline Capable:** Progressive Web App (PWA) with runtime caching for instant offline playback.

---

## Overview

XM-Studio plays, visualizes, curates, and exports classic tracker music modules along with modern lossless and compressed audio streams:

* **FastTracker II (`.xm`)**
* **ProTracker (`.mod`)**
* **Impulse Tracker (`.it`)**
* **ScreamTracker (`.s3m`)**
* **Lossless & Native Streams (`.flac`, `.wav`, `.mp3`, `.ogg`)**

Powered by `libopenmpt` compiled to WebAssembly, XM-Studio provides sample-accurate hardware synthesis, sinc interpolation, stereo separation, and responsive frequency spectrum analysis.

---

## Features

### Audio Engine & Multithreaded DSP

* **Worker-to-Worklet Multithreaded Pipeline:** Offloads 100% of OpenMPT module synthesis into a dedicated background Web Worker (`dspworker.js`) communicating directly with a real-time `AudioWorkletProcessor` (`worklet.js`) via a zero-copy transferable `MessagePort`. The browser's main UI thread never handles audio calculations, eliminating stutter and removing the legacy `ScriptProcessorNode` deprecation warning.
* **48 kHz Sample-Accurate Synthesis:** Synthesizes audio natively at 48,000 Hz with interactive latency hints. Automatically detects device DAC capabilities to prevent resampling jitter, frequency aliasing, or pitch drift on hardware locked to 44.1 kHz or higher sample rates.
* **Deep Jitter-Buffered Worklet Queue:** Maintains a 1.2-second (14-chunk) pre-buffered FIFO queue on the audio thread with proactive low-watermark refilling and instant underrun recovery, insulating playback from background thread scheduling delays and GC pauses.
* **0.03ms Fast TypedArray Memory Transfers:** OpenMPT PCM buffer copies use native vector operations (`TypedArray.prototype.set`), cutting block transfer time from legacy 4,096-iteration loops (~4.5ms) down to **0.03ms** per block.
* **Persistent WASM Scratch Buffers:** Pre-allocated `_malloc` scratch buffers prevent repeated heap allocation and memory fragmentation in WebAssembly memory.
* **25 Hz DC-Blocking Highpass Filter:** Biquad highpass filter cuts sub-audible infrasound and DC bias inherent in retro tracker instruments before reaching the output stage.
* **Seamless Post-Compile Native Stream Handoff:** Tracker modules compiled into 320k MP3 or 16-bit WAV hand off directly to native hardware `<audio>` without losing playback position, dropping DSP CPU overhead to 0%.
* **Artifact-Free Audio Compilation:** 1152-sample aligned frame blocks and continuous soft limiting eliminate bit reservoir underflow, frame drops, and harsh clipping distortion during MP3 and WAV rendering.
* **Precomputed Visualizer Spectrum Caching:** The background worker analyzes and caches 28-band frequency spectrum frames during compilation, enabling $O(1)$ zero-CPU visualizer rendering during native playback.
* **Lossless FLAC & Native Hardware Audio:** Direct hardware-accelerated playback for `.flac`, `.mp3`, and `.wav` with automatic `URL.revokeObjectURL` lifecycle cleanup.

### High Performance & Mobile Optimization

* **Canvas Resolution Throttling (1.25× DPR Cap):** Caps canvas pixel density to 1.25× DPR on high-density mobile screens (instead of 2×–3×), reducing GPU fill-rate overhead and memory bandwidth by over 60%.
* **Ultra-Lightweight 20 FPS Spectrum Visualizer:** 28-band audio analyzer paced at a stable 20 FPS (50ms interval) with static logarithmic bin mapping and an integer palette hierarchy.
* **Visualizer Scroll Throttling:** Automatically drops the visualizer frame rate to 10 FPS during active touch scrolling or drag interactions to prevent frame drops on low-end devices.
* **Complete Background Render Sleep:** Automatically shuts down all canvas rendering, explicitly cancels `requestAnimationFrame` loops, and pauses UI progress timers whenever the tab is hidden or screen is locked, dedicating 100% of CPU resources to audio synthesis.
* **Persistent 32-Node DOM Virtualization:** Virtualizes catalogs of 5,000+ tracks by recycling a fixed pool of 32 GPU-translated (`translate3d`) DOM nodes without detaching active touch targets during Android momentum scrolling.
* **Zero-Reflow Custom Scrollbar & rAF Momentum Engine:** Touch momentum physics decoupled from DOM writes via `requestAnimationFrame` batching, preventing style recalculation thrashing during scrolling.
* **Diff-Cached DOM Updates:** Compares track IDs and indices before mutating DOM nodes, eliminating unnecessary class changes and attribute writes.
* **Single-Node Event Delegation:** Container-level event delegation across the Archive, Playlists, and Source panels eliminates thousands of per-card event closures and garbage collection pauses.

### Memory, Storage & Catalog

* **Metadata-Only RAM Caching:** Strips raw audio `Blob` payloads from in-memory catalog arrays and loads binary blobs from IndexedDB strictly on demand, keeping heap usage minimal even with thousands of local tracks mounted.
* **Pre-Indexed $O(1)$ Search Strings:** Pre-computes lowercased null-delimited search strings (`artist\0title\0folder`) on track objects during indexing for sub-millisecond filtering.
* **$O(1)$ Favorites Set Caching:** Starred favorites use an in-memory `Set` lookup cache for instant favorite status checks during virtual list rendering.
* **Single-Transaction Batch IndexedDB Operations:** Ingests local directory folders and restores workstation backups using bulk `readwrite` object store transactions.
* **Pure JavaScript Zero-Dependency ZIP Engine:** Streaming ZIP writer and reader with CRC-32 and Deflate/Inflate stream support.

### Background Playback & OS Integration

* **Chrome Media Visibility & Tab Audio Indicators:** Displays the browser tab speaker icon, Desktop Chrome Global Media Controls, and dynamic tab titles (`▶ Song Title - Artist`).
* **Persistent Audio Focus & Media Carrier:** Continuous silent carrier audio element with `duration >= 10s` and `loadedmetadata` synchronization to satisfy Chrome's 5-second audio-focus policy.
* **Full MediaSession Integration:** Lock-screen, notification shade, and Bluetooth controls for play/pause, prev, next, stop, seekto, and skip with dual SVG/PNG rasterized artwork.
* **Spotify-Style Mobile Miniplayer:** Compact docked bottom bar on the mobile Archive & Playlists view showing track number badge, song title, artist, and transport controls, with one-tap toggle to the full Player Deck.

### Workstation Transport Controls

* **Deck Favorite & Playlist Picker:** Star and Plus buttons located directly to the left of main transport controls to toggle favorites or add the current track to any playlist on the fly.
* **Random Jump to Archive:** Clicking the random track button automatically selects a track, switches to the Archive view, and smoothly centers the scroller on the active track.
* **Two-Digit Digital Track Number Display:** Formats track numbers (`01`, `02`...) in both desktop player deck and mobile miniplayer.
* **Interactive Scrubber & Hardware Fader:** Timeline progress slider with elapsed/total time readouts, and master volume fader with mute toggle.
* **Drag-and-Drop Ingestion:** Drop tracker files or audio tracks directly onto the deck chassis.

### Multi-Source Catalog & Directory Mounting

* **Multi-Repository Streaming:** Stream and aggregate tracker modules from multiple online repositories simultaneously, featuring native support for primary and mirrored backup sources (`XM-Music`, `XM-Archive`).
* **Independent Source & Folder Toggling:** Instantly toggle individual remote repositories and mounted local folder sources on or off via dedicated controls to isolate collections without deleting catalog data.
* **Local Directory Ingestion:** Mount entire local folder trees recursively using the directory picker, mapping nested folder hierarchies and caching binary blobs directly in IndexedDB with on-demand retrieval.
* **Fault-Tolerant Offline Fallback:** Automatically activates verified demoscene modules when remote repositories are unreachable or offline, guaranteeing continuous workstation functionality without an active internet connection.

---

## Supported Formats

| Category | File Extensions |
| :--- | :--- |
| **Tracker Modules** | `.xm`, `.mod`, `.it`, `.s3m`, `.mtm`, `.mo3`, `.med`, `.669`, `.far`, `.ptm` |
| **Chiptune & Retro** | `.v2m`, `.ahx`, `.sid`, `.sap`, `.ym`, `.nsf`, `.spc`, `.mid` |
| **Native Audio Streams** | `.flac` (Lossless), `.wav` (PCM), `.mp3` (MPEG Layer 3), `.ogg` (Vorbis) |

---

## Music Repositories & XM-Music Integration

XM-Studio decouples the audio library from the player chassis to keep deployment packages small while streaming music over HTTPS only when required. By leveraging open CORS headers, it streams audio on demand directly into client-side DSP memory.

### Default Repository: `XM-Music`

By default, XM-Studio connects to **[XM-Music](https://github.com/farhan-real/XM-Music)** (`https://farhan-real.github.io/XM-Music/`), streaming thousands of indexed chiptunes and demoscene tracker modules directly through GitHub Pages.

### Backup Repository: `XM-Archive`

XM-Studio includes **XM-Archive** (`https://xm-archive.pages.dev/`) as a built-in secondary backup repository (toggled off by default). Enable it under the **Source** tab to stream additional demoscene modules and mirrored chiptune releases.

---

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

```text
.
├── index.html                  # Workstation HTML chassis layout
├── manifest.json               # Progressive Web App manifest
├── service-worker.js           # Offline runtime asset caching
├── icon.svg                    # Application chassis icon
├── README.md                   # Technical documentation
├── css/
│   ├── main.css                # Chassis base layout & global tokens
│   ├── badges.css              # Audio engine & hardware badges
│   ├── player.css              # Deck chassis, readout & mobile miniplayer
│   ├── controls.css            # Transport controls, fader & buttons
│   ├── tracks.css              # Virtual list viewport & custom scrollbar
│   └── library.css             # Navigation tabs & source configuration
└── js/
    ├── app.js                  # Main workstation transport coordinator
    ├── engine/
    │   ├── dsp/
    │   │   ├── audio.js        # Master audio coordinator & stream handoff
    │   │   ├── background.js   # MediaSession, lock screen & carrier audio
    │   │   ├── chiptune2.js    # AudioWorklet player manager & event bus
    │   │   ├── queue.js        # Playback queue, shuffle & loop manager
    │   │   └── visualizer.js   # 28-band canvas spectrum visualizer loop
    │   ├── export/
    │   │   ├── compiler.js     # Background export worker coordinator
    │   │   └── export.js       # Export format selection & file ingest deck
    │   └── workers/
    │       ├── dspworker.js    # Background libopenmpt synthesis worker
    │       ├── worker.js       # Background LAME MP3 / WAV compilation worker
    │       └── worklet.js      # Native audio thread AudioWorkletProcessor
    └── data/
        ├── catalog/
        │   ├── catalog.js      # Catalog indexing, search filtering & sorting
        │   └── sources.js      # Multi-repo aggregator & local folder sources
        ├── playlist/
        │   ├── playlist.js     # Playlist CRUD, favorites Set & persistence
        │   └── playlistui.js   # Playlist UI rendering & modals
        ├── storage/
        │   ├── backup.js       # Full workstation ZIP export & restore
        │   ├── custom.js       # IndexedDB track metadata & blob storage
        │   └── zip.js          # Pure JS binary ZIP writer & reader
        └── view/
            ├── library.js      # Virtual DOM card pool & archive table
            └── scroller.js     # Zero-reflow custom scrollbar & momentum
```

---

## License

XM-Studio is open source under the MIT License. Built with `libopenmpt` (BSD-3-Clause) and `lamejs` (LGPL).