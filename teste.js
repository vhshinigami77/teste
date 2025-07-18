// Importação de módulos necessários
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const wav = require('wav');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const cors = require('cors');
const fft = require('fft-js').fft;
const fftUtil = require('fft-js').util;

const app = express();
const uploadsDir = path.join(__dirname, 'uploads');

// Cria a pasta "uploads" se não existir
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

// Configuração do Multer para salvar os arquivos enviados
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}${path.extname(file.originalname)}`)
});

const upload = multer({ storage });
app.use(cors());
app.use('/uploads', express.static(uploadsDir)); // Servir arquivos estáticos
app.use(express.json());

// Rota principal de upload de áudio
app.post('/upload', upload.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).send('Nenhum arquivo enviado.');

  const inputPath = req.file.path;
  const wavPath = `${inputPath}.converted.wav`;
  const txtPath = `${inputPath}_audio_data.txt`;
  const fftPath = `${inputPath}_fft.txt`;

  try {
    // 1. Converte para WAV com 44.1kHz mono
    await convertToWav(inputPath, wavPath);

    // 2. Processa o áudio e retorna os dados de amplitude por tempo
    const timeData = await processAudio(wavPath);

    // 3. Calcula a FFT dos dados
    const spectrum = calculateFFT(timeData, 44100);

    // 4. Salva os dados de amplitude por tempo em txt
    const lines = timeData.map(({ time, amplitude }) => `${time}\t${amplitude}`);
    fs.writeFileSync(txtPath, lines.join('\n'));

    // 5. Salva o espectro da FFT em outro txt
    const fftLines = spectrum.map(p => `${p.freq.toFixed(2)}\t${p.magnitude.toFixed(4)}`);
    fs.writeFileSync(fftPath, fftLines.join('\n'));

    // 6. Envia resposta com links para download e dados para gráfico
    res.json({
      downloadUrl: `/uploads/${path.basename(txtPath)}`,
      fftDownloadUrl: `/uploads/${path.basename(fftPath)}`,
      samples: timeData,
      spectrum: spectrum
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Erro ao processar áudio.');
  }
});

// Função que usa ffmpeg para converter o arquivo original para WAV 44.1kHz mono
function convertToWav(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(ffmpegPath, [
      '-y',
      '-i', inputPath,
      '-ar', '44100',
      '-ac', '1',
      '-f', 'wav',
      outputPath
    ]);

    ffmpeg.stderr.on('data', (data) => console.error(`FFmpeg: ${data}`));
    ffmpeg.on('close', (code) => {
      if (code === 0) resolve(outputPath);
      else reject(new Error(`FFmpeg falhou com código ${code}`));
    });
  });
}

// Função que calcula a média de amplitude em blocos de 0.1s
function processAudio(wavPath) {
  return new Promise((resolve, reject) => {
    const fileStream = fs.createReadStream(wavPath);
    const reader = new wav.Reader();

    let sampleRate = 44100;
    const blockDuration = 0.1;
    let blockSize = 4410;
    let currentBlock = [];
    let sampleIndex = 0;
    let averages = [];

    reader.on('format', (format) => {
      sampleRate = format.sampleRate;
      blockSize = Math.floor(sampleRate * blockDuration);
    });

    reader.on('data', (chunk) => {
      for (let i = 0; i < chunk.length; i += 2) {
        const sample = chunk.readInt16LE(i);
        const amplitude = Math.abs(sample / 32768);
        currentBlock.push(amplitude);
        sampleIndex++;

        if (currentBlock.length >= blockSize) {
          const avg = currentBlock.reduce((a, b) => a + b, 0) / currentBlock.length;
          const time = (sampleIndex / sampleRate).toFixed(2);
          averages.push({ time, amplitude: avg.toFixed(4) });
          currentBlock = [];
        }
      }
    });

    reader.on('end', () => {
      if (currentBlock.length > 0) {
        const avg = currentBlock.reduce((a, b) => a + b, 0) / currentBlock.length;
        const time = (sampleIndex / sampleRate).toFixed(2);
        averages.push({ time, amplitude: avg.toFixed(4) });
      }
      resolve(averages);
    });

    reader.on('error', reject);
    fileStream.pipe(reader);
  });
}

// Função que calcula a FFT usando a biblioteca fft-js
function calculateFFT(samples, sampleRate) {
  const amplitudes = samples.map(s => parseFloat(s.amplitude));
  const phasors = fft(amplitudes);
  const frequencies = fftUtil.fftFreq(phasors, sampleRate);
  const magnitudes = fftUtil.fftMag(phasors);

  const half = Math.floor(frequencies.length / 2); // Só usamos parte positiva
  const spectrum = [];

  for (let i = 0; i < half; i++) {
    spectrum.push({
      freq: frequencies[i],
      magnitude: magnitudes[i]
    });
  }

  return spectrum;
}

// Inicia o servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
