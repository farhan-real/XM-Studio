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
const binMap = new Uint8Array(FFT_BARS);

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
for (let b = 0; b < FFT_BARS; b++) {
  binMap[b] = Math.min(30, Math.floor(1 + Math.pow(b / (FFT_BARS - 1), 1.35) * 28));
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
    const binIdx = binMap[b];
    const re = fftRe[binIdx], im = fftIm[binIdx];
    const power = re * re + im * im;
    let val = 0;
    if (power > 1.024e-7) {
      const db = 10 * Math.log10(power) - 30.103;
      val = (255 * (db + 100) / 70 + 0.5) | 0;
      if (val < 10) val = 0;
      else if (val > 255) val = 255;
    }
    outTarget[outOffset + b] = val;
  }
}