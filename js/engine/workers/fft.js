/**
 * js/engine/workers/fft.js - Dedicated 64-point FFT and logarithmic spectrum analysis engine.
 */
const FFT_SIZE = 64;
const FFT_BARS = 28;
const fftRe = new Float32Array(FFT_SIZE);
const fftIm = new Float32Array(FFT_SIZE);
const hannWindow = new Float32Array(FFT_SIZE);
const cosTable = new Float32Array(FFT_SIZE / 2);
const sinTable = new Float32Array(FFT_SIZE / 2);
const bitRev = new Uint8Array(FFT_SIZE);

for (let i = 0; i < FFT_SIZE; i++) {
  hannWindow[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)));
  let rev = 0;
  for (let j = 0; j < 6; j++) rev = (rev << 1) | ((i >> j) & 1);
  bitRev[i] = rev;
}
for (let i = 0; i < FFT_SIZE / 2; i++) {
  cosTable[i] = Math.cos((-2 * Math.PI * i) / FFT_SIZE);
  sinTable[i] = Math.sin((-2 * Math.PI * i) / FFT_SIZE);
}

function computeFftBars(inputSamples, outTarget, outOffset) {
  for (let i = 0; i < FFT_SIZE; i++) {
    const rev = bitRev[i];
    fftRe[rev] = inputSamples[i] * hannWindow[i];
    fftIm[rev] = 0;
  }
  for (let len = 2; len <= FFT_SIZE; len <<= 1) {
    const halfLen = len >> 1;
    const step = FFT_SIZE / len;
    for (let i = 0; i < FFT_SIZE; i += len) {
      for (let j = 0; j < halfLen; j++) {
        const tIdx = j * step;
        const c = cosTable[tIdx], s = sinTable[tIdx];
        const tr = c * fftRe[i + j + halfLen] - s * fftIm[i + j + halfLen];
        const ti = s * fftRe[i + j + halfLen] + c * fftIm[i + j + halfLen];
        fftRe[i + j + halfLen] = fftRe[i + j] - tr;
        fftIm[i + j + halfLen] = fftIm[i + j] - ti;
        fftRe[i + j] += tr;
        fftIm[i + j] += ti;
      }
    }
  }
  for (let b = 0; b < FFT_BARS; b++) {
    const binIdx = Math.min(30, Math.floor(1 + Math.pow(b / (FFT_BARS - 1), 1.35) * 28));
    const mag = Math.sqrt(fftRe[binIdx] * fftRe[binIdx] + fftIm[binIdx] * fftIm[binIdx]) / 32.0;
    let val = 0;
    if (mag > 0.00001) {
      const db = 20 * Math.log10(mag);
      val = Math.round(255 * (db + 100) / 70);
      if (val < 10) val = 0;
      else if (val > 255) val = 255;
    }
    outTarget[outOffset + b] = val;
  }
}