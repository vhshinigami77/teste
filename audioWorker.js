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
const WINDOW_SIZE = 8192;          // ↑ mais resolução
const MIN_FREQ = 500;
const MAX_FREQ = 2100;

// ==============================
// Ajuste do tamanho da janela
// ==============================
const rawN = Math.min(WINDOW_SIZE, samples.length);
const N = nearestPowerOfTwo(rawN);

if (N < 2048) {
  parentPort.postMessage({ frequency: 0, note: 'PAUSA', intensity: 0 });
  process.exit(0);
}

// ==============================
// Intensidade RMS
// ==============================
let sumSq = 0;
for (let i = 0; i < N; i++) sumSq += samples[i] ** 2;

const rms = Math.sqrt(sumSq / N);

// gate de silêncio real
if (rms < 250) {
  parentPort.postMessage({ frequency: 0, note: 'PAUSA', intensity: 0 });
  process.exit(0);
}

const dB = 20 * Math.log10(rms / 32768);
const intensity = Math.max(0, Math.min(1, (dB + 60) / 55));

// ==============================
// Janela de Hann
// ==============================
const windowed = new Array(N);
for (let n = 0; n < N; n++) {
  windowed[n] = samples[n] * (0.5 - 0.5 * Math.cos(2 * Math.PI * n / (N - 1)));
}

// ==============================
// FFT
// ==============================
const phasors = fft(windowed);
const mags = fftUtil.fftMag(phasors);
const freqResolution = sampleRate / N;

// ==============================
// Limites de busca
// ==============================
const minBin = Math.floor(MIN_FREQ / freqResolution);
const maxBin = Math.ceil(MAX_FREQ / freqResolution);

// ==============================
// Busca da fundamental (robusta)
// ==============================
let bestBin = -1;
let bestScore = 0;

for (let i = minBin + 1; i <= maxBin - 1; i++) {
  const mag = mags[i];
  if (!mag) continue;

  let score = mag;

  // penaliza harmônicos
  if (i * 2 < mags.length) score -= 0.7 * mags[i * 2];
  if (i * 3 < mags.length) score -= 0.4 * mags[i * 3];

  if (score > bestScore) {
    bestScore = score;
    bestBin = i;
  }
}

if (bestBin < 0 || bestScore < 8e5) {
  parentPort.postMessage({ frequency: 0, note: 'PAUSA', intensity: 0 });
  process.exit(0);
}

// ==============================
// Interpolação parabólica
// ==============================
const m1 = mags[bestBin - 1];
const m2 = mags[bestBin];
const m3 = mags[bestBin + 1];

let refinedBin = bestBin;
const denom = (m1 - 2 * m2 + m3);

if (denom !== 0) {
  refinedBin += 0.5 * (m1 - m3) / denom;
}

const refinedFreq = refinedBin * freqResolution;

// ==============================
// Segurança final
// ==============================
if (
  !isFinite(refinedFreq) ||
  refinedFreq < MIN_FREQ ||
  refinedFreq > MAX_FREQ
) {
  parentPort.postMessage({ frequency: 0, note: 'PAUSA', intensity: 0 });
  process.exit(0);
}

// ==============================
// Resultado
// ==============================
parentPort.postMessage({
  frequency: Number(refinedFreq.toFixed(2)),
  note: frequencyToNote(refinedFreq),
  intensity: Number(intensity.toFixed(3))
});
