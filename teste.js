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
  console.log(`🚀 Arquivo recebido: ${req.file.originalname} (${req.file.size} bytes)`);

  const inputPath = req.file.path;
  const outputWavPath = inputPath + '.wav';

  try {
    await convertToWav(inputPath, outputWavPath);
    console.log('✅ Conversão para WAV concluída.');

    const wavBuffer = fs.readFileSync(outputWavPath);
    const samples = extractSamplesFromWav(wavBuffer);
    const sampleRate = 44100;

    const windowSize = Math.floor(sampleRate * 0.5); // 0.5 segundos
    const analysisWindow = samples.slice(0, windowSize);

    const { freq: dominantFreq } = getDominantFrequencyDFT(analysisWindow, sampleRate);
    const amplitude = averageAmplitude(analysisWindow);
    const limiar = 2e-3;

    let dominantNote = 'PAUSA';
    if (amplitude >= limiar && dominantFreq > 0) {
      dominantNote = frequencyToNote(dominantFreq);
    }

    const notaFilename = `nota_${Date.now()}.txt`;
    const notaPath = path.join(publicDir, notaFilename);
    fs.writeFileSync(notaPath, typeof dominantNote === 'string' ? dominantNote : 'PAUSA');

    fs.unlinkSync(inputPath);
    fs.unlinkSync(outputWavPath);

    res.json({
      dominantFrequency: dominantFreq,
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
  let sum = 0;
  for (const s of samples) sum += Math.abs(s);
  return sum / samples.length;
}

function getDominantFrequencyDFT(samples, sampleRate) {
  const dt = 1 / sampleRate;
  const f1 = 16;
  const f2 = 1048;
  const df = 2;
  const totalf = Math.floor((f2 - f1) / df) + 1;

  let maxMagnitude = 0;
  let peakIndex = 0;
  const magnitudes = [];

  for (let j = 0; j < totalf; j++) {
    const f = f1 + j * df;
    let real = 0;
    let imag = 0;

    for (let i = 0; i < samples.length; i++) {
      const angle = 2 * Math.PI * f * i * dt;
      real += samples[i] * Math.cos(angle);
      imag -= samples[i] * Math.sin(angle);
    }

    real *= dt;
    imag *= dt;
    const mag = Math.sqrt(real * real + imag * imag);
    magnitudes.push(mag);

    if (mag > maxMagnitude) {
      maxMagnitude = mag;
      peakIndex = j;
    }
  }

  const f_peak = f1 + peakIndex * df;

  // Interpolação parabólica
  let refinedFreq = f_peak;
  if (peakIndex > 0 && peakIndex < totalf - 1) {
    const y1 = magnitudes[peakIndex - 1];
    const y2 = magnitudes[peakIndex];
    const y3 = magnitudes[peakIndex + 1];

    const p = (y3 - y1) / (2 * (2 * y2 - y1 - y3));
    refinedFreq = f1 + (peakIndex + p) * df;
  }

  return { freq: refinedFreq, amplitude: maxMagnitude };
}

function frequencyToNote(freq) {
  if (!freq || isNaN(freq) || freq <= 0) return 'PAUSA';

  const A4 = 440;
  const notas = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const n = Math.round(12 * Math.log2(freq / A4));
  const noteIndex = ((n + 9) % 12 + 12) % 12;
  const octave = 4 + Math.floor((n + 9) / 12);
  return notas[noteIndex] + octave;
}

app.use(express.static('teste'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor ouvindo na porta ${PORT}`);
});
