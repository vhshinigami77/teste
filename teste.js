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

// ✅ Garante que a pasta 'public/' exista
const publicDir = path.join(process.cwd(), 'public');
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

    // ✅ Salvar arquivo de amplitude
    const ampPath = `public/amplitude_${Date.now()}.txt`;
    const ampContent = amplitudeData.map(d => `${d.time}\t${d.amplitude}`).join('\n');
    fs.writeFileSync(ampPath, ampContent);

    // ✅ Calcular e salvar FFT
    const fftInput = samples.slice(0, 1024);
    const phasors = fft(fftInput);
    const fftData = phasors.map((c, i) => {
      const re = c[0];
      const im = c[1];
      const mag = Math.sqrt(re * re + im * im);
      return { frequency: (i * sampleRate) / fftInput.length, amplitude: mag };
    }).slice(0, fftInput.length / 2);

    const fftPath = `public/fft_${Date.now()}.txt`;
    const fftContent = fftData.map(d => `${d.frequency}\t${d.amplitude}`).join('\n');
    fs.writeFileSync(fftPath, fftContent);

    fs.unlinkSync(inputPath);
    fs.unlinkSync(outputWavPath);

    res.json({
      samples: amplitudeData,
      fft: fftData,
      downloads: {
        amplitude: `/${path.basename(ampPath)}`,
        fft: `/${path.basename(fftPath)}`
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

app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor ouvindo na porta ${PORT}`);
});
