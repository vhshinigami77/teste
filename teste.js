// backend.mjs
import express from 'express';
import multer from 'multer';
import cors from 'cors';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import fs from 'fs';
import path from 'path';
import { fft } from 'fft-js';

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
    const blockSize = Math.floor(sampleRate * 0.1);

    const amplitudeData = [];
    for (let i = 0; i < samples.length; i += blockSize) {
      const block = samples.slice(i, i + blockSize);
      const avg = block.reduce((acc, v) => acc + Math.abs(v), 0) / block.length;
      amplitudeData.push({ time: (i / sampleRate).toFixed(1), amplitude: avg });
    }

    const ampFilename = `amplitude_${Date.now()}.txt`;
    const ampPath = path.join(publicDir, ampFilename);
    const ampContent = amplitudeData.map(d => `${d.time}\t${d.amplitude}`).join('\n');
    fs.writeFileSync(ampPath, ampContent);

    const fftBlockSize = 2048;
    const blockStart = Math.floor(samples.length / 3);
    const fftSamples = samples.slice(blockStart, blockStart + fftBlockSize);

    const phasors = fft(fftSamples);
    const fftData = phasors.slice(0, fftBlockSize / 2).map((c, idx) => {
      const re = c[0], im = c[1];
      return {
        frequency: (idx * sampleRate) / fftBlockSize,
        amplitude: Math.sqrt(re * re + im * im)
      };
    }).filter(d => d.frequency >= 60 && d.frequency <= 1000);

    const harmonicWeighted = fftData.map((d, i) => {
      let score = d.amplitude;
      for (let h = 2; h <= 5; h++) {
        const harmonicFreq = d.frequency * h;
        const harmonic = fftData.find(hf => Math.abs(hf.frequency - harmonicFreq) < 5);
        if (harmonic) score += harmonic.amplitude * 0.5; // peso menor
      }
      return { ...d, score };
    });

    const strongest = harmonicWeighted.reduce((a, b) => (b.score > a.score ? b : a));

    const limiar = 2e-3;
    const dominantNote = strongest.amplitude < limiar ? 'PAUSA' : frequencyToNote(strongest.frequency);

    const notaFilename = `nota_${Date.now()}.txt`;
    const notaPath = path.join(publicDir, notaFilename);
    fs.writeFileSync(notaPath, dominantNote);

    fs.unlinkSync(inputPath);
    fs.unlinkSync(outputWavPath);

    res.json({
      samples: amplitudeData,
      dominantFrequency: parseFloat(strongest.frequency.toFixed(2)),
      dominantNote,
      downloads: {
        amplitude: `/${ampFilename}`,
        nota: `/${notaFilename}`
      }
    });

  } catch (err) {
    console.error('Erro:', err);
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

function frequencyToNote(freq) {
  if (!freq || freq <= 0) return 'PAUSA';

  const A4 = 440;
  const notas = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const semitonesFromA4 = Math.round(12 * Math.log2(freq / A4));
  const noteIndex = (semitonesFromA4 + 9 + 1200) % 12;
  const octave = 4 + Math.floor((semitonesFromA4 + 9) / 12);
  return notas[noteIndex] + octave;
}

app.use(express.static('teste'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor ouvindo na porta ${PORT}`);
});
