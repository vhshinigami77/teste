// Importação de pacotes
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const ffmpegPath = require('ffmpeg-static');
const { spawn } = require('child_process');
const wav = require('wav');
const { fft, util: fftUtil } = require('fft-js');
const { Parser } = require('json2csv');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Configuração do multer para upload de arquivos
const storage = multer.diskStorage({
  destination: 'uploads/',
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now();
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

// Função para converter para WAV mono 44100Hz
function convertToWav(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(ffmpegPath, [
      '-i', inputPath,
      '-ac', '1',
      '-ar', '44100',
      outputPath
    ]);

    ffmpeg.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}`));
    });
  });
}

// Função para extrair amostras WAV
function extractSamples(wavPath) {
  return new Promise((resolve, reject) => {
    const samples = [];
    const fileStream = fs.createReadStream(wavPath);
    const reader = new wav.Reader();

    reader.on('format', format => {
      const chunkSize = Math.floor(format.sampleRate * 0.1);
      let chunk = [];
      reader.on('data', data => {
        for (let i = 0; i < data.length; i += 2) {
          const sample = data.readInt16LE(i) / 32768;
          chunk.push(sample);
          if (chunk.length === chunkSize) {
            const avg = chunk.reduce((sum, s) => sum + Math.abs(s), 0) / chunk.length;
            samples.push({ amplitude: avg.toFixed(4), time: (samples.length * 0.1).toFixed(2) });
            chunk = [];
          }
        }
      });

      reader.on('end', () => resolve(samples));
    });

    reader.on('error', reject);
    fileStream.pipe(reader);
  });
}

// Função para calcular FFT
function calculateFFT(wavPath, outputTxtPath) {
  return new Promise((resolve, reject) => {
    const reader = new wav.Reader();
    const fileStream = fs.createReadStream(wavPath);
    const signal = [];

    reader.on('format', format => {
      reader.on('data', data => {
        for (let i = 0; i < data.length; i += 2) {
          const sample = data.readInt16LE(i) / 32768;
          signal.push(sample);
        }
      });

      reader.on('end', () => {
        const phasors = fft(signal);
        const frequencies = fftUtil.fftFreq(phasors, format.sampleRate);
        const magnitudes = fftUtil.fftMag(phasors);

        const result = frequencies.map((freq, i) => ({
          frequency: freq.toFixed(1),
          amplitude: magnitudes[i].toFixed(4)
        }));

        const txt = result.map(r => `${r.frequency}\t${r.amplitude}`).join('\n');
        fs.writeFileSync(outputTxtPath, txt);
        resolve(result);
      });
    });

    reader.on('error', reject);
    fileStream.pipe(reader);
  });
}

app.post('/upload', upload.single('audio'), async (req, res) => {
  try {
    const inputPath = req.file.path;
    const wavPath = inputPath + '.converted.wav';
    const fftTxtPath = inputPath + '.fft.txt';

    await convertToWav(inputPath, wavPath);
    const samples = await extractSamples(wavPath);
    const fftData = await calculateFFT(wavPath, fftTxtPath);

    res.json({
      downloadUrl: `/uploads/${path.basename(fftTxtPath)}`,
      samples,
      fft: fftData
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro no processamento do áudio' });
  }
});

app.listen(port, () => {
  console.log(`Servidor rodando em http://localhost:${port}`);
});
