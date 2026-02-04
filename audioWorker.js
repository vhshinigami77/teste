import { parentPort, workerData } from 'worker_threads';
import fftPkg from 'fft-js';
import { frequencyToNote } from './dsp/noteUtils.js';

const { fft, util: fftUtil } = fftPkg;

// ==============================
// Dados recebidos
// ==============================
const { samples, sampleRate } = workerData;

// ==============================
// Utils
// ==============================
function nearestPowerOfTwo(n) {
  return 2 ** Math.floor(Math.log2(n));
}

// ==============================
// Parâmetros DSP
// ==============================
const WINDOW_SIZE = 4096;
const MIN_FREQ = 500;
const MAX_FREQ = 2100;

// ==============================
// Ajuste do tamanho da janela
// ==============================
const rawN = Math.min(WINDOW_SIZE, samples.length);
const N = nearestPowerOfTwo(rawN);

// Áudio curto demais
if (N < 1024) {
  parentPort.postMessage({
    frequency: 0,
    note: 'PAUSA',
    intensity: 0
  });
  process.exit(0);
}

// ==============================
// Intensidade (RMS) + gate de silêncio
// ==============================
let sumSq = 0;
for (let i = 0; i < N; i++) {
  const s = samples[i];
  sumSq += s * s;
}

const rms = Math.sqrt(sumSq / N);

// silêncio real → evita FFT
if (rms < 200) {
  parentPort.postMessage({
    frequency: 0,
    note: 'PAUSA',
    intensity: 0
  });
  process.exit(0);
}

// Normalização da intensidade
const dB = 20 * Math.log10(rms / 32768);
const intensity = Math.max(0, Math.min(1, (dB + 60) / 55));

// ==============================
// Janela de Hann (compatível com fft-js)
// ==============================
const windowed = new Array(N);
const twoPiOverN = 2 * Math.PI / (N - 1);

for (let n = 0; n < N; n++) {
  windowed[n] = samples[n] * (0.5 - 0.5 * Math.cos(twoPiOverN * n));
}

// ==============================
// FFT
// ==============================
const phasors = fft(windowed);
const mags = fftUtil.fftMag(phasors);
const freqResolution = sampleRate / N;

// ==============================
// Limites de bins úteis
// ==============================
const minBin = Math.floor(MIN_FREQ / freqResolution);
const maxBin = Math.ceil(MAX_FREQ / freqResolution);

// ==============================
// Busca da fundamental (penalizando harmônicos)
// ==============================
let bestFreq = 0;
let bestScore = 0;

for (let i = minBin; i <= maxBin; i++) {
  const mag = mags[i];
  if (!mag) continue;

  let score = mag;

  const i2 = i * 2;
  const i3 = i * 3;

  if (i2 < mags.length) score -= 0.6 * mags[i2];
  if (i3 < mags.length) score -= 0.3 * mags[i3];

  if (score > bestScore) {
    bestScore = score;
    bestFreq = i * freqResolution;
  }
}

// ==============================
// Gate espectral (anti-ruído)
// ==============================
if (!isFinite(bestFreq) || bestScore < 1e6) {
  parentPort.postMessage({
    frequency: 0,
    note: 'PAUSA',
    intensity: 0
  });
  process.exit(0);
}

// ==============================
// Segurança de faixa
// ==============================
if (bestFreq < MIN_FREQ || bestFreq > MAX_FREQ) {
  parentPort.postMessage({
    frequency: 0,
    note: 'PAUSA',
    intensity: 0
  });
  process.exit(0);
}

// ==============================
// Resultado final
// ==============================
parentPort.postMessage({
  frequency: Number(bestFreq.toFixed(2)),
  note: frequencyToNote(bestFreq),
  intensity: Number(intensity.toFixed(3))
});
