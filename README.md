# XM-Studio

> High-performance offline Digital Signal Processing (DSP) workstation, chiptune engine, and tracker module player for desktop and mobile browsers.

---

## Use the App

XM-Studio runs directly in any modern web browser with zero installation:

**Launch Online:** **[farhan-real.github.io/XM-Studio](https://farhan-real.github.io/XM-Studio)** or **[xm-studio.pages.dev](https://xm-studio.pages.dev/)**

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
* **Chiptune & Retro (`.v2m`, `.ahx`, `.sid`, `.mid`)**
* **Lossless & Native Streams (`.flac`, `.wav`, `.mp3`, `.ogg`)**

Powered by `libopenmpt` compiled to WebAssembly, XM-Studio provides sample-accurate hardware synthesis, sinc interpolation, stereo separation, and responsive frequency spectrum analysis.

---

## The Hybrid Dual-Engine Architecture

Tracker modules (`.xm`, `.mod`, etc.) are musical instructions with instrument samples, not linear audio files. Real-time software synthesis can drain mobile batteries, while waiting for file encoding before playback causes awkward delays.

XM-Studio solves this with an intelligent **three-phase playback pipeline**:

```text
[Select Track] ──▶ Phase 1: Real-time Live DSP (0ms Instant Sound)
                        │
                        ▼ (Parallel off-thread Web Worker)
                   Phase 2: Background Compilation (MP3/WAV + Calibrated FFT Spectrum)
                        │
                        ▼ (Upon 100% render completion)
                   Phase 3: Seamless Native Handoff (0% DSP CPU, Battery Friendly)
```

### Phase 1: Instant Start (`PLAYBACK: LIVE`)
* The moment you tap a tracker module, raw binary is dispatched to an isolated WebAssembly synthesis worker (`dspworker.js` running `libopenmpt`).
* Float PCM chunks stream through a zero-copy transferable `MessagePort` directly into a hardware-thread `AudioWorkletProcessor` (`worklet.js`).
* Playback begins **instantly with 0ms latency**.
* Deck status glows green: **`PLAYBACK: LIVE`**.

### Phase 2: Parallel Background Compilation (`COMPILE: COMPILING`)
* An independent compilation worker (`worker.js`) renders the full song in the background into 320k MP3 or 16-bit WAV audio.
* Simultaneously, the worker precomputes 28-band frequency spectrum frames for every frame of the song into an array buffer (`visData`).
* Because rendering executes on a separate CPU core, **the playing music never stutters, drops frames, or glitches**.
* Deck status pulses gold with live progress: **`COMPILE: COMPILING`** (e.g. `45%`).

### Phase 3: Seamless Native Handoff (`PLAYBACK: LOADED`)
* The moment compilation reaches 100%, the compiled `Blob` and precomputed visualizer data are cached in memory.
* The browser's native `<audio id="nativeAudio">` loads the stream, aligns playback with the live millisecond position, and takes over output.
* The WebAssembly synthesis worker stops, cutting DSP CPU usage down to **0%**.
* Deck status transitions to sky-blue: **`PLAYBACK: LOADED`**, and compile status turns to green: **`COMPILE: READY`**.

---

## Features

### Audio Engine & Multithreaded DSP

* **Worker-to-Worklet Multithreaded Pipeline:** Offloads 100% of OpenMPT module synthesis into a background Web Worker (`dspworker.js`) communicating directly with a real-time `AudioWorkletProcessor` (`worklet.js`) via a zero-copy transferable `MessagePort`. The browser's main UI thread never handles audio calculations.
* **Sample-Accurate 48 kHz Synthesis:** Synthesizes audio natively at 48,000 Hz with interactive latency hints, eliminating resampling jitter or frequency aliasing.
* **Deep Jitter-Buffered Worklet Queue:** Maintains a 1.2-second (14-chunk) pre-buffered FIFO queue on the audio thread with proactive low-watermark refilling and instant underrun recovery, insulating playback from background thread scheduling delays and GC pauses.
* **0.03ms Fast TypedArray Memory Transfers:** OpenMPT PCM buffer copies use native vector operations (`TypedArray.prototype.set`), cutting block transfer times down to **0.03ms** per block.
* **25 Hz DC-Blocking Highpass Filter:** Biquad highpass filter cuts sub-audible infrasound and DC bias inherent in retro tracker instruments before reaching the output stage.
* **Lossless FLAC & Native Hardware Audio:** Direct hardware-accelerated playback for `.flac`, `.mp3`, and `.wav` with automatic `URL.revokeObjectURL` lifecycle cleanup.

### Persistent 10-Song IndexedDB LRU Cache

* **Automatic Song & Visualizer Persistence:** The last 10 compiled songs—including both their **audio Blobs** and precomputed **visualizer spectrum frames (`visData`)**—are stored in a dedicated IndexedDB database (`xm_studio_cache_db`).
* **Instant Replay without Recompilation:** Returning to any of your last 10 played songs loads the compiled audio and spectrum instantly from local storage, starting immediately in **`LOADED`** mode with zero compile time.
* **Automatic LRU Eviction:** When an 11th song is compiled, an automatic timestamp-indexed Least-Recently-Used eviction algorithm purges the oldest entry, keeping storage compact and within browser quotas.
* **Instant 0ms Downloads:** Clicking **Download** on any track currently playing in `LOADED` state (or stored in the cache) saves the file immediately without re-encoding.

### Zero-Lag Visualizer & Offline Spectrum Caching

* **$O(1)$ Memory Spectrum Lookup:** Once a track is compiled, the visualizer reads from precomputed 28-band frames rather than polling live Web Audio analysers. This eliminates audio thread synchronization overhead on weak devices.
* **Calibrated Web Audio Decibel Curve:** The offline worker calculates FFT magnitudes matching native Web Audio decibel scaling ($-100\text{ dB}$ to $-30\text{ dB} \rightarrow 0..255$) and identical logarithmic bin mapping, ensuring a seamless visual transition during handoff.
* **20 FPS Frame Pacing:** Hardware-paced at 20 FPS (50ms interval) to eliminate up to 83% of redundant draw calls.
* **1.25× DPR Resolution Cap:** Caps canvas pixel density to 1.25× on high-density mobile screens, saving over 60% of GPU fill-rate overhead.
* **Scroll Throttling (10 FPS):** Drops frame rate to 10 FPS during active touch scrolling or dragging to keep Android momentum scrolling silky smooth.
* **Pristine Canvas Clearing:** Unloading a track (`btnUnload`), pausing, or stopping immediately wipes frozen spectrum bars and restores the dark grid chassis.

### Workstation Deck & Status Badges

* **Dual Right-Aligned Status Cluster:**
  * **PLAYBACK Badge:** Displays **`LIVE`** (phosphor green, real-time DSP synthesis), **`LOADED`** (cyan/blue, native hardware stream), or **`IDLE`** (slate gray). Permanently styled with translucent tinted backgrounds and glowing borders.
  * **COMPILE Badge:** Displays **`COMPILING`** (gold, live rendering percentage and pulse animation), **`READY`** (green), or **`IDLE`** (slate gray).
* **Streamlined Channel Badge:** Displays channel count directly as **`32CH`**, **`16CH`**, **`4CH`**, or **`2CH`** without redundant labels.
* **Hardware Fader & Scrubber:** Interactive timeline progress bar with elapsed/total time readouts, master volume fader with mute toggle, and sample rate indicators.
* **Deck Transport & Playlist Controls:** Deck favorite star, playlist picker, shuffle, loop, previous, play/pause, next, and jump-to-random track buttons.

### Background Playback & OS Integration

* **Chrome Media Visibility & Tab Audio Indicators:** Displays browser tab speaker icons, desktop Chrome Global Media Controls, and dynamic tab titles (`▶ Song Title - Artist`).
* **Audio Focus & Media Carrier:** Continuous carrier audio element synchronization satisfies background audio-focus policies across Android and desktop browsers.
* **Full MediaSession Integration:** Lock-screen, notification shade, and Bluetooth controls for play/pause, previous, next, stop, and seeking with dual rasterized/vector artwork.
* **Mobile Miniplayer:** Compact docked bottom bar on the mobile Archive view displaying track number badge, song title, artist, and transport controls, with one-tap toggle to the full Player Deck.

### Multi-Source Catalog & Directory Mounting

* **Multi-Repository Streaming:** Stream and aggregate tracker modules from multiple online repositories simultaneously, with native support for primary and mirrored sources (**XM-Music**, **XM-Archive**).
* **Independent Source Toggling:** Instantly toggle individual remote repositories and mounted local directory sources on or off to isolate collections without deleting catalog data.
* **Local Directory Ingestion:** Mount entire local folder trees recursively using the directory picker, mapping folder hierarchies and caching binary blobs directly in IndexedDB.
* **Persistent 32-Node DOM Virtualization:** Recycles a fixed pool of 32 GPU-translated DOM nodes to navigate catalogs of 5,000+ tracks smoothly without layout thrashing.
* **Workstation Backup & Restore:** Export full workstation backups as ZIP archives (including custom tracks, playlists, favorites, and settings) or restore them in a single operation.

---

## Supported Formats

| Category | File Extensions |
| :--- | :--- |
| **Tracker Modules** | `.xm`, `.mod`, `.it`, `.s3m`, `.mtm`, `.mo3`, `.med`, `.669`, `.far`, `.ptm` |
| **Chiptune & Retro** | `.v2m`, `.ahx`, `.sid`, `.sap`, `.ym`, `.nsf`, `.spc`, `.mid` |
| **Native Audio Streams** | `.flac` (Lossless), `.wav` (PCM), `.mp3` (MPEG Layer 3), `.ogg` (Vorbis) |

---

## Music Repositories & XM-Music Integration

XM-Studio streams audio on demand directly into client-side DSP memory without bundling music into application assets.

* **Default Repository (XM-Music):** Streams thousands of indexed demoscene tracker modules hosted via GitHub Pages (`https://farhan-real.github.io/XM-Music/`).
* **Backup Repository (XM-Archive):** Secondary mirror (`https://xm-archive.pages.dev/`) available under the **Source** tab.

### Setting Up a Custom Music Repository

You can host your own audio library on GitHub Pages or any static web server:

1. Create a repository with a `music/` folder containing files named `Artist - Title.ext`.
2. Generate a `tracks.json` manifest at the repository root:

```json
[
  {
    "title": "Catch That Goblin",
    "artist": "Skaven",
    "folder": "Demoscene",
    "path": "music/Demoscene/Skaven - Catch That Goblin.xm",
    "ext": "XM"
  }
]
```

3. Enable GitHub Pages (**Settings** → **Pages** → Deploy from `main` root).
4. In XM-Studio, open the **Source** tab, enter your repository URL under **Online Repositories**, click **+ Add**, and click **Sync All Repos**.

---

## Local Development (Python)

To run or test XM-Studio locally, serve the directory with Python:

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
│   ├── badges.css              # Hardware badges & dual status cluster
│   ├── player.css              # Deck chassis, readout & mobile miniplayer
│   ├── controls.css            # Transport controls, fader & buttons
│   ├── tracks.css              # Virtual list viewport & custom scrollbar
│   └── library.css             # Navigation tabs & source configuration
└── js/
    ├── app.js                  # Main workstation transport coordinator
    ├── engine/
    │   ├── dsp/
    │   │   ├── audio.js        # Master audio coordinator & 3-phase handoff
    │   │   ├── background.js   # MediaSession, lock screen & carrier audio
    │   │   ├── chiptune2.js    # AudioWorklet player manager & event bus
    │   │   ├── queue.js        # Playback queue, shuffle & loop manager
    │   │   └── visualizer.js   # O(1) spectrum cache visualizer loop
    │   ├── export/
    │   │   ├── compiler.js     # Background export worker coordinator
    │   │   └── export.js       # Export formats, background compiler & ingest
    │   └── workers/
    │       ├── dspworker.js    # Background libopenmpt synthesis worker
    │       ├── worker.js       # Background MP3/WAV render & FFT worker
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
        │   ├── cache.js        # Persistent 10-song IndexedDB LRU cache
        │   ├── custom.js       # IndexedDB track metadata & blob storage
        │   └── zip.js          # Pure JS binary ZIP writer & reader
        └── view/
            ├── library.js      # Virtual DOM card pool & archive table
            └── scroller.js     # Zero-reflow custom scrollbar & momentum
```

---

## License

XM-Studio is open source under the MIT License. Built with `libopenmpt` (BSD-3-Clause) and `lamejs` (LGPL).