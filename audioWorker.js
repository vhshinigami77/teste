import { parentPort, workerData } from 'worker_threads';
import fftPkg from 'fft-js';
import { frequencyToNote } from './dsp/noteUtils.js';

const { fft, util: fftUtil } = fftPkg;

/* =====================================================
   Dados recebidos do thread principal
===================================================== */
const { samples, sampleRate } = workerData;

/* =====================================================
   Utilitário: potência de 2 mais próxima
   FFT funciona melhor (e mais rápido) assim
===================================================== */
function nearestPowerOfTwo(n) {
  return 2 ** Math.floor(Math.log2(n));
}

/* =====================================================
   Parâmetros DSP (ajustados para flauta doce)
===================================================== */
const WINDOW_SIZE = 8192; // maior N = melhor resolução
const MIN_FREQ = 500;
const MAX_FREQ = 2100;

/* =====================================================
   Ajuste do tamanho da janela
===================================================== */
const rawN = Math.min(WINDOW_SIZE, samples.length);
const N = nearestPowerOfTwo(rawN);

// áudio curto demais → espectro inútil
if (N < 2048) {
  parentPort.postMessage({ frequency: 0, note: 'PAUSA', intensity: 0 });
  process.exit(0);
}

/* =====================================================
   Cálculo RMS (energia do sinal)
===================================================== */
let sumSq = 0;
for (let i = 0; i < N; i++) {
  sumSq += samples[i] * samples[i];
}

const rms = Math.sqrt(sumSq / N);

// gate de silêncio real
if (rms < 250) {
  parentPort.postMessage({ frequency: 0, note: 'PAUSA', intensity: 0 });
  process.exit(0);
}

// normalização da intensidade (0–1)
const dB = 20 * Math.log10(rms / 32768);
const intensity = Math.max(0, Math.min(1, (dB + 60) / 55));

/* =====================================================
   Janela de Hann (reduz leakage espectral)
===================================================== */
const windowed = new Array(N);

for (let n = 0; n < N; n++) {
  const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * n / (N - 1));
  windowed[n] = samples[n] * w;
}

/* =====================================================
   FFT
===================================================== */
const phasors = fft(windowed);
const mags = fftUtil.fftMag(phasors);
const freqResolution = sampleRate / N;

/* =====================================================
   Limites de busca (bins)
===================================================== */
const minBin = Math.floor(MIN_FREQ / freqResolution);
const maxBin = Math.ceil(MAX_FREQ / freqResolution);

/* =====================================================
   Busca da frequência fundamental
   com penalização de harmônicos
===================================================== */
let bestBin = -1;
let bestScore = 0;

for (let i = minBin + 1; i <= maxBin - 1; i++) {
  let score = mags[i];
  if (!score) continue;

  // penaliza harmônicos (2ª e 3ª)
  if (i * 2 < mags.length) score -= 0.7 * mags[i * 2];
  if (i * 3 < mags.length) score -= 0.4 * mags[i * 3];

  if (score > bestScore) {
    bestScore = score;
    bestBin = i;
  }
}

// pico fraco → ruído
if (bestBin < 0 || bestScore < 8e5) {
  parentPort.postMessage({ frequency: 0, note: 'PAUSA', intensity: 0 });
  process.exit(0);
}

/* =====================================================
   Interpolação parabólica (sub-bin)
===================================================== */
const m1 = mags[bestBin - 1];
const m2 = mags[bestBin];
const m3 = mags[bestBin + 1];

let refinedBin = bestBin;
const denom = (m1 - 2 * m2 + m3);

if (denom !== 0) {
  refinedBin += 0.5 * (m1 - m3) / denom;
}

const refinedFreq = refinedBin * freqResolution;

/* =====================================================
   Validação final
===================================================== */
if (
  !isFinite(refinedFreq) ||
  refinedFreq < MIN_FREQ ||
  refinedFreq > MAX_FREQ
) {
  parentPort.postMessage({ frequency: 0, note: 'PAUSA', intensity: 0 });
  process.exit(0);
}

/* =====================================================
   Resultado final
===================================================== */
parentPort.postMessage({
  frequency: Number(refinedFreq.toFixed(2)),
  note: frequencyToNote(refinedFreq),
  intensity: Number(intensity.toFixed(3))
});
