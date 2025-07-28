import express from 'express';
import multer from 'multer';
import cors from 'cors';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import fs from 'fs';
import path from 'path';

const app = express();
app.use(cors());
const upload = multer({ dest: 'uploads/' });
ffmpeg.setFfmpegPath(ffmpegStatic);

app.use(express.json());

const publicDir = path.join(process.cwd(), 'teste');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir);
}

app.post('/upload', async (req, res) => {
  upload.single('audio')(req, res, async err => {
    if (err) {
      return res.status(500).json({ error: 'Erro no upload' });
    }
    try {
      console.log(`🚀 Arquivo recebido: ${req.file.originalname} (${req.file.size} bytes)`);

      const inputPath = req.file.path;
      const outputWavPath = inputPath + '.wav';

      await convertToWav(inputPath, outputWavPath);
      console.log('✅ Conversão para WAV concluída.');

      const wavBuffer = fs.readFileSync(outputWavPath);
      const samples = extractSamplesFromWav(wavBuffer);
      const sampleRate = 44100;

      const dominantFreq = getDominantFrequency(samples, sampleRate);

      const amplitude = averageAmplitude(samples);
      const limiar = 2e-3;

      let dominantNote = 'PAUSA';
      if (amplitude >= limiar && dominantFreq > 0) {
        dominantNote = frequencyToNote(dominantFreq);
      }

      const notaFilename = `nota_${Date.now()}.txt`;
      const notaPath = path.join(publicDir, notaFilename);
      fs.writeFileSync(notaPath, dominantNote);

      // Remove arquivos temporários
      fs.unlinkSync(inputPath);
      fs.unlinkSync(outputWavPath);

      res.json({
        dominantFrequency: dominantFreq,
        dominantNote,
        downloads: {
          nota: `/${notaFilename}`
        }
      });
    } catch (error) {
      console.error('❌ Erro:', error);
      res.status(500).json({ error: 'Erro no processamento do áudio' });
    }
  });
});

function convertToWav(input, output) {
  return new Promise((resolve, reject) => {
    ffmpeg(input)
      .toFormat('wav')
      .on('end', resolve)
      .on('error', reject)
      .save(output);
  });
}

function extractSamplesFromWav(buffer) {
  const samples = [];
  for (let i = 44; i < buffer.length; i += 2) {
    const sample = buffer.readInt16LE(i);
    samples.push(sample / 32768);
  }
  return samples;
}

function averageAmplitude(samples) {
  let sum = 0;
  for (const s of samples) {
    sum += Math.abs(s);
  }
  return sum / samples.length;
}

// FFT simples (Cooley-Tukey), retorna array de {re, im}
function fftReal(buffer) {
  const N = buffer.length;
  if (N <= 1) return [{ re: buffer[0], im: 0 }];

  if ((N & (N - 1)) !== 0) {
    const size = 1 << Math.ceil(Math.log2(N));
    const padded = new Array(size).fill(0);
    for (let i = 0; i < N; i++) padded[i] = buffer[i];
    return fftReal(padded);
  }

  const even = fftReal(buffer.filter((_, i) => i % 2 === 0));
  const odd = fftReal(buffer.filter((_, i) => i % 2 === 1));

  const combined = [];
  for (let k = 0; k < N / 2; k++) {
    const t = expComplex(-2 * Math.PI * k / N);
    const oddPart = complexMul(t, odd[k]);
    combined[k] = complexAdd(even[k], oddPart);
    combined[k + N / 2] = complexSub(even[k], oddPart);
  }
  return combined;
}

function expComplex(theta) {
  return { re: Math.cos(theta), im: Math.sin(theta) };
}

function complexAdd(a, b) {
  return { re: a.re + b.re, im: a.im + b.im };
}

function complexSub(a, b) {
  return { re: a.re - b.re, im: a.im - b.im };
}

function complexMul(a, b) {
  return { re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re };
}

// Função aprimorada para detectar frequência dominante usando janela Hanning, FFT 8192 e interpolação
function getDominantFrequency(samples, sampleRate) {
  const N = Math.min(8192, samples.length);
  const windowed = new Array(N);
  for (let i = 0; i < N; i++) {
    const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (N - 1))); // janela Hanning
    windowed[i] = samples[i] * w;
  }

  const fft = fftReal(windowed);

  const mags = [];
  for (let i = 1; i < N / 2 - 1; i++) { // evita out of bounds no pico interpolado
    mags[i] = Math.sqrt(fft[i].re ** 2 + fft[i].im ** 2);
  }

  let maxIndex = 1;
  for (let i = 2; i < N / 2 - 1; i++) {
    if (mags[i] > mags[maxIndex]) maxIndex = i;
  }

  // Interpolação do pico
  const alpha = mags[maxIndex - 1];
  const beta = mags[maxIndex];
  const gamma = mags[maxIndex + 1];
  const p = 0.5 * (alpha - gamma) / (alpha - 2 * beta + gamma);

  const binFreq = (maxIndex + p) * sampleRate / N;
  return binFreq;
}

// Conversão frequência -> nota musical igual ao C original
function frequencyToNote(freq) {
  if (!freq || freq <= 0) return 'PAUSA';

  const notas = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const A4 = 440;

  const n = 12 * Math.log(freq / A4) / Math.log(2);
  const rounded = Math.round(n + 9);
  const octave = 4 + Math.floor(rounded / 12);
  const noteIndex = ((rounded % 12) + 12) % 12;

  return notas[noteIndex] + octave;
}

app.use(express.static('teste'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor ouvindo na porta ${PORT}`);
});
