const express = require('express');
const cors = require('cors');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const fs = require('fs');
const path = require('path');
const wav = require('wav');
const { fft, util: fftUtil } = require('fft-js');

const app = express();
app.use(cors());
const upload = multer({ dest: 'uploads/' });

ffmpeg.setFfmpegPath(ffmpegStatic);

// Função para próxima potência de 2
function nextPowerOfTwo(n) {
  return 2 ** Math.ceil(Math.log2(n));
}

// Endpoint upload e processamento
app.post('/upload', upload.single('audio'), async (req, res) => {
  try {
    const inputPath = req.file.path;
    const outputWavPath = inputPath + '.wav';

    // Converter webm/ogg para wav mono 44100 Hz
    await new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .audioChannels(1)
        .audioFrequency(44100)
        .format('wav')
        .on('end', resolve)
        .on('error', reject)
        .save(outputWavPath);
    });

    // Ler dados wav
    const fileReader = fs.createReadStream(outputWavPath);
    const reader = new wav.Reader();

    let samples = [];
    reader.on('format', function (format) {
      if (format.sampleRate !== 44100) {
        return res.status(400).json({ error: 'Taxa de amostragem inesperada' });
      }
    });

    reader.on('data', function (data) {
      // dados PCM 16-bit signed little endian
      for (let i = 0; i < data.length; i += 2) {
        const val = data.readInt16LE(i);
        samples.push(val / 32768); // normaliza entre -1 e 1
      }
    });

    reader.on('end', () => {
      // Processar em chunks de 0.1s (4410 amostras)
      const chunkSize = 4410;

      // Calcular médias de amplitude para gráfico tempo
      let amplitudeSamples = [];
      for (let i = 0; i < samples.length; i += chunkSize) {
        const chunk = samples.slice(i, i + chunkSize);
        const avgAmp = chunk.reduce((acc, val) => acc + Math.abs(val), 0) / chunk.length;
        amplitudeSamples.push({
          time: (i / 44100).toFixed(2),
          amplitude: avgAmp.toFixed(3),
        });
      }

      // Preparar dados para FFT: pegar primeiro chunk
      let fftInput = samples.slice(0, chunkSize);
      if (fftInput.length === 0) {
        return res.status(400).json({ error: 'Áudio muito curto para FFT' });
      }

      // Ajustar tamanho para potência de 2
      const targetLength = nextPowerOfTwo(fftInput.length);
      while (fftInput.length < targetLength) {
        fftInput.push(0);
      }

      // Calcular FFT
      const phasors = fft(fftInput);
      const magnitudes = fftUtil.fftMag(phasors);

      // Preparar dados para gráfico FFT
      const freqResolution = 44100 / magnitudes.length; // Hz por bin
      let fftSamples = [];
      for (let i = 0; i < magnitudes.length / 2; i++) {
        fftSamples.push({
          frequency: (i * freqResolution).toFixed(1),
          magnitude: magnitudes[i].toFixed(5),
        });
      }

      // Gerar arquivo txt com FFT (freq, magnitude)
      const txtLines = fftSamples.map(s => `${s.frequency}\t${s.magnitude}`);
      const txtPath = path.join('uploads', `${path.basename(inputPath)}_fft.txt`);
      fs.writeFileSync(txtPath, 'Frequency(Hz)\tMagnitude\n' + txtLines.join('\n'));

      // Limpar arquivos temporários
      fs.unlinkSync(inputPath);
      fs.unlinkSync(outputWavPath);

      // Enviar resposta JSON com dados para frontend
      res.json({
        samples: amplitudeSamples,
        fftSamples,
        downloadUrl: '/' + txtPath.replace(/\\/g, '/'),
      });
    });

    fileReader.pipe(reader);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
});

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
