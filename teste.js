import express from 'express';
import multer from 'multer';
import cors from 'cors';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import fs from 'fs';
import path from 'path';

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ dest: 'uploads/' });
ffmpeg.setFfmpegPath(ffmpegStatic);

const publicDir = path.join(process.cwd(), 'teste');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir);
}

app.post('/upload', upload.single('audio'), async (req, res) => {
  const inputPath = req.file.path;
  const outputWavPath = inputPath + '.wav';

  try {
    await convertToWav(inputPath, outputWavPath);

    const wavBuffer = fs.readFileSync(outputWavPath);
    const samples = extractSamplesFromWav(wavBuffer);
    const sampleRate = 44100;

    // Usa janela de 0.5s para melhor resolução
    const windowSize = Math.min(Math.floor(sampleRate * 0.5), samples.length);
    const windowedSamples = samples.slice(0, windowSize);

    const { refinedFreq, amplitude } = getDominantFrequencyDFT(windowedSamples, sampleRate);
    const limiar = 2e-3;

    let dominantNote = 'PAUSA';
    if (amplitude >= limiar && refinedFreq > 0) {
      dominantNote = frequencyToNote(refinedFreq);
    }

    const notaFilename = `nota_${Date.now()}.txt`;
    const notaPath = path.join(publicDir, notaFilename);
    fs.writeFileSync(notaPath, dominantNote);

    fs.unlinkSync(inputPath);
    fs.unlinkSync(outputWavPath);

    res.json({
      dominantFrequency: refinedFreq,
      dominantNote,
      downloads: {
        nota: `/${notaFilename}`
      }
    });

  } catch (err) {
    console.error('Erro no processamento:', err);
    res.status(500).json({ error: 'Erro no processamento do áudio' });
  }
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

function getDominantFrequencyDFT(samples, sampleRate) {
  const dt = 1 / sampleRate;
  const f1 = 16;
  const f2 = 1048;
  const df = 2;
  const N = samples.length;
  const magnitudes = [];
  let maxMag = 0;
  let maxIndex = 0;

  for (let j = 0; j <= Math.floor((f2 - f1) / df); j++) {
    const f = f1 + j * df;
    let real = 0, imag = 0;
    for (let i = 0; i < N; i++) {
      const t = i * dt;
      const angle = 2 * Math.PI * f * t;
      real += samples[i] * Math.cos(angle);
      imag -= samples[i] * Math.sin(angle);
    }
    real *= dt;
    imag *= dt;
    const mag = Math.sqrt(real * real + imag * imag);
    magnitudes.push(mag);

    if (mag > maxMag) {
      maxMag = mag;
      maxIndex = j;
    }
  }

  // Interpolação parabólica para refinar frequência
  const y0 = magnitudes[maxIndex - 1] || 0;
  const y1 = magnitudes[maxIndex];
  const y2 = magnitudes[maxIndex + 1] || 0;
  const delta = (y2 - y0) / (2 * (2 * y1 - y2 - y0 || 1e-12));
  const refinedIndex = maxIndex + delta;
  const refinedFreq = f1 + refinedIndex * df;

  return { refinedFreq, amplitude: maxMag };
}

function frequencyToNote(freq) {
  if (!freq || freq <= 0) return 'PAUSA';

  const notas = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const A4 = 440;
  const n = 12 * Math.log2(freq / A4);
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
