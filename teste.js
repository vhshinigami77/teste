const express = require('express');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const wav = require('wav');
const { fft, util } = require('fft-js');
const { Parser } = require('json2csv');

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(cors());

// Função para garantir potência de 2 para FFT
function nextPowerOfTwo(n) {
  return 1 << (32 - Math.clz32(n - 1));
}

app.post('/upload', upload.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Arquivo não enviado' });

  try {
    const inputPath = req.file.path;
    const wavPath = inputPath + '.wav';

    // Converter webm para wav mono 44.1kHz usando ffmpeg
    await new Promise((resolve, reject) => {
      execFile(ffmpegPath, [
        '-i', inputPath,
        '-ac', '1',            // mono
        '-ar', '44100',        // 44.1kHz
        '-f', 'wav',
        wavPath
      ], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    // Ler WAV e extrair amostras PCM
    const samples = await new Promise((resolve, reject) => {
      let reader = new wav.Reader();
      let bufferData = [];

      reader.on('format', (format) => {
        if (format.audioFormat !== 1) return reject('Formato WAV inválido (não PCM)');
        if (format.channels !== 1) return reject('WAV deve ser mono');
        if (format.sampleRate !== 44100) return reject('Taxa de amostragem deve ser 44100 Hz');
      });

      reader.on('data', chunk => bufferData.push(chunk));

      reader.on('end', () => {
        const buffer = Buffer.concat(bufferData);
        let samplesArray = [];
        for (let i = 0; i < buffer.length; i += 2) {
          // pcm_s16le: 16-bit signed int little endian
          const val = buffer.readInt16LE(i);
          samplesArray.push(val / 32768); // normaliza entre -1 e 1
        }
        resolve(samplesArray);
      });

      fs.createReadStream(wavPath).pipe(reader);
    });

    // Calcular amplitude média por chunk de 0.1s
    const sampleRate = 44100;
    const chunkSize = sampleRate * 0.1;
    let amplitudeData = [];

    for (let i = 0; i < samples.length; i += chunkSize) {
      const chunk = samples.slice(i, i + chunkSize);
      // valor absoluto médio normalizado
      const meanAmp = chunk.reduce((acc, val) => acc + Math.abs(val), 0) / chunk.length;
      amplitudeData.push({ time: (i / sampleRate), amplitude: meanAmp });
    }

    // Preparar entrada para FFT (potência de 2)
    const fftSize = nextPowerOfTwo(samples.length);
    const fftInput = samples.slice(0, fftSize);

    // FFT - gera array de complexos
    const phasors = fft(fftInput);

    // Calcula magnitude do espectro
    const fftData = [];
    for (let i = 0; i < phasors.length / 2; i++) {
      const freq = i * sampleRate / fftSize;
      const re = phasors[i][0];
      const im = phasors[i][1];
      const amplitude = Math.sqrt(re * re + im * im) / fftSize;
      fftData.push({ freq, amplitude });
    }

    // Gerar CSV amplitude média
    const csv = new Parser({ fields: ['time', 'amplitude'] }).parse(amplitudeData);
    const csvFilename = inputPath + '.amplitude.csv';
    fs.writeFileSync(csvFilename, csv);

    // Gerar TXT FFT
    const txtFilename = inputPath + '.fft.txt';
    const txtContent = fftData.map(f => `${f.freq.toFixed(2)}\t${f.amplitude.toFixed(6)}`).join('\n');
    fs.writeFileSync(txtFilename, txtContent);

    // Limpar arquivos temporários originais (webm e wav)
    fs.unlinkSync(inputPath);
    fs.unlinkSync(wavPath);

    // Enviar resposta JSON com dados e URLs para download
    res.json({
      amplitudeData,
      fftData,
      csvUrl: `/download/${path.basename(csvFilename)}`,
      txtUrl: `/download/${path.basename(txtFilename)}`
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro no processamento do áudio' });
  }
});

// Servir arquivos gerados para download
app.use('/download', express.static(path.join(__dirname, 'uploads')));

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
});
