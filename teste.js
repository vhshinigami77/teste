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

const publicDir = path.join(process.cwd(), 'public');
if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir);

app.post('/upload', upload.single('audio'), async (req, res) => {
  const inputPath = req.file.path;
  const outputWavPath = inputPath + '.wav';

  try {
    await convertToWav(inputPath, outputWavPath);
    const wavBuffer = fs.readFileSync(outputWavPath);
    const samples = extractSamplesFromWav(wavBuffer);
    const sampleRate = 44100;

    const dominantFreq = manualDFT(samples, sampleRate);
    const amplitude = averageAmplitude(samples);
    const threshold = 2e-3;

    let note = 'PAUSA';
    if (amplitude > threshold) {
      note = frequencyToNote(dominantFreq);
    }

    const notaFilename = `nota_${Date.now()}.txt`;
    const notaPath = path.join(publicDir, notaFilename);
    fs.writeFileSync(notaPath, note);

    fs.unlinkSync(inputPath);
    fs.unlinkSync(outputWavPath);

    res.json({
      dominantFrequency: parseFloat(dominantFreq.toFixed(2)),
      dominantNote: note,
      downloads: {
        nota: `/${notaFilename}`
      }
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao processar áudio.' });
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
    const s = buffer.readInt16LE(i) / 32768;
    samples.push(s);
  }
  return samples;
}

function averageAmplitude(samples) {
  const sum = samples.reduce((acc, val) => acc + Math.abs(val), 0);
  return sum / samples.length;
}

// Transformada de Fourier manual com janela de Hann
function manualDFT(samples, sampleRate) {
  const f1 = 16, f2 = 1048, df = 2;
  const dt = 1 / sampleRate;
  const t = samples.map((_, i) => i * dt);
  const hann = samples.map((_, i, arr) => 0.5 * (1 - Math.cos(2 * Math.PI * i / (arr.length - 1))));
  const y = samples.map((s, i) => s * hann[i]);

  let maxMag = 0;
  let freqMax = 0;

  for (let f = f1; f <= f2; f += df) {
    let re = 0, im = 0;
    for (let i = 0; i < y.length; i++) {
      re += y[i] * Math.cos(2 * Math.PI * f * t[i]);
      im -= y[i] * Math.sin(2 * Math.PI * f * t[i]);
    }
    const magnitude = Math.sqrt(re * re + im * im);
    if (magnitude > maxMag) {
      maxMag = magnitude;
      freqMax = f;
    }
  }

  return freqMax;
}

// Conversão frequência → nota musical
function frequencyToNote(freq) {
  if (!freq || freq <= 0) return 'PAUSA';

  const notas = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const A4 = 440;
  const n = Math.round(12 * Math.log2(freq / A4));
  const noteIndex = (n + 9 + 12 * 1000) % 12;  // Corrige negativos
  const octave = 4 + Math.floor((n + 9) / 12);
  return notas[noteIndex] + octave;
}

app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🎵 Servidor rodando na porta ${PORT}`);
});
