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

    // Cálculo da amplitude média por bloco (0.1s)
    const amplitudeData = [];
    for (let i = 0; i < samples.length; i += blockSize) {
      const block = samples.slice(i, i + blockSize);
      const avg = block.reduce((acc, v) => acc + Math.abs(v), 0) / block.length;
      amplitudeData.push({ time: (i / sampleRate).toFixed(1), amplitude: avg });
    }

    // Salva arquivo amplitude.txt
    const ampFilename = `amplitude_${Date.now()}.txt`;
    const ampPath = path.join(publicDir, ampFilename);
    const ampContent = amplitudeData.map(d => `${d.time}\t${d.amplitude}`).join('\n');
    fs.writeFileSync(ampPath, ampContent);

    // Agora, FFT em blocos de 1024 samples
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
        return { frequency: (idx * sampleRate) / fftBlockSize, amplitude: Math.sqrt(re * re + im * im) };
      }).slice(0, fftBlockSize / 2);

      const blockMax = fftData.reduce((acc, val) => val.amplitude > acc.amplitude ? val : acc, { amplitude: 0 });
      if (blockMax.amplitude > maxDominantAmplitude) {
        maxDominantAmplitude = blockMax.amplitude;
        dominantFrequency = blockMax.frequency;
      }
    }

    const limiar = 2e-3;
    const dominantNote = maxDominantAmplitude < limiar ? 'PAUSA' : frequencyToNote(dominantFrequency);

    // Salvar nota.txt com a nota detectada
    const notaFilename = `nota_${Date.now()}.txt`;
    const notaPath = path.join(publicDir, notaFilename);
    fs.writeFileSync(notaPath, dominantNote);

    // Remove arquivos temporários
    fs.unlinkSync(inputPath);
    fs.unlinkSync(outputWavPath);

    // Retorna dados para front-end
    res.json({
      samples: amplitudeData,
      dominantFrequency,
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
  const notas = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const n = 12 * Math.log2(freq / 440);
  const notaIndex = Math.round(n + 9);
  const r = ((notaIndex % 12) + 12) % 12;
  const q = Math.floor((notaIndex + 9) / 12);
  return notas[r] + (4 + q);
}

app.use(express.static('teste'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor ouvindo na porta ${PORT}`);
});
