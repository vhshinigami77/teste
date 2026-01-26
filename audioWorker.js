import { parentPort, workerData } from 'worker_threads';
import { fft, util as fftUtil } from 'fft-js';
import { frequencyToNote } from './dsp/noteUtils.js';

// ==============================
// Dados recebidos
// ==============================
const { samples, sampleRate } = workerData;

// ==============================
// Parâmetros DSP
// ==============================
const WINDOW_SIZE = 4096; // ~93 ms @ 44.1 kHz
const MIN_FREQ = 50;
const MAX_FREQ = 1200;

// ==============================
// Janela de Hann
// ==============================
const N = Math.min(WINDOW_SIZE, samples.length);
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
// Fundamental (com penalização de harmônicos)
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
// Intensidade (RMS)
// ==============================
let sumSq = 0;
for (let i = 0; i < N; i++) {
  sumSq += samples[i] * samples[i];
}
const rms = Math.sqrt(sumSq / N);
const dB = 20 * Math.log10(rms / 32768);
const intensity = Math.max(0, Math.min(1, (dB + 60) / 55));

// ==============================
// Resultado
// ==============================
parentPort.postMessage({
  frequency: bestFreq,
  note: frequencyToNote(bestFreq),
  intensity
});