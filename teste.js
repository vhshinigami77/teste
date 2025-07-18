import express from 'express';
import cors from 'cors';
import multer from 'multer';
import ffmpegPath from 'ffmpeg-static';
import { spawn } from 'child_process';
import fs from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import wav from 'wav';
import pkg from 'fft-js';

const { fft, util: fftUtil } = pkg;

const app = express();
const upload = multer({ dest: tmpdir() });
app.use(cors());

function isPowerOfTwo(n) {
  return n > 0 && (n & (n - 1)) === 0;
}

function nextPowerOfTwo(n) {
  return 2 ** Math.ceil(Math.log2(n));
}

function calculateAmplitudeAverages(samples, sampleRate, chunkSize = 0.1) {
  const samplesPerChunk = Math.floor(sampleRate * chunkSize);
  const chunks = [];

  for (let i = 0; i < samples.length; i += samplesPerChunk) {
    const chunk = samples.slice(i, i + samplesPerChunk);
    const avg = chunk.reduce((sum, val) => sum + Math.abs(val), 0) / chunk.length;
    chunks.push({ time: (i / sampleRate).toFixed(2), amplitude: avg.toFixed(5) });
  }

  return chunks;
}

function computeFFT(samples, sampleRate) {
  // Preencher com zeros até a próxima potência de 2
  const validLength = nextPowerOfTwo(samples.length);
  const padded = samples.slice(0);
  while (padded.length < validLength) padded.push(0);

  // Formatar para número complexo: [real, imag]
  const phasors = padded.map(s => [s, 0]);
  const fftResult = fft(phasors);
  const frequencies = fftUtil.fftFreq(fftResult, sampleRate);
  const magnitudes = fftUtil.fftMag(fftResult);

  // Limitar até 5000Hz e agrupar para visualização
  const data = [];
  for (let i = 0; i < frequencies.length; i++) {
    if (frequencies[i] <= 5000) {
      data.push({ frequency: frequencies[i].toFixed(1), amplitude: magnitudes[i].toFixed(5) });
    }
  }

  // Reduzir pontos agrupando a cada X amostras
  const step = 10;
  const reduced = [];
  for (let i = 0; i < data.length; i += step) {
    const group = data.slice(i, i + step);
    const avgFreq = group.reduce((sum, d) => sum + parseFloat(d.frequency), 0) / group.length;
    const avgAmp = group.reduce((sum, d) => sum + parseFloat(d.amplitude), 0) / group.length;
    reduced.push({ frequency: avgFreq.toFixed(1), amplitude: avgAmp.toFixed(5) });
  }

  return reduced;
}

app.post('/upload', upload.single('audio'), async (req, res) => {
  try {
    const webmPath = req.file.path;
    const wavPath = path.join(tmpdir(), `${Date.now()}.wav`);

    // Converter com ffmpeg
    await new Promise((resolve, reject) => {
      const ffmpeg = spawn(ffmpegPath, ['-i', webmPath, '-ar', '44100', '-ac', '1', wavPath]);
      ffmpeg.on('close', code => (code === 0 ? resolve() : reject(new Error('FFmpeg falhou'))));
    });

    // Ler samples do WAV
    const reader = new wav.Reader();
    const samples = [];

    reader.on('format', () => {});
    reader.on('data', chunk => {
      for (let i = 0; i < chunk.length; i += 2) {
        const int16 = chunk.readInt16LE(i);
        samples.push(int16 / 32768);
      }
    });

    reader.on('end', () => {
      fs.unlinkSync(webmPath);
      fs.unlinkSync(wavPath);

      const sampleRate = 44100;
      const amplitudeData = calculateAmplitudeAverages(samples, sampleRate);
      const fftData = computeFFT(samples, sampleRate);

      res.json({
        sampleRate,
        samples: amplitudeData,
        fft: fftData
      });
    });

    fs.createReadStream(wavPath).pipe(reader);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao processar áudio' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
