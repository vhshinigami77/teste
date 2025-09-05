import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import cors from 'cors';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const app = express();

// CORS bem explícito (inclui OPTIONS)
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
}));
app.options('/upload', cors());

const upload = multer({ dest: 'uploads/' });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------- Utils

function frequencyToNoteCStyle(freq) {
  if (!freq || freq <= 0 || isNaN(freq)) return 'PAUSA';
  const NOTES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const n = 12 * Math.log2(freq / 440); // semitons desde A4
  const q = Math.floor(Math.round(n + 9) / 12);
  const r = Math.round(n + 9) % 12;
  return `${NOTES[r]}${4 + q}`;
}

function hannWindowingRemoveDC(int16Array) {
  const N = int16Array.length;
  const out = new Float32Array(N);
  // remove DC
  let mean = 0;
  for (let i = 0; i < N; i++) mean += int16Array[i];
  mean /= N || 1;
  // Hann
  for (let i = 0; i < N; i++) {
    const w = 0.5 * (1 - Math.cos((2*Math.PI*i)/(N-1)));
    out[i] = (int16Array[i] - mean) * w;
  }
  return out;
}

// DFT por varredura (passo em Hz). Usa recorrência de seno/cosseno p/ performance.
function magnitudeAtFrequencies(signal, sampleRate, fStart, fEnd, stepHz) {
  const N = signal.length;
  const freqs = [];
  const mags  = [];

  for (let f = fStart; f <= fEnd; f += stepHz) {
    const w = 2 * Math.PI * f / sampleRate;
    // rotação incremental
    const cosStep = Math.cos(w);
    const sinStep = Math.sin(w);
    let cosPrev = 1;
    let sinPrev = 0;
    let real = 0;
    let imag = 0;

    for (let n = 0; n < N; n++) {
      const x = signal[n];
      real += x * cosPrev;
      imag -= x * sinPrev;

      // avança o ângulo
      const cosNew = cosPrev * cosStep - sinPrev * sinStep;
      const sinNew = sinPrev * cosStep + cosPrev * sinStep;
      cosPrev = cosNew;
      sinPrev = sinNew;
    }
    const mag = Math.hypot(real, imag);
    freqs.push(f);
    mags.push(mag);
  }
  return { freqs, mags };
}

// Harmonic Product Spectrum (3 harmônicos por padrão)
function hps(mags, harmonics = 3) {
  const L = mags.length;
  const out = new Float32Array(L);
  for (let i = 0; i < L; i++) {
    let prod = mags[i];
    for (let h = 2; h <= harmonics; h++) {
      const j = Math.floor(i * h);
      if (j >= L) break;
      prod *= mags[j];
    }
    out[i] = prod;
  }
  return out;
}

// Interpolação parabólica (3 pontos) para refinar o pico
function refineParabolic(arr, idx, stepHz) {
  const y1 = arr[idx - 1] ?? arr[idx];
  const y2 = arr[idx];
  const y3 = arr[idx + 1] ?? arr[idx];
  const denom = (y1 - 2*y2 + y3);
  if (!isFinite(denom) || Math.abs(denom) < 1e-12) return idx * stepHz;
  const delta = 0.5 * (y1 - y3) / denom; // deslocamento em "bins"
  return (idx + delta) * stepHz;
}

app.use(express.static('public'));

