const express = require('express');
const cors = require('cors');
const multer = require('multer');
const ffmpegPath = require('ffmpeg-static');
const ffmpeg = require('fluent-ffmpeg');
const wav = require('wav');
const fs = require('fs');
const { parse } = require('json2csv');
const fft = require('fft-js').fft;
const fftUtil = require('fft-js').util;

ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(cors());

app.post('/upload', upload.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Arquivo não enviado' });

  try {
    // Converter para WAV 44.1kHz
    const wavFilePath = req.file.path + '.wav';

    await new Promise((resolve, reject) => {
      ffmpeg(req.file.path)
        .outputOptions([
          '-ar 44100', // taxa de amostragem
          '-ac 1',     // mono
          '-f wav'
        ])
        .save(wavFilePath)
        .on('end', resolve)
        .on('error', reject);
    });

    // Ler WAV e extrair amostras
    const fileStream = fs.createReadStream(wavFilePath);
    const reader = new wav.Reader();

    const samples = [];
    let sampleRate;
    reader.on('format', (format) => {
      sampleRate = format.sampleRate;
    });

    reader.on('data', (chunk) => {
      for (let i = 0; i < chunk.length; i += 2) {
        // PCM 16-bit little endian
        const val = chunk.readInt16LE(i);
        samples.push(val / 32768); // normalizar -1 a 1
      }
    });

    await new Promise((resolve) => reader.on('end', resolve));
    fileStream.pipe(reader);

    // Criar blocos de 0.1s para amplitude média
    const blockSize = Math.floor(sampleRate * 0.1);
    const amplitudeData = [];

    for (let i = 0; i < samples.length; i += blockSize) {
      const block = samples.slice(i, i + blockSize);
      const avg = block.reduce((acc, v) => acc + Math.abs(v), 0) / block.length;
      amplitudeData.push({ time: (i / sampleRate).toFixed(2), amplitude: avg });
    }

    // FFT - para tamanho legível, pegar apenas os primeiros N amostras (potência de 2)
    const fftSize = 1024;
    const fftInput = samples.slice(0, fftSize);
    while (fftInput.length < fftSize) fftInput.push(0);

    const phasors = fft(fftInput);
    const frequencies = fftUtil.fftFreq(phasors, sampleRate);
    const magnitudes = fftUtil.fftMag(phasors);

    const fftData = frequencies.slice(0, fftSize / 2).map((freq, i) => ({
      frequency: freq.toFixed(1),
      amplitude: magnitudes[i].toFixed(3)
    }));

    // Responder com dados para front
    res.json({
      sampleRate,
      samples: amplitudeData,
      fft: fftData
    });

    // Limpar arquivos temporários
    fs.unlinkSync(req.file.path);
    fs.unlinkSync(wavFilePath);

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro no processamento' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
