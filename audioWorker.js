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
// Parâmetros DSP (ajustados p/ flauta doce)
// ==============================
const WINDOW_SIZE = 4096;
const MIN_FREQ = 500;   // ~B4
const MAX_FREQ = 2100;  // ~C7

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
// Intensidade (RMS) + GATE DE SILÊNCIO
// ==============================
let sumSq = 0;
for (let i = 0; i < N; i++) {
  sumSq += samples[i] * samples[i];
}

const rms = Math.sqrt(sumSq / N);

// 🔇 silêncio real
if (rms < 200) {
  parentPort.postMessage({
    frequency: 0,
    note: 'PAUSA',
    intensity: 0
  });
  process.exit(0);
}

// Normalização de intensidade
const dB = 20 * Math.log10(rms / 32768);
const intensity = Math.max(0, Math.min(1, (dB + 60) / 55));

// ==============================
// Janela de Hann
// ==============================
const windowed = new Array(N);
for (let n = 0; n < N; n++) {
  const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * n / (N - 1));
  windowed[n] = samples[n] * w;
}

// ==============================
// FFT
// ==============================
const phasors = fft(windowed);
const mags = fftUtil.fftMag(phasors);
const freqResolution = sampleRate / N;

// ==============================
// Busca da fundamental (com penalização de harmônicos)
// ==============================
let bestFreq = 0;
let bestScore = 0;

for (let i = 1; i < mags.length / 2; i++) {
  const freq = i * freqResolution;
  if (freq < MIN_FREQ || freq > MAX_FREQ) continue;

  let score = mags[i];
  if (mags[2 * i]) score -= 0.6 * mags[2 * i];
  if (mags[3 * i]) score -= 0.3 * mags[3 * i];

  if (score > bestScore) {
    bestScore = score;
    bestFreq = freq;
  }
}

// ==============================
// Gate espectral (anti-ruído)
// ==============================
if (bestScore < 1e6) {
  parentPort.postMessage({
    frequency: 0,
    note: 'PAUSA',
    intensity: 0
  });
  process.exit(0);
}

// ==============================
// Segurança final de faixa
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
// Resultado
// ==============================
parentPort.postMessage({
  frequency: Number(bestFreq.toFixed(2)),
  note: frequencyToNote(bestFreq),
  intensity: Number(intensity.toFixed(3))
});
