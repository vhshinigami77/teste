import express from 'express';
import multer from 'multer';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import fs from 'fs';
import path from 'path';
import { fft } from 'fft-js';

const app = express();
const upload = multer({ dest: 'uploads/' });

ffmpeg.setFfmpegPath(ffmpegStatic);

app.use(express.json());
app.use('/downloads', express.static('downloads'));

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

    const fftInput = samples.slice(0, 1024);
    const phasors = fft(fftInput);
    const fftData = phasors.map((c, i) => {
      const mag = Math.sqrt(c[0] * c[0] + c[1] * c[1]);
      return { frequency: (i * sampleRate) / fftInput.length, amplitude: mag };
    }).slice(0, fftInput.length / 2);

    // Salvar os arquivos
    const downloadsDir = 'downloads';
    if (!fs.existsSync(downloadsDir)) fs.mkdirSync(downloadsDir);

    const amplitudePath = path.join(downloadsDir, 'amplitude.txt');
    const fftPath = path.join(downloadsDir, 'fft.txt');

    fs.writeFileSync(amplitudePath, amplitudeData.map(e => `${e.time},${e.amplitude}`).join('\n'));
    fs.writeFileSync(fftPath, fftData.map(e => `${e.frequency},${e.amplitude}`).join('\n'));

    // Limpar temporários
    fs.unlinkSync(inputPath);
    fs.unlinkSync(outputWavPath);

    res.json({
      samples: amplitudeData,
      fft: fftData,
      downloads: {
        amplitude: '/downloads/amplitude.txt',
        fft: '/downloads/fft.txt'
      }
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao processar o áudio' });
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🎧 Servidor ouvindo em http://localhost:${PORT}`));