app.post('/upload', upload.single('audio'), async (req, res) => {
  try {
    const inputPath = req.file.path;
    const outputPath = `${inputPath}.wav`;

    // Converte para WAV, mono, 44.1 kHz
    execSync(`ffmpeg -y -i "${inputPath}" -ar 44100 -ac 1 "${outputPath}"`);

    const buffer = fs.readFileSync(outputPath);
    const headerSize = 44;
    const sampleRate = 44100;

    // Lê int16
    const int16Samples = [];
    for (let i = headerSize; i + 1 < buffer.length; i += 2) {
      int16Samples.push(buffer.readInt16LE(i));
    }

    // Janela de análise: usa tudo que veio, limitado a 1 s
    const maxWindow = sampleRate; // 1.0 s
    const N = Math.min(int16Samples.length, maxWindow);
    if (N < 2048) {
      // Muito curto para análise estável
      fs.unlinkSync(inputPath); fs.unlinkSync(outputPath);
      return res.json({ dominantFrequency: 0, dominantNote: 'PAUSA', magnitude: 0 });
    }

    // Pré-processamento: remove DC + Hann
    const x = hannWindowingRemoveDC(int16Samples.slice(0, N));

    // Faixa da flauta doce: C4 (~262 Hz) até D6 (~1175 Hz)
    const fMin = 240;   // um pouco abaixo de C4 para tolerância
    const fMax = 1200;  // cobre até D6 confortável
    const stepHz = 1;   // grade mais fina

    // Espectro por varredura
    const { freqs, mags } = magnitudeAtFrequencies(x, sampleRate, fMin, fMax, stepHz);

    // HPS (3 harmônicos) para favorecer o fundamental
    const hpsArr = hps(mags, 3);

    // Encontra pico em HPS
    let peakIdx = 0;
    let peakVal = -Infinity;
    for (let i = 0; i < hpsArr.length; i++) {
      if (hpsArr[i] > peakVal) {
        peakVal = hpsArr[i];
        peakIdx = i;
      }
    }

    // Se nada apareceu (silêncio)
    if (!isFinite(peakVal) || peakVal <= 0) {
      // intensidade ainda é útil p/ UI
      const rms = Math.sqrt(x.reduce((s, v) => s + v*v, 0) / x.length);
      let dB = 20 * Math.log10(rms / 32768);
      if (!isFinite(dB)) dB = -100;
      const minDb = -60, maxDb = -5;
      let intensity = (dB - minDb) / (maxDb - minDb);
      intensity = Math.max(0, Math.min(1, intensity));

      fs.unlinkSync(inputPath); fs.unlinkSync(outputPath);
      return res.json({ dominantFrequency: 0, dominantNote: 'PAUSA', magnitude: intensity });
    }

    // Refinamento parabólico (usa o espectro "mags", não o HPS)
    // pega frequência bruta da grade
    const fGrid = freqs[peakIdx];
    // índice correspondente no vetor mags (mesmo índice)
    let fRefined = refineParabolic(mags, peakIdx, stepHz);
    fRefined = Math.max(fMin, Math.min(fMax, fRefined));

    // Checagem anti-oitava: compara pico em f e f/2
    const halfF = fRefined / 2;
    if (halfF >= fMin) {
      const halfIdx = Math.round((halfF - fMin) / stepHz);
      const safeIdx = Math.max(0, Math.min(mags.length - 1, halfIdx));
      const ratio = mags[peakIdx] / (mags[safeIdx] + 1e-9);
      // se metade tem energia comparável, prefira metade (o fundamental)
      if (ratio < 1.25) { // ajuste fino (1.0 ~ 1.5) conforme seu micro/ambiente
        fRefined = halfF;
      }
    }

    // Limiar relativo: rejeita ruído
    const maxMag = Math.max(...mags);
    const limiarRel = 0.12 * maxMag; // 12% do maior pico (ajustável)
    let note;
    if (mags[peakIdx] < limiarRel || !isFinite(fRefined)) {
      note = 'PAUSA';
      fRefined = 0;
    } else {
      note = frequencyToNoteCStyle(fRefined);
    }

    // Intensidade (em dB → 0..1) para o UI
    const rms = Math.sqrt(x.reduce((s, v) => s + v*v, 0) / x.length);
    let dB = 20 * Math.log10(rms / 32768);
    if (!isFinite(dB)) dB = -100;
    const minDb = -60, maxDb = -5;
    let intensity = (dB - minDb) / (maxDb - minDb);
    intensity = Math.max(0, Math.min(1, intensity));

    console.log('============================');
    console.log(`dominantFrequency: ${fRefined.toFixed(2)} Hz (grid ${fGrid.toFixed(1)} Hz)`);
    console.log(`dominantNote: ${note}`);
    console.log(`RMS dB: ${dB.toFixed(2)} dB`);
    console.log(`intensity (0~1): ${intensity.toFixed(2)}`);
    console.log('============================');

    res.json({
      dominantFrequency: fRefined || 0,
      dominantNote: note,
      magnitude: intensity
    });

    fs.unlinkSync(inputPath);
    fs.unlinkSync(outputPath);
  } catch (err) {
    console.error('Erro:', err);
    res.status(500).json({ error: 'Erro na análise do áudio.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
