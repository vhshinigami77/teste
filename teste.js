const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const wav = require('wav');
const { fft, util } = require('fft-js');

ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
app.use(cors());
app.use(express.static('uploads')); // Para servir os arquivos gerados

const upload = multer({ dest: 'uploads/' });

/**
 * Função para calcular FFT e retornar array de {frequency, magnitude}
 * @param {Array} signal - vetor de amostras mono (Float32)
 * @param {Number} sampleRate - taxa de amostragem em Hz
 * @returns {Array} fftData - array {frequency, magnitude}
 */
function calculateFFT(signal, sampleRate) {
  const phasors = fft(signal);
  const magnitudes = phasors.map(c => util.fftMag(c));
  const n = magnitudes.length;
  const freqs = [];

  for (let i = 0; i < n / 2; i++) { // só metade do espectro (frequências positivas)
    freqs.push({
      frequency: (i * sampleRate) / n,
      magnitude: magnitudes[i]
    });
  }
  return freqs;
}

app.post('/upload', upload.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Arquivo não enviado' });

  const inputPath = req.file.path;
  const wavPath = inputPath + '.converted.wav';

  try {
    // Converte webm para wav mono 44100Hz pcm_s16le usando ffmpeg
    await new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .outputOptions([
          '-ac 1', // mono
          '-ar 44100', // 44.1 kHz
          '-f wav'
        ])
        .on('end', resolve)
        .on('error', reject)
        .save(wavPath);
    });

    // Leitura do wav
    const fileStream = fs.createReadStream(wavPath);
    const reader = new wav.Reader();

    let samples = [];
    let sampleRate = 44100;

    reader.on('format', function (format) {
      sampleRate = format.sampleRate;
    });

    reader.on('data', function (data) {
      // Converte buffer para array de amostras PCM 16 bits (signed)
      for (let i = 0; i < data.length; i += 2) {
        // PCM 16 bits little endian
        const sample = data.readInt16LE(i) / 32768; // normaliza para -1 a 1
        samples.push(sample);
      }
    });

    await new Promise((resolve) => reader.on('end', resolve));
    fileStream.pipe(reader);

    // Dividir samples em chunks de 0.1s para amplitude média
    const chunkSize = Math.floor(sampleRate * 0.1);
    const amplitudeSamples = [];
    for (let i = 0; i < samples.length; i += chunkSize) {
      const chunk = samples.slice(i, i + chunkSize);
      const avgAmplitude = chunk.reduce((sum, v) => sum + Math.abs(v), 0) / chunk.length;
      amplitudeSamples.push({
        time: (i / sampleRate).toFixed(2),
        amplitude: avgAmplitude.toFixed(4)
      });
    }

    // Calcular FFT (usando primeiro 4096 samples para resolução decente)
    const fftInput = samples.slice(0, 4096);
    const fftData = calculateFFT(fftInput, sampleRate);

    // Gerar arquivo TXT com dados da FFT
    const fftTxtPath = path.join('uploads', path.basename(inputPath) + '_fft.txt');
    const fftTxtContent = fftData.map(d => `${d.frequency.toFixed(2)}\t${d.magnitude.toFixed(6)}`).join('\n');
    fs.writeFileSync(fftTxtPath, fftTxtContent);

    // Limpar arquivos temporários
    fs.unlinkSync(inputPath);
    fs.unlinkSync(wavPath);

    // Responder JSON com URL para download e dados para gráficos
    res.json({
      downloadUrl: '/' + path.basename(fftTxtPath),
      samples: amplitudeSamples,
      fft: fftData
    });

  } catch (error) {
    console.error('Erro no processamento:', error);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
});

// Iniciar servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
