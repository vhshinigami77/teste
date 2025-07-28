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
if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir);

app.post('/upload', upload.single('audio'), async (req, res) => {
  console.log(`🚀 Arquivo recebido: ${req.file.originalname} (${req.file.size} bytes)`);

  const inputPath = req.file.path;
  const outputWavPath = inputPath + '.wav';

  try {
    await convertToWav(inputPath, outputWavPath);
    console.log('✅ Conversão para WAV concluída.');

    const wavBuffer = fs.readFileSync(outputWavPath);
    const samples = extractSamplesFromWav(wavBuffer);
    const sampleRate = 44100;
    const dt = 1 / sampleRate;

    const dominantFreq = dftDominantFrequency(samples, dt);

    const amplitude = averageAmplitude(samples);
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
      dominantFrequency: Number(dominantFreq.toFixed(2)),
      dominantNote,
      downloads: { nota: `/${notaFilename}` }
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
  return samples.reduce((acc, s) => acc + Math.abs(s), 0) / samples.length;
}

// DFT manual com frequência entre 16 e 1048 Hz e passo 2 Hz
function dftDominantFrequency(samples, dt) {
  const f1 = 16;
  const f2 = 1048;
  const df = 2;
  const totalf = Math.round((f2 - f1) / df) + 1;

  let maxMag = 0;
  let fMax = 0;

  for (let j = 0; j < totalf; j++) {
    const f = f1 + j * df;
    let real = 0;
    let imag = 0;

    for (let i = 0; i < samples.length; i++) {
      const t = i * dt;
      const angle = 2 * Math.PI * f * t;
      real += samples[i] * Math.cos(angle);
      imag += -samples[i] * Math.sin(angle);
    }

    real *= dt;
    imag *= dt;
    const mag = Math.sqrt(real * real + imag * imag);

    if (mag > maxMag) {
      maxMag = mag;
      fMax = f;
    }
  }

  return fMax;
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
