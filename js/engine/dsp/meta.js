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
    internalMeta = internalMeta || {};
    let base = (filename || '').replace(/\.[a-z0-9]+$/i, '').trim();
    if (base.includes('_-_')) base = base.replace(/_-_/g, ' - ').replace(/_/g, ' ');
    else if (!base.includes(' ') && base.includes('_')) base = base.replace(/_/g, ' ');

    const match = base.match(/^(.+?)\s+[-–—]\s+(.+)$/);
    const title = match ? match[2].trim() : ((internalMeta.title || '').trim() || base);
    const artist = match ? match[1].trim() : ((internalMeta.artist || '').trim() || (internalMeta.type_long || '').trim());

    if (!title) {
      throw new Error(`Unable to determine title for track from filename "${filename}" or metadata`);
    }
    return {
      title,
      artist: artist || 'Unknown Artist'
    };
  }

  function resolveTrackerEngine(candidate, ext) {
    const cleanExt = (ext || '').replace(/^\./, '').toUpperCase();
    const cand = (candidate || '').trim().toUpperCase();
    if (cand && cand !== 'MP3' && cand !== 'WAV' && cand !== 'AUDIO' && cand !== 'NONE') {
      return cand;
    }
    if (cleanExt) {
      return cleanExt;
    }
    throw new Error('Unable to resolve engine type for audio track');
  }

  window.XMMeta = {
    NATIVE_STREAM_EXTS,
    SUPPORTED_EXTS,
    parseTrackInfo,
    resolveTrackerEngine
  };
})(window);