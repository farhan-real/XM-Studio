/**
 * js/engine/dsp/meta.js - Track metadata validation and format resolution without silent fallbacks.
 */
(function(window) {
  const NATIVE_STREAM_EXTS = new Set(['.mp3', '.ogg', '.wav', '.flac', '.aac', '.m4a', '.weba']);
  const SUPPORTED_EXTS = new Set([
    'xm', 'mod', 'it', 's3m', 'mtm', 'mo3', 'med', '669', 'far', 'ptm',
    'amf', 'ams', 'dbm', 'digi', 'dmf', 'dsm', 'dtm', 'gdm', 'imf', 'j2b',
    'mptm', 'okt', 'plm', 'psm', 'sfx', 'stm', 'ult', 'umx', 'mdl', 'stp',
    'v2m', 'ahx', 'sid', 'mid', 'midi', 'mp3', 'ogg', 'wav', 'flac', 'aac', 'm4a', 'weba'
  ]);

  function parseTrackInfo(filename, internalMeta) {
    if (!filename && (!internalMeta || !internalMeta.title)) {
      throw new Error('Track metadata error: Both filename and internal metadata are missing.');
    }
    const meta = internalMeta ? internalMeta : {};
    let base = filename ? filename.replace(/\.[a-z0-9]+$/i, '').trim() : '';
    if (base.includes('_-_')) base = base.replace(/_-_/g, ' - ').replace(/_/g, ' ');
    else if (!base.includes(' ') && base.includes('_')) base = base.replace(/_/g, ' ');

    const match = base.match(/^(.+?)\s+[-–—]\s+(.+)$/);
    const title = match ? match[2].trim() : (meta.title ? meta.title.trim() : base);
    const artist = match ? match[1].trim() : (meta.artist ? meta.artist.trim() : '');

    if (!title) {
      throw new Error(`Track metadata error: Unable to determine title for track from "${filename}".`);
    }
    if (!artist) {
      throw new Error(`Track metadata error: Unable to determine artist for "${title}". File must follow "Artist - Title.ext" format or contain metadata.`);
    }

    return { title, artist };
  }

  function getDetailedTrackerEngine(tracker, typeLong, ext) {
    const cleanExt = ext ? ext.replace(/^\./, '').toUpperCase() : '';
    const t = tracker ? tracker.trim() : '';
    const tl = typeLong ? typeLong.trim() : '';

    if (t && tl) {
      const tLower = t.toLowerCase();
      const tlLower = tl.toLowerCase();
      if (tLower.includes('compatible') && !tlLower.includes('compatible')) return tl.toUpperCase();
      if (tlLower.includes('compatible') && !tLower.includes('compatible')) return t.toUpperCase();
      return (t.length >= tl.length ? t : tl).toUpperCase();
    }
    if (tl && tl.toUpperCase() !== cleanExt) return tl.toUpperCase();
    if (t && t.toUpperCase() !== cleanExt) return t.toUpperCase();
    if (tl) return tl.toUpperCase();
    if (t) return t.toUpperCase();
    if (cleanExt && cleanExt !== 'MP3' && cleanExt !== 'WAV') return cleanExt;

    throw new Error(`Unable to determine tracker engine: tracker="${tracker}", typeLong="${typeLong}", ext="${ext}"`);
  }

  function resolveTrackerEngine(candidate, ext) {
    if (!ext) throw new Error('Engine resolution error: Missing file extension.');
    const cleanExt = ext.replace(/^\./, '').toUpperCase();
    const cand = candidate ? candidate.trim().toUpperCase() : '';
    const isTracker = !NATIVE_STREAM_EXTS.has(`.${cleanExt.toLowerCase()}`);

    if (isTracker) {
      if (cand && cand !== 'MP3' && cand !== 'WAV' && cand !== 'AUDIO' && cand !== 'NONE') {
        return cand;
      }
      if (cleanExt && cleanExt !== 'MP3' && cleanExt !== 'WAV') {
        return cleanExt;
      }
      throw new Error(`Tracker engine resolution failed: candidate="${candidate}", ext="${ext}".`);
    }

    if (cand && cand !== 'NONE') return cand;
    if (cleanExt) return cleanExt;
    throw new Error(`Audio engine resolution failed: candidate="${candidate}", ext="${ext}".`);
  }

  window.XMMeta = {
    NATIVE_STREAM_EXTS,
    SUPPORTED_EXTS,
    parseTrackInfo,
    getDetailedTrackerEngine,
    resolveTrackerEngine
  };
})(window);