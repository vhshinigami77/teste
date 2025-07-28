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
  console.log(`🚀 Arquivo recebido: ${req.file.originalname} (${req.file.size} bytes)`);

  const inputPath = req.file.path;
  const outputWavPath = inputPath + '.wav';

  try {
    console.log('⚙️ Convertendo para WAV...');
    await convertToWav(inputPath, outputWavPath);
    console.log('✅ Conversão concluída.');

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

    // FFT
    const fftBlockSize = 1024;
    const fftBlocks = Math.floor(samples.length / fftBlockSize);
    let maxDominantAmplitude = 0;
    let dominantFrequency = 0;

    for (let i = 0; i < fftBlocks; i++) {
      const blockSamples = samples.slice(i * fftBlockSize, (i + 1) * fftBlockSize);
      const phasors = fft(blockSamples);

      const fftData = phasors.map((c, idx) => {
        const re = c[0];
        const im = c[1];
        const freq = (idx * sampleRate) / fftBlockSize;
        return { frequency: freq, amplitude: Math.sqrt(re * re + im * im) };
      }).slice(0, fftBlockSize / 2).filter(d => d.frequency >= 60 && d.frequency <= 1000);

      const blockMax = fftData.reduce((acc, val) =>
        val.amplitude > acc.amplitude ? val : acc, { amplitude: 0 });

      if (blockMax.amplitude > maxDominantAmplitude) {
        maxDominantAmplitude = blockMax.amplitude;
        dominantFrequency = blockMax.frequency;
      }
    }

    const lastBlockSamples = samples.slice((fftBlocks - 1) * fftBlockSize, fftBlocks * fftBlockSize);
    const lastPhasors = fft(lastBlockSamples);

    const fullFftData = lastPhasors.map((c, idx) => {
      const re = c[0];
      const im = c[1];
      const freq = (idx * sampleRate) / fftBlockSize;
      return { frequency: freq, amplitude: Math.sqrt(re * re + im * im) };
    }).slice(0, fftBlockSize / 2).filter(d => d.frequency >= 60 && d.frequency <= 1000);

    // Função melhorada para encontrar a fundamental
    function findFundamental(freq, fftData) {
      for (let div = 2; div <= 5; div++) {
        const candidateFreq = freq / div;
        if (candidateFreq < 60) break;

        const found = fftData.find(d =>
          Math.abs(d.frequency - candidateFreq) < 10 &&
          d.amplitude > maxDominantAmplitude * 0.1);

        if (found) return candidateFreq;
      }
      return freq;
    }

    const fundamentalFrequency = findFundamental(dominantFrequency, fullFftData);

    const limiar = 2e-3;
    const dominantNote = maxDominantAmplitude < limiar ? 'PAUSA' : frequencyToNote(fundamentalFrequency);

    const notaFilename = `nota_${Date.now()}.txt`;
    const notaPath = path.join(publicDir, notaFilename);
    fs.writeFileSync(notaPath, dominantNote);

    fs.unlinkSync(inputPath);
    fs.unlinkSync(outputWavPath);

    res.json({
      samples: amplitudeData,
      dominantFrequency: fundamentalFrequency,
      dominantNote,
      downloads: {
        amplitude: `/${ampFilename}`,
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
