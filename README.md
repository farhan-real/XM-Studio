# XM-Studio

> High-performance offline Digital Signal Processing (DSP) workstation, chiptune engine, and tracker module player for desktop and mobile browsers.

---

## Use the App

XM-Studio runs directly in any modern web browser with zero installation:

**Launch Online:** **[farhan-real.github.io/XM-Studio](https://farhan-real.github.io/XM-Studio)** or **[xm-studio.pages.dev](https://xm-studio.pages.dev/)**

* **Runs Everywhere:** Works seamlessly across Desktop and Android browsers (Chrome, Firefox, Safari, Edge) in both portrait and landscape orientations.
* **100% Client-Side Privacy:** All audio synthesis, DSP mixing, and file processing happen locally via WebAssembly and Web Audio. Nothing is uploaded to external servers.
* **Offline Capable:** Progressive Web App (PWA) with runtime caching and application shell precaching (`service-worker.js`) for instant offline playback.

---

## Overview

XM-Studio plays, visualizes, curates, and exports classic tracker music modules along with modern lossless and compressed audio streams:

* **FastTracker II (`.xm`)**
* **ProTracker (`.mod`)**
* **Impulse Tracker (`.it`)**
* **ScreamTracker (`.s3m`)**
* **MultiTracker Module (`.mtm`)**
* **Chiptune & Retro Formats (`.v2m`, `.ahx`, `.sid`, `.sap`, `.ym`, `.nsf`, `.spc`, `.mid`)**
* **Lossless & Native Streams (`.flac`, `.wav`, `.mp3`, `.ogg`)**

Powered by `libopenmpt` compiled to WebAssembly, XM-Studio provides sample-accurate hardware synthesis, sinc interpolation, stereo separation, and responsive frequency spectrum analysis.

---

## The Hybrid Dual-Engine Architecture

Tracker modules (`.xm`, `.mod`, etc.) are musical instructions with instrument samples, not linear audio files. Real-time software synthesis can drain mobile batteries, while waiting for full file encoding before playback causes awkward delays.

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

### Phase 1: Instant Start (`PLAYBACK: ENGINE`)
* The moment you select a tracker module, raw binary is dispatched to an isolated WebAssembly synthesis worker (`dspworker.js` running `libopenmpt`).
* Float PCM chunks stream through a zero-copy transferable `MessagePort` directly into a hardware-thread `AudioWorkletProcessor` (`worklet.js`).
* Playback begins **instantly with 0ms latency**.
* Deck status glows phosphor green: **`PLAYBACK: ENGINE`**.

### Phase 2: Parallel Background Compilation (`COMPILE: COMPILING`)
* An independent compilation worker (`worker.js`) renders the full song in the background into 320k MP3 or 16-bit WAV audio.
* Simultaneously, a dedicated FFT engine (`fft.js`) precomputes 28-band frequency spectrum frames for every frame of the song into a typed array buffer (`visData`).
* Because rendering executes on a separate CPU core, **the playing music never stutters, drops frames, or glitches**.
* Deck status pulses gold with live progress: **`COMPILE: COMPILING`** (e.g. `45%`).

### Phase 3: Seamless Native Handoff (`PLAYBACK: MP3`)
* When compilation completes, the browser's native `<audio id="nativeAudio">` pre-seeks to the exact phase-aligned timestamp while muted.
* An equal-power linear de-clicking micro-ramp smoothly transitions audio output from the Worklet to the native audio element.
* The WebAssembly synthesis worker stops, cutting DSP CPU usage down to **0%**.
* Deck status transitions to sky-blue: **`PLAYBACK: MP3`** (or `WAV` if WAV export target is active), and compile status turns to green: **`COMPILE: READY`**.

---

## Features & Optimizations

### 1. Audio Engine & Multithreaded DSP

* **Worker-to-Worklet Multithreaded Pipeline:** Offloads 100% of OpenMPT module synthesis into a dedicated background Web Worker (`dspworker.js`) communicating directly with a real-time `AudioWorkletProcessor` (`worklet.js`) via a zero-copy transferable `MessagePort`. The browser's main UI thread never touches audio calculations, eliminating stutter and removing legacy `ScriptProcessorNode` deprecation warnings.
* **Sample-Accurate 48 kHz Synthesis:** Synthesizes audio natively at 48,000 Hz with interactive latency hints (`AudioContext({ sampleRate: 48000, latencyHint: 'interactive' })`), eliminating resampling jitter or frequency aliasing.
* **Deep Jitter-Buffered Worklet Queue:** Maintains a 1.2-second (14-chunk / 57,344 samples) pre-buffered FIFO queue on the audio thread with proactive low-watermark refilling (pulls 4 chunks whenever the queue drops below 6) and instant underrun zero-fill recovery, insulating playback from background thread scheduling delays and GC pauses.
* **0.03ms Fast TypedArray Memory Transfers:** OpenMPT PCM buffer copies use native vector operations (`Float32Array.set`) with zero-copy transferable buffer transfers over `postMessage`, reducing block transfer times down to **0.03ms** per block.
* **Continuous Linear Frame Counting:** `dspworker.js` tracks continuous linear frame counts (`renderedFrames / sampleRate`), eliminating pattern-row quantization position jitter inherent in tracker position queries.
* **Persistent WASM Scratch Buffers:** Pre-allocated `_malloc` memory buffers (`leftBufferPtr`, `rightBufferPtr` for 4096 frames) prevent heap reallocation and memory fragmentation in WebAssembly memory.
* **25 Hz DC-Blocking Highpass Filter:** Biquad highpass filter ($Q=0.707$, $f_c=25\text{ Hz}$) removes DC bias and sub-audible infrasound inherent in retro tracker instruments before reaching the master gain stage.
* **Detailed Tracker Identification (`meta.js`):** Inspects both `tracker` and `type_long` OpenMPT metadata tags to resolve exact software and versions (e.g. `FASTTRACKER 2 V1.04`, `PROTRACKER 2.3D`, `IMPULSE TRACKER 2.14`, `SCREAM TRACKER 3.20`) rather than generic file extensions.
* **Strict Zero-Fallback Validation:** Falsy fallback operators (`||`) and placeholder defaults (`"Custom Artist"`, `"Local Artist"`, `'XM'`) are completely eliminated; missing metadata, corrupt formats, or unresolvable engines raise explicit, loud errors immediately.
* **Lossless FLAC & Native Hardware Audio:** Direct hardware-accelerated playback for `.flac`, `.mp3`, and `.wav` with automatic `URL.revokeObjectURL` lifecycle cleanup.

### 2. Latency-Compensated Zero-Stutter Native Handoff

* **LAME MP3 Priming Delay Offset (11ms):** Compensates for LAME MP3's 528-sample MDCT filterbank priming delay ($\approx 11\text{ms}$ at 48 kHz via `ENCODER_DELAY = 0.011`), eliminating phase drift between decoded MP3 audio and live WebAssembly PCM.
* **Hardware Buffer Lead Alignment (34ms):** Compensates for the 34ms hardware start lead (`PLAY_START_LEAD = 0.034`) between the seek event and the browser media engine emitting audio frames into Web Audio.
* **Muted Pre-Seeking:** `<audio id="nativeAudio">` pre-seeks to the latency-aligned timestamp with native gain muted (`gain = 0.0`) *before* playback begins, eliminating the 150ms seek dropout.
* **Phase-Aligned 15ms De-Clicking Ramp:** Smooth 15ms linear gain transition anchored directly to instantaneous `AudioParam.value`, avoiding the -3dB power dip and double-transient comb filtering of long crossfades.
* **Fixed 1.0× Playback Rate:** Prohibits `playbackRate` time-stretching during handoff, completely avoiding browser WSOLA grain-buffer chirps and resampler artifacts.
* **Dedicated Dual Gain Staging:** `player.workletGain` and `nativeGainNode` allow independent volume ramping and muting during stream preparation without affecting master fader levels.

### 3. Background Compilation & FFT Spectrum Precomputation

* **1152-Sample Block Alignment (`worker.js`):** Encodes in 1152-sample MP3 frame blocks (`BLOCK_SIZE = 1152`, `chunkSize = 4608`) with soft limiting `[-1.0, 1.0]`, preventing bit reservoir underflow and clipping distortion.
* **Radix-2 FFT Spectrum Precomputation (`fft.js`):** Standalone 64-point FFT with precomputed Hann window and bit-reversal lookup tables computes 28-band spectrum magnitudes during background rendering.
* **Calibrated Decibel Curve:** FFT frames match native Web Audio decibel scaling ($-100\text{ dB}$ to $-30\text{ dB} \rightarrow 0..255$) with logarithmic bin mapping for seamless visual handoff.
* **Serial 2-Track Lookahead Precompilation (`precompiler.js`):** Precompiles upcoming playlist tracks ($N+1$, $N+2$) serially in the background with `AbortController` preemption, battery gating (<15%), and visibility pausing.
* **Deterministic Shuffle Synchronization:** In shuffle mode, precomputes a deterministic sequence so background precompilation targets the exact randomized tracks that will play next.

### 4. Zero-Lag Visualizer & Canvas Rendering Optimizations

* **$O(1)$ Spectrum Cache Lookup (`visualizer.js`):** Reads directly from precalculated `visData` byte offsets during native playback, bypassing live audio thread polling and FFT calculations.
* **Paced 15 FPS Draw Loop:** Caps visualizer canvas redraws to 15 FPS (~67ms interval), eliminating up to 83% of redundant GPU draw calls without losing perceived fluidity.
* **1.25× DPR Resolution Cap:** Restricts mobile canvas pixel density to 1.25× DPR on high-density screens, saving over 60% of GPU fill-rate overhead and memory bandwidth.
* **Scroll Throttling & Deep Sleep:** Pauses non-critical rendering during touch scrolling, and completely terminates `requestAnimationFrame` loops when the browser tab is hidden or device locked.
* **Composite Optimization:** Configured with `{ alpha: false }` and `imageSmoothingEnabled = false` for direct, non-blended GPU rasterization.
* **Pristine Canvas Clearing:** Unloading a track (`btnUnload`) or stopping immediately wipes spectrum bars and restores the dark grid chassis.

### 5. Persistent Virtual DOM & Momentum Scroller Engine

* **Persistent 32-Node Virtual DOM Pool (`library.js`):** Navigates catalogs of 5,000+ songs by recycling a fixed pool of 32 GPU-translated (`translate3d`) DOM cards, preventing layout thrashing.
* **Diff-Cached DOM Updates:** Compares track IDs and indices before mutating DOM nodes, eliminating redundant class changes and layout writes.
* **Single-Node Event Delegation:** Container-level event delegation across the Archive, Playlists, and Source panels eliminates thousands of per-card event closures and garbage collection pauses.
* **Zero-Reflow Custom Scroller (`scroller.js`):** rAF-batched touch momentum physics with exponential decay factor (0.94) and drag-click suppression.

### 6. Memory, Multi-Tier Storage & Self-Healing Cache

* **Metadata-Only RAM Caching (`custom.js`, `catalog.js`):** Strips raw audio `Blob` payloads (`stripBlob`) from in-memory catalog arrays and loads binary blobs from IndexedDB strictly on demand, keeping heap usage minimal even with thousands of local tracks mounted.
* **Pre-Indexed $O(1)$ Search Strings:** Pre-computes lowercased null-delimited search strings (`artist\0title\0folder`) on track objects during indexing for sub-millisecond filtering.
* **$O(1)$ Favorites Set Caching:** Starred favorites use an in-memory `Set` lookup cache for instant favorite status checks during virtual list rendering.
* **Dynamic Database Migrations (`cache.js`, `custom.js`):** Upgrades IndexedDB object stores dynamically (`e.oldVersion < e.newVersion`) without hardcoded versions, automatically resetting schemas when database versions advance.
* **Stale Cache Sanitization:** Detects and evicts stale generic engine records (`"XM"`, `"MOD"`, `"IT"`) upon cache initialization.
* **Automatic Metadata Self-Healing:** Automatically repairs legacy playlist, favorite, and custom track tags by synchronizing against catalog indexes and module binary headers.
* **Multi-Tier Quota Management:** Expanded 35-song global ceiling (~210 MB limit), 10-song per-playlist quota, and 3 most-recent playlists retention policy.
* **Pure JavaScript Streaming ZIP Engine (`zip.js`):** Streaming ZIP writer and reader with CRC-32 table lookups and `DecompressionStream('deflate-raw')` for full workstation backup and restore.

### 7. Workstation Deck, Transport & Status Badges

* **Dual Right-Aligned Status Cluster:**
  * **PLAYBACK Badge:** Displays **`ENGINE`** (phosphor green, real-time DSP synthesis), **`MP3`** (sky-blue, native hardware stream), or **`IDLE`** (slate gray).
  * **COMPILE Badge:** Displays **`COMPILING`** (gold, live rendering percentage and pulse animation), **`READY`** (green), or **`IDLE`** (slate gray).
* **Streamlined Channel Badge:** Displays channel count directly as **`32CH`**, **`16CH`**, **`4CH`**, or **`2CH`** without redundant labels.
* **Hardware Fader & Scrubber:** Interactive timeline progress bar with elapsed/total time readouts, master volume fader with mute toggle, and sample rate indicators.
* **Transport Modes:** 4 dedicated playback modes (`STOP`, `NEXT`, `LOOP`, `RAND`).
* **Deck Transport & Playlist Controls:** Deck favorite star, playlist picker, shuffle, loop, previous, play/pause, next, and jump-to-random track buttons.
* **Mobile Miniplayer:** Compact docked bottom bar on the mobile Archive view displaying track number badge, song title, artist, and transport controls, with one-tap toggle to the full Player Deck.

### 8. Background Playback & OS Integration

* **Continuous Audio Focus Carrier (`background.js`):** Generates an in-memory silent PCM WAV carrier loop satisfying mobile background audio policies and preventing thread suspension.
* **Chrome Media Visibility & Tab Audio Indicators:** Displays browser tab speaker icons, desktop Chrome Global Media Controls, and dynamic tab titles (`▶ Song Title - Artist`).
* **Full MediaSession Integration:** Lock-screen, notification shade, and Bluetooth controls for play/pause, previous, next, stop, seekto, and skip with dual vector and rasterized artwork (SVG + 192/512 PNG data URLs).

---

## Supported Formats

| Category | File Extensions |
| :--- | :--- |
| **Tracker Modules** | `.xm`, `.mod`, `.it`, `.s3m`, `.mtm`, `.mo3`, `.med`, `.669`, `.far`, `.ptm` |
| **Chiptune & Retro** | `.v2m`, `.ahx`, `.sid`, `.sap`, `.ym`, `.nsf`, `.spc`, `.mid` |
| **Native Audio Streams** | `.flac` (Lossless), `.wav` (PCM), `.mp3` (MPEG Layer 3), `.ogg` (Vorbis) |

---

## Music Repositories & XM-Music Integration

XM-Studio streams audio on demand directly into client-side DSP memory without bundling music into application assets. By leveraging open CORS headers, it streams audio on demand directly into client-side Web Audio buffers.

### Default Repository: `XM-Music`

By default, XM-Studio connects to **[XM-Music](https://github.com/farhan-real/XM-Music)** (`https://farhan-real.github.io/XM-Music/`), streaming thousands of indexed chiptunes and demoscene tracker modules directly through GitHub Pages.

### Backup Repository: `XM-Archive`

XM-Studio includes **XM-Archive** (`https://xm-archive.pages.dev/`) as a built-in secondary backup repository. Enable it under the **Source** tab to stream additional demoscene modules and mirrored chiptune releases.

---

### How to Set Up a Custom Music Repository

You can host your own audio library on GitHub Pages or any standard static web server and mount it directly into XM-Studio.

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
3. GitHub Pages automatically serves files with open `Access-Control-Allow-Origin: *` headers, allowing XM-Studio to stream and decode files into Web Audio buffers.

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
├── service-worker.js           # Offline runtime asset caching & network-first shell
├── icon.svg                    # Vector chassis application icon
├── README.md                   # Technical documentation
├── css/
│   ├── main.css                # Chassis layout & CSS tokens
│   ├── badges.css              # Status indicators & engine badges
│   ├── player.css              # Deck chassis, readout & mobile miniplayer
│   ├── controls.css            # Transport controls, faders & buttons
│   ├── tracks.css              # Virtual list viewport & custom scrollbar
│   └── library.css             # Navigation tabs & source configuration
└── js/
    ├── app.js                  # Main transport coordinator & deck status
    ├── engine/
    │   ├── dsp/
    │   │   ├── audio.js        # Master playback & latency-aligned handoff
    │   │   ├── background.js   # MediaSession, lock screen & carrier audio
    │   │   ├── chiptune2.js    # AudioWorklet player manager & event bus
    │   │   ├── meta.js         # Engine identification & strict metadata validation
    │   │   ├── queue.js        # Playback queue, modes & lookahead preview
    │   │   └── visualizer.js   # 15 FPS spectrum visualizer loop & O(1) cache
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
        │   ├── catalog.js      # Catalog indexing, search filtering & sorting
        │   └── sources.js      # Multi-repo aggregator & local folder sources
        ├── playlist/
        │   ├── playlist.js     # Playlist CRUD & metadata synchronization
        │   └── playlistui.js   # Playlist views & modal collection picker
        ├── storage/
        │   ├── backup.js       # Full workstation ZIP export & restore
        │   ├── cache.js        # Dynamic IndexedDB cache & quota management
        │   ├── custom.js       # IndexedDB custom track store & migration
        │   └── zip.js          # Pure JS binary ZIP writer & reader
        └── view/
            ├── library.js      # Virtual DOM card pool & archive navigation
            └── scroller.js     # Momentum custom scrollbar coordinator
```

---

## License

XM-Studio is open source under the MIT License. Built with `libopenmpt` (BSD-3-Clause) and `lamejs` (LGPL).