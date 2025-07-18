import express from 'express';
import multer from 'multer';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import fs from 'fs/promises'; // usar versão promise do fs
import cors from 'cors';
import { fft } from 'fft-js';

const app = express();
const upload = multer({ dest: 'uploads/' });

ffmpeg.setFfmpegPath(ffmpegStatic);

app.use(cors()); // permite comunicação cross-origin
app.use(express.json());

app.post('/upload', upload.single('audio'), async (req, res) => {
  if (!req.file) {
    console.error('❌ Nenhum arquivo recebido');
    return res.status(400).json({ error: 'Nenhum arquivo enviado' });
  }

  console.log(`🚀 Arquivo recebido: ${req.file.originalname} (${req.file.size} bytes)`);

  const inputPath = req.file.path;
  const outputWavPath = `${inputPath}.wav`;

  try {
    console.log('⚙️ Convertendo para WAV...');
    await new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .toFormat('wav')
        .on('start', (cmd) => console.log('FFmpeg comando:', cmd))
        .on('stderr', (line) => console.log('FFmpeg:', line))
        .on('error', (err) => {
          console.error('❌ Erro no FFmpeg:', err);
          reject(err);
        })
        .on('end', () => {
          console.log('✅ Conversão concluída.');
          resolve();
        })
        .save(outputWavPath);
    });

    // Ler WAV convertido
    const wavBuffer = await fs.readFile(outputWavPath);
    const samples = extractSamplesFromWav(wavBuffer);

    const sampleRate = 44100;
    const blockSize = Math.floor(sampleRate * 0.1);
    const amplitudeData = [];
    for (let i = 0; i < samples.length; i += blockSize) {
      const block = samples.slice(i, i + blockSize);
      const avg = block.reduce((acc, v) => acc + Math.abs(v), 0) / block.length;
      amplitudeData.push({ time: (i / sampleRate).toFixed(1), amplitude: avg });
    }

    // FFT com janela 1024 samples
    const fftInput = samples.slice(0, 1024);
    const phasors = fft(fftInput);
    const fftData = phasors
      .map((c, i) => {
        const re = c[0];
        const im = c[1];
        const mag = Math.sqrt(re * re + im * im);
        return { frequency: (i * sampleRate) / fftInput.length, amplitude: mag };
      })
      .slice(0, fftInput.length / 2);

    // Limpar arquivos assíncrono, evitar bloquear resposta
    fs.unlink(inputPath).catch(console.warn);
    fs.unlink(outputWavPath).catch(console.warn);

    // Responder dados
    return res.json({
      samples: amplitudeData,
      fft: fftData,
    });
  } catch (error) {
    console.error('❌ Erro no processamento:', error);
    try {
      await fs.unlink(inputPath);
      await fs.unlink(outputWavPath);
    } catch (_) {}
    return res.status(500).json({ error: 'Erro no processamento do áudio' });
  }
});

function extractSamplesFromWav(buffer) {
  // Cabeçalho padrão WAV: 44 bytes
  // PCM 16 bits mono assumido
  const samples = [];
  for (let i = 44; i < buffer.length; i += 2) {
    const sample = buffer.readInt16LE(i);
    samples.push(sample / 32768);
  }
  return samples;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor ouvindo na porta ${PORT}`);
});
