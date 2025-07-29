import express from 'express';
import multer from 'multer';
import cors from 'cors';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import fs from 'fs';
import path from 'path';
import wav from 'node-wav';

const app = express();
app.use(cors());
const upload = multer({ dest: 'uploads/' });
ffmpeg.setFfmpegPath(ffmpegStatic);

const publicDir = path.join(process.cwd(), 'public');
if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir);

app.post('/upload', upload.single('audio'), async (req, res) => {
  const inputPath = req.file.path;
  const outputWavPath = inputPath + '.wav';

  try {
    await convertToWav(inputPath, outputWavPath);
    const buffer = fs.readFileSync(outputWavPath);
    const result = wav.decode(buffer);
    const channelData = result.channelData[0]; // Usar só o canal esquerdo (mono)
    const sampleRate = result.sampleRate;

    const windowSamples = Math.floor(sampleRate * 0.5); // Janela de 0.5s
    if (channelData.length < windowSamples) {
      throw new Error('Áudio muito curto para análise (menos de 0.5s)');
    }

    const segment = Array.from(channelData.slice(0, windowSamples));

    const freqResult = dftDominantFrequency(segment, sampleRate, 16, 1048, 2);
    const freq = freqResult.freq;
    const amplitude = freqResult.amplitude;

    const threshold = 2e-3;
    let note = 'PAUSA';
    if (amplitude > threshold && freq > 0) {
      note = frequencyToNote(freq);
    }

    const filename = `nota_${Date.now()}.txt`;
    const notaPath = path.join(publicDir, filename);
    fs.writeFileSync(notaPath, note);

    fs.unlinkSync(inputPath);
    fs.unlinkSync(outputWavPath);

    res.json({
      dominantFrequency: freq.toFixed(2),
      dominantNote: note,
      downloads: {
        nota: `/${filename}`
      }
    });

  } catch (err) {
    console.error('❌ Erro:', err);
    res.status(500).json({
      error: 'Erro no envio/análise.',
      dominantNote: 'PAUSA',
      dominantFrequency: 'Hz'
    });
  }
});

function convertToWav(input, output) {
  return new Promise((resolve, reject) => {
    ffmpeg(input)
      .audioChannels(1)
      .audioFrequency(44100)
      .format('wav')
      .on('end', resolve)
      .on('error', reject)
      .save(output);
  });
}

function dftDominantFrequency(samples, sampleRate, fStart, fEnd, df) {
  const dt = 1 / sampleRate;
  let maxMag = 0;
  let fDominant = 0;

  for (let f = fStart; f <= fEnd; f += df) {
    let real = 0;
    let imag = 0;
    for (let i = 0; i < samples.length; i++) {
      const angle = 2 * Math.PI * f * i * dt;
      real += samples[i] * Math.cos(angle);
      imag -= samples[i] * Math.sin(angle);
    }
    real *= dt;
    imag *= dt;

    const magnitude = Math.sqrt(real * real + imag * imag);
    if (magnitude > maxMag) {
      maxMag = magnitude;
      fDominant = f;
    }
  }

  return { freq: fDominant, amplitude: maxMag };
}

function frequencyToNote(freq) {
  const A4 = 440;
  const notas = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const n = 12 * Math.log2(freq / A4);
  const rounded = Math.round(n);
  const noteIndex = (rounded + 9 + 12) % 12;
  const octave = 4 + Math.floor((rounded + 9) / 12);
  return notas[noteIndex] + octave;
}

app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
