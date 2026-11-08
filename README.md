# XM-Studio

> High-performance offline Digital Signal Processing (DSP) workstation, chiptune engine, and tracker module player for desktop and mobile browsers.

---

## Use the App

XM-Studio runs directly in modern web browsers with zero installation:

**Launch Online:** **[farhan-real.github.io/XM-Studio](https://farhan-real.github.io/XM-Studio)** or **[xm-studio.pages.dev](https://xm-studio.pages.dev/)**

* **Runs Everywhere:** Desktop and Android browsers (Chrome, Firefox, Safari, Edge).
* **100% Client-Side Privacy:** Audio synthesis, DSP mixing, and file processing happen locally via WebAssembly and Web Audio.
* **Offline Capable:** Progressive Web App (PWA) with runtime caching for offline playback.

---

## Overview

XM-Studio plays, visualizes, curates, and exports classic tracker music modules and audio streams:

* **FastTracker II (`.xm`)**, **ProTracker (`.mod`)**, **Impulse Tracker (`.it`)**, **ScreamTracker (`.s3m`)**, **MTM (`.mtm`)**
* **Chiptune & Retro (`.v2m`, `.ahx`, `.sid`, `.mid`)**
* **Lossless & Native Streams (`.flac`, `.wav`, `.mp3`, `.ogg`)**

Powered by `libopenmpt` compiled to WebAssembly, XM-Studio provides sample-accurate hardware synthesis, sinc interpolation, stereo separation, and frequency spectrum analysis.

---

## The Hybrid Dual-Engine Architecture

Tracker modules are musical instructions with instrument samples, not linear audio files. XM-Studio coordinates a three-phase playback pipeline:

```text
[Select Track] ──▶ Phase 1: Real-time Live DSP (0ms Instant Sound)
                        │
                        ▼ (Parallel off-thread Web Worker)
                   Phase 2: Background Compilation (MP3/WAV + Calibrated FFT Spectrum)
                        │
                        ▼ (Upon 100% render completion)
                   Phase 3: Seamless Native Handoff (0% DSP CPU, Battery Friendly)
```

### Phase 1: Instant Start (`PLAYBACK: ENGINE`)
* Raw binary is dispatched to an isolated WebAssembly synthesis worker (`dspworker.js` running `libopenmpt`).
* Float PCM chunks stream through a zero-copy transferable `MessagePort` directly into an `AudioWorkletProcessor` (`worklet.js`).
* Playback begins with **0ms latency**.
* Deck status glows green: **`PLAYBACK: ENGINE`**.

### Phase 2: Parallel Background Compilation (`COMPILE: COMPILING`)
* An independent worker (`worker.js`) renders the full song in the background into 320k MP3 or 16-bit WAV audio.
* Simultaneously, the worker precomputes 28-band frequency spectrum frames for every frame into `visData`.
* Deck status pulses gold with live progress: **`COMPILE: COMPILING`** (e.g. `45%`).

### Phase 3: Seamless Native Handoff (`PLAYBACK: MP3`)
* When compilation completes, the browser's native `<audio id="nativeAudio">` pre-seeks to the exact phase-aligned timestamp.
* An equal-power linear de-clicking ramp seamlessly transitions output from the Worklet to native audio.
* The WebAssembly synthesis worker stops, cutting DSP CPU usage down to **0%**.
* Deck status transitions to sky-blue: **`PLAYBACK: MP3`**, and compile status turns to green: **`COMPILE: READY`**.

---

## Features

### Audio Engine & Zero-Stutter Handoff

* **Latency-Compensated Handoff:** Compensates for LAME MP3's 528-sample (11ms) priming delay and browser hardware buffer dispatch lead time (34ms), preventing phase skips or beat repetition during engine transition.
* **Click-Free Micro-Ramp:** Uses a 15ms linear de-clicking ramp anchored to current parameter values, eliminating DC offset pops and comb-filtering flam artifacts.
* **Detailed Engine Identification:** Evaluates both `tracker` and `type_long` OpenMPT metadata, resolving exact software and format versions (e.g. `FASTTRACKER 2 V1.04`, `PROTRACKER 2.3D`, `IMPULSE TRACKER 2.14`, `SCREAM TRACKER 3.20`) rather than generic extensions.
* **Strict Zero-Fallback Validation:** Falsy fallback operators (`||`) and placeholder defaults (`"Custom Artist"`, `"Local Artist"`, `"Unknown"`, generic `'XM'`) are eliminated. Corrupt metadata and missing fields produce clear, actionable errors.
* **Sample-Accurate Linear Clocks:** `dspworker.js` tracks continuous linear frame counts (`renderedFrames / sampleRate`), eliminating pattern-row quantization position jitter.
* **25 Hz DC-Blocking Filter:** Biquad highpass filter cuts sub-audible infrasound and DC bias before output.

### Lookahead Precompilation & Multi-Tier Storage

* **2-Track Lookahead:** Precompiles the upcoming 2 tracks ($N+1$ and $N+2$). Skipping songs is instantaneous and starts directly in native `MP3` mode.
* **Dynamic Database Migrations:** IndexedDB object stores upgrade dynamically (`e.oldVersion < e.newVersion`) without hardcoded version numbers, automatically evicting stale cache records.
* **Metadata Self-Healing:** Automatically repairs playlists, favorites, and custom track libraries by synchronizing corrected artist/title tags from the catalog and module binary headers.
* **35-Song Global Cache:** Stores up to 35 fully compiled songs (audio Blobs and calibrated 15 FPS FFT frames) in IndexedDB (`xm_studio_cache_db`), balancing storage quotas with instant replays.

### Zero-Lag Visualizer

* **$O(1)$ Spectrum Lookup:** Reads from precomputed 28-band frames rather than polling live analysers during native playback.
* **15 FPS Frame Pacing & 1.25× DPR Cap:** Caps draw frequency to 15 FPS (~67ms) and DPR to 1.25× on high-density displays, preserving mobile GPU efficiency.
* **Pristine State Clearing:** Unloading a track (`btnUnload`) or stopping immediately wipes spectrum bars and restores the chassis grid.

---

## Supported Formats

| Category | File Extensions |
| :--- | :--- |
| **Tracker Modules** | `.xm`, `.mod`, `.it`, `.s3m`, `.mtm`, `.mo3`, `.med`, `.669`, `.far`, `.ptm` |
| **Chiptune & Retro** | `.v2m`, `.ahx`, `.sid`, `.sap`, `.ym`, `.nsf`, `.spc`, `.mid` |
| **Native Audio Streams** | `.flac` (Lossless), `.wav` (PCM), `.mp3` (MPEG Layer 3), `.ogg` (Vorbis) |

---

## Music Repositories & Local Sources

* **Default Repository (XM-Music):** Streams indexed demoscene modules from GitHub Pages (`https://farhan-real.github.io/XM-Music/`).
* **Multi-Repository Streaming:** Add custom server or GitHub Pages URLs hosting a `tracks.json` catalog manifest.
* **Local Directory Mounting:** Mount entire local folder trees recursively via directory picker; tracks are cataloged into IndexedDB.
* **DOM Virtualization:** Recycles a fixed pool of 32 GPU-translated DOM cards to scroll 5,000+ tracks smoothly.

---

## Local Development

Serve the project root using Python:

```bash
git clone https://github.com/farhan-real/XM-Studio.git
cd XM-Studio
python3 -m http.server 8080
```

Open `http://localhost:8080` in your web browser.

---

## Directory Architecture

```text
.
├── index.html                  # Chassis layout & script bindings
├── manifest.json               # Progressive Web App manifest
├── service-worker.js           # Runtime caching & network-first shell
├── icon.svg                    # Vector chassis application icon
├── README.md                   # Technical documentation
├── css/
│   ├── main.css                # Chassis layout & CSS variables
│   ├── badges.css              # Status indicators & engine badges
│   ├── player.css              # Deck chassis, readout & miniplayer
│   ├── controls.css            # Transport controls & volume fader
│   ├── tracks.css              # Virtual list viewport & scrollbar
│   └── library.css             # Navigation tabs & source configuration
└── js/
    ├── app.js                  # Main transport coordinator & deck status
    ├── engine/
    │   ├── dsp/
    │   │   ├── audio.js        # Master playback & zero-stutter handoff
    │   │   ├── background.js   # MediaSession, lock screen & carrier
    │   │   ├── chiptune2.js    # AudioWorklet player manager & event bus
    │   │   ├── meta.js         # Engine identification & metadata validation
    │   │   ├── queue.js        # Playback queue, modes & lookahead
    │   │   └── visualizer.js   # 15 FPS spectrum visualizer loop
    │   ├── export/
    │   │   ├── compiler.js     # Background export worker coordinator
    │   │   ├── export.js       # Audio export formats & instant download
    │   │   └── precompiler.js  # 2-track lookahead playlist precompiler
    │   └── workers/
    │       ├── dspworker.js    # Off-thread libopenmpt synthesis worker
    │       ├── fft.js          # 64-point FFT & logarithmic decibel mapping
    │       ├── worker.js       # Background MP3/WAV compilation worker
    │       └── worklet.js      # Real-time audio thread AudioWorkletProcessor
    └── data/
        ├── catalog/
        │   ├── catalog.js      # Catalog indexing, search & sorting
        │   └── sources.js      # Multi-repo aggregator & local folders
        ├── playlist/
        │   ├── playlist.js     # Playlist CRUD & metadata synchronization
        │   └── playlistui.js   # Playlist views & modal collection picker
        ├── storage/
        │   ├── backup.js       # Full workstation ZIP backup & restore
        │   ├── cache.js        # Dynamic IndexedDB cache & quota management
        │   ├── custom.js       # IndexedDB custom track store & migration
        │   └── zip.js          # Pure JS binary ZIP reader & writer
        └── view/
            ├── library.js      # Virtual DOM card pool & archive navigation
            └── scroller.js     # Momentum custom scrollbar coordinator
```

---

## License

XM-Studio is open source under the MIT License. Built with `libopenmpt` (BSD-3-Clause) and `lamejs` (LGPL).