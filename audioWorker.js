import { parentPort } from 'worker_threads';
import fftPkg from 'fft-js';
import { frequencyToNote } from './dsp/noteUtils.js';

const { fft, util } = fftPkg;

const N = 2048;
const RMS_THRESHOLD = 0.015; // ← limiar de sonoridade realista

function computeRMS(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / samples.length);
}

parentPort.on('message', ({ samples, sampleRate }) => {

  if (!samples || samples.length < N) {
    parentPort.postMessage({
      note: 'PAUSA',
      frequency: 0,
      intensity: 0
    });
    return;
  }

  // 🔊 RMS — DETECÇÃO DE SILÊNCIO
  const rms = computeRMS(samples);

  if (rms < RMS_THRESHOLD) {
    parentPort.postMessage({
      note: 'PAUSA',
      frequency: 0,
      intensity: Number(rms.toFixed(4))
    });
    return;
  }

  // 🪟 Janela de Hann
  const windowed = new Array(N);
  for (let i = 0; i < N; i++) {
    const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1));
    windowed[i] = samples[i] * w;
  }

  // 🔍 FFT
  const mags = util.fftMag(fft(windowed));
  const freqRes = sampleRate / N;

  let bestI = 0;
  let bestScore = 0;

  for (let i = 1; i < mags.length / 2; i++) {
    const f = i * freqRes;
    if (f < 50 || f > 1200) continue;

    let score = mags[i];
    if (mags[2 * i]) score -= 0.6 * mags[2 * i];
    if (mags[3 * i]) score -= 0.3 * mags[3 * i];

    if (score > bestScore) {
      bestScore = score;
      bestI = i;
    }
  }

  // 🎯 Interpolação parabólica
  let freq = bestI * freqRes;
  if (bestI > 0 && bestI < mags.length - 1) {
    const a = mags[bestI - 1];
    const b = mags[bestI];
    const c = mags[bestI + 1];
    const p = 0.5 * (a - c) / (a - 2 * b + c);
    freq = (bestI + p) * freqRes;
  }

  // 🔊 Intensidade normalizada (0–1)
  const intensity = Math.min(1, rms * 20);

  parentPort.postMessage({
    frequency: Number(freq.toFixed(2)),
    note: frequencyToNote(freq),
    intensity: Number(intensity.toFixed(3))
  });
});
