/**
 * js/data/zip.js - Lightweight, dependency-free ZIP archive writer & reader.
 */
(function(window) {
  const crcTable = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    crcTable[i] = c >>> 0;
  }

  function getCrc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function getDosDateTime(d) {
    const date = d || new Date();
    const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
    const dt = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
    return { time, date: dt };
  }

  class ZipWriter {
    constructor() {
      this.files = [];
    }

    addFile(filename, data) {
      const encoder = new TextEncoder();
      const bytes = (typeof data === 'string') ? encoder.encode(data) : new Uint8Array(data);
      this.files.push({ name: filename.replace(/\\/g, '/'), bytes, date: new Date() });
    }

    async generate() {
      const localChunks = [];
      const centralChunks = [];
      let offset = 0;
      const encoder = new TextEncoder();

      for (const file of this.files) {
        const nameBytes = encoder.encode(file.name);
        const crc = getCrc32(file.bytes);
        const { time, date } = getDosDateTime(file.date);
        const size = file.bytes.length;

        const loc = new Uint8Array(30 + nameBytes.length);
        const lv = new DataView(loc.buffer);
        lv.setUint32(0, 0x04034b50, true);
        lv.setUint16(4, 20, true);
        lv.setUint16(6, 0x0800, true);
        lv.setUint16(8, 0, true);
        lv.setUint16(10, time, true);
        lv.setUint16(12, date, true);
        lv.setUint32(14, crc, true);
        lv.setUint32(18, size, true);
        lv.setUint32(22, size, true);
        lv.setUint16(26, nameBytes.length, true);
        lv.setUint16(28, 0, true);
        loc.set(nameBytes, 30);

        localChunks.push(loc, file.bytes);

        const cd = new Uint8Array(46 + nameBytes.length);
        const cv = new DataView(cd.buffer);
        cv.setUint32(0, 0x02014b50, true);
        cv.setUint16(4, 20, true);
        cv.setUint16(6, 20, true);
        cv.setUint16(8, 0x0800, true);
        cv.setUint16(10, 0, true);
        cv.setUint16(12, time, true);
        cv.setUint16(14, date, true);
        cv.setUint32(16, crc, true);
        cv.setUint32(20, size, true);
        cv.setUint32(24, size, true);
        cv.setUint16(28, nameBytes.length, true);
        cv.setUint16(30, 0, true);
        cv.setUint16(32, 0, true);
        cv.setUint16(34, 0, true);
        cv.setUint16(36, 0, true);
        cv.setUint32(38, 0, true);
        cv.setUint32(42, offset, true);
        cd.set(nameBytes, 46);

        centralChunks.push(cd);
        offset += loc.length + size;
      }

      const cdOffset = offset;
      let cdSize = 0;
      centralChunks.forEach(c => cdSize += c.length);

      const eocd = new Uint8Array(22);
      const ev = new DataView(eocd.buffer);
      ev.setUint32(0, 0x06054b50, true);
      ev.setUint16(4, 0, true);
      ev.setUint16(6, 0, true);
      ev.setUint16(8, this.files.length, true);
      ev.setUint16(10, this.files.length, true);
      ev.setUint32(12, cdSize, true);
      ev.setUint32(16, cdOffset, true);
      ev.setUint16(20, 0, true);

      return new Blob([...localChunks, ...centralChunks, eocd], { type: 'application/zip' });
    }
  }

  class ZipReader {
    static async read(blobOrBuf) {
      const buffer = (blobOrBuf instanceof ArrayBuffer) ? blobOrBuf : await blobOrBuf.arrayBuffer();
      const view = new DataView(buffer);
      const u8 = new Uint8Array(buffer);
      const decoder = new TextDecoder('utf-8');
      const files = new Map();

      let eocd = -1;
      for (let i = buffer.byteLength - 22; i >= 0; i--) {
        if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
      }
      if (eocd === -1) throw new Error("Invalid ZIP file");

      const totalEntries = view.getUint16(eocd + 10, true);
      let cdPtr = view.getUint32(eocd + 16, true);

      for (let i = 0; i < totalEntries; i++) {
        if (view.getUint32(cdPtr, true) !== 0x02014b50) break;
        const method = view.getUint16(cdPtr + 10, true);
        const compSize = view.getUint32(cdPtr + 20, true);
        const nameLen = view.getUint16(cdPtr + 28, true);
        const extraLen = view.getUint16(cdPtr + 30, true);
        const commentLen = view.getUint16(cdPtr + 32, true);
        const localOffset = view.getUint32(cdPtr + 42, true);

        const name = decoder.decode(u8.subarray(cdPtr + 46, cdPtr + 46 + nameLen));
        const localNameLen = view.getUint16(localOffset + 26, true);
        const localExtraLen = view.getUint16(localOffset + 28, true);
        const dataStart = localOffset + 30 + localNameLen + localExtraLen;
        const rawBytes = u8.subarray(dataStart, dataStart + compSize);

        const getDecompressed = async () => {
          if (method === 0) return rawBytes;
          if (method === 8 && 'DecompressionStream' in window) {
            const ds = new DecompressionStream('deflate-raw');
            const res = new Response(new Blob([rawBytes]).stream().pipeThrough(ds));
            return new Uint8Array(await res.arrayBuffer());
          }
          return rawBytes;
        };

        files.set(name, {
          name,
          async text() { return decoder.decode(await getDecompressed()); },
          async uint8Array() { return await getDecompressed(); },
          async blob(mime = 'application/octet-stream') {
            const bytes = await getDecompressed();
            return new Blob([bytes], { type: mime });
          }
        });

        cdPtr += 46 + nameLen + extraLen + commentLen;
      }
      return files;
    }
  }

  window.XMZip = { ZipWriter, ZipReader };
})(window);