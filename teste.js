const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const { execFile } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const wav = require('wav');
const fft = require('fft-js').fft;
const fftUtil = require('fft-js').util;

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(cors());

app.post('/upload', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Arquivo de áudio não enviado' });
    }

    const inputPath = req.file.path;
    const wavPath = inputPath + '.wav';

    // Converter para WAV mono 44100Hz
    await new Promise((resolve, reject) => {
      execFile(
        ffmpegPath,
        ['-i', inputPath, '-ac', '1', '-ar', '44100', '-f', 'wav', wavPath],
        (error) => {
          if (error) reject(error);
          else resolve();
        }
      );
    });

    // Ler WAV
    const samples = await new Promise((resolve, reject) => {
      const fileStream = fs.createReadStream(wavPath);
      const reader = new wav.Reader();

      let audioData = [];

      reader.on('format', (format) => {
        // Formato lido, não usado direto aqui
      });

      reader.on('data', (chunk) => {
        for (let i = 0; i < chunk.length; i += 2) {
          const sample = chunk.readInt16LE(i);
          audioData.push(sample / 32768);
        }
      });

      reader.on('end', () => resolve(audioData));
      reader.on('error', (err) => reject(err));

      fileStream.pipe(reader);
    });

    // Calcular amplitude média por chunk de 0.1s (4410 amostras)
    const chunkSize = 4410;
    const amplitudeData = [];
    for (let i = 0; i < samples.length; i += chunkSize) {
      const chunk = samples.slice(i, i + chunkSize);
      const meanAmp = chunk.reduce((acc, val) => acc + Math.abs(val), 0) / chunk.length;
      amplitudeData.push({
        time: (i / 44100).toFixed(2),
        amplitude: meanAmp.toFixed(4),
      });
    }

    // FFT do primeiro chunk
    const firstChunk = samples.slice(0, chunkSize);
    const phasors = fft(firstChunk);
    const magnitudes = fftUtil.fftMag(phasors);

    const half = Math.floor(magnitudes.length / 2);
    const fftData = [];
    for (let i = 0; i < half; i++) {
      fftData.push({
        frequency: (i * 44100 / chunkSize).toFixed(2),
        magnitude: magnitudes[i].toFixed(4),
      });
    }

    // Apagar arquivos temporários
    fs.unlinkSync(inputPath);
    fs.unlinkSync(wavPath);

    return res.json({ amplitudeData, fftData });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erro interno do servidor', details: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
