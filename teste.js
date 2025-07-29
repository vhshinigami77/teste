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

app.post('/upload', upload.single('audio'), async (req, res) => {
  const inputPath = req.file.path;
  const outputWavPath = inputPath + '.wav';

  try {
    await convertToWav(inputPath, outputWavPath);
    const wavBuffer = fs.readFileSync(outputWavPath);
    const samples = extractSamplesFromWav(wavBuffer);
    const sampleRate = 44100;

    const duration = 0.5; // janela de 0.5s
    const windowSize = Math.min(samples.length, Math.floor(sampleRate * duration));
    const slicedSamples = samples.slice(0, windowSize);

    const { dominantFreq, magnitude } = getDominantFrequencyDFT(slicedSamples, sampleRate);
    const amplitude = averageAmplitude(slicedSamples);
    const limiar = 2e-3;

    let dominantNote = 'PAUSA';
    if (amplitude >= limiar && dominantFreq > 0) {
      dominantNote = frequencyToNote(dominantFreq);
    }

    const notaFilename = `nota_${Date.now()}.txt`;
    const notaPath = path.join(publicDir, notaFilename);
    fs.writeFileSync(notaPath, dominantNote);

    fs.unlinkSync(inputPath);
    fs.unlinkSync(outputWavPath);

    res.json({
      dominantFrequency: parseFloat(dominantFreq.toFixed(2)),
      dominantNote,
      downloads: {
        nota: `/${notaFilename}`
      }
    });

  } catch (err) {
    console.error('❌ Erro:', err);
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

function averageAmplitude(samples) {
  const sum = samples.reduce((a, b) => a + Math.abs(b), 0);
  return sum / samples.length;
}

// DFT manual com df = 2 Hz de 16 até 1048 Hz
function getDominantFrequencyDFT(samples, sampleRate) {
  const dt = 1 / sampleRate;
  const t = samples.map((_, i) => i * dt);
  const f1 = 16;
  const f2 = 1048;
  const df = 2;
  const totalf = Math.round((f2 - f1) / df) + 1;

  let maxMag = 0;
  let dominantFreq = 0;

  for (let j = 0; j < totalf; j++) {
    const f = f1 + j * df;
    let real = 0;
    let imag = 0;

    for (let i = 0; i < samples.length; i++) {
      real += samples[i] * Math.cos(2 * Math.PI * f * t[i]);
      imag += -samples[i] * Math.sin(2 * Math.PI * f * t[i]);
    }

    real *= dt;
    imag *= dt;

    const mag = Math.sqrt(real * real + imag * imag);
    if (mag > maxMag) {
      maxMag = mag;
      dominantFreq = f;
    }
  }

  return { dominantFreq, magnitude: maxMag };
}

// Conversão robusta freq -> nota
function frequencyToNote(freq) {
  if (!freq || freq <= 0) return 'PAUSA';

  const A4 = 440;
  const notas = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const n = Math.round(12 * Math.log2(freq / A4));
  const noteIndex = (n + 9 + 12) % 12; // A4 = index 9
  const octave = 4 + Math.floor((n + 9) / 12);
  return notas[noteIndex] + octave;
}

app.use(express.static('teste'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor ouvindo na porta ${PORT}`);
});
