import express from 'express';
import cors from 'cors';
import multer from 'multer';
import ffmpegPath from 'ffmpeg-static';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import wav from 'wav';
import { fft, util as fftUtil } from 'fft-js';

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.static('uploads'));

const upload = multer({ dest: 'uploads/' });

// Função util para potência de 2 >= n
function nextPowerOfTwo(n) {
  return 2 ** Math.ceil(Math.log2(n));
}

// POST /upload
app.post('/upload', upload.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Arquivo não enviado' });

  try {
    const inputPath = req.file.path;
    const wavPath = inputPath + '.converted.wav';

    // Converter para WAV mono 44100 Hz com ffmpeg (child_process)
    await new Promise((resolve, reject) => {
      const ffmpeg = spawn(ffmpegPath, [
        '-i', inputPath,
        '-ac', '1',          // mono
        '-ar', '44100',      // sample rate 44.1kHz
        '-f', 'wav',
        wavPath,
        '-y'
      ]);

      ffmpeg.on('error', reject);
      ffmpeg.stderr.on('data', data => {
        // descomente para debug: console.error('ffmpeg stderr:', data.toString());
      });
      ffmpeg.on('close', code => {
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg saiu com código ${code}`));
      });
    });

    // Ler WAV e extrair samples normalizados
    const samples = [];

    await new Promise((resolve, reject) => {
      const reader = new wav.Reader();

      reader.on('format', fmt => {
        if (fmt.audioFormat !== 1) reject(new Error('Formato WAV não suportado'));
      });

      reader.on('data', chunk => {
        for (let i = 0; i < chunk.length; i += 2) {
          const val = chunk.readInt16LE(i);
          samples.push(val / 32768); // normaliza -1..1
        }
      });

      reader.on('end', resolve);
      reader.on('error', reject);

      fs.createReadStream(wavPath).pipe(reader);
    });

    if (samples.length === 0) return res.status(500).json({ error: 'Nenhum dado no WAV' });

    // Preparar dados para FFT (preencher zeros até potência de 2)
    const fftLength = nextPowerOfTwo(samples.length);
    while (samples.length < fftLength) samples.push(0);

    // Calcular FFT
    const phasors = fft(samples);
    const magnitudes = fftUtil.fftMag(phasors);

    // Debug log (remova no prod)
    console.log('FFT magnitudes (10 primeiros):', magnitudes.slice(0, 10));

    // Frequência por bin
    const sampleRate = 44100;
    const freqStep = sampleRate / magnitudes.length;

    // Preparar dados para TXT e JSON (só metade para evitar espelho)
    const fftData = [];
    for (let i = 0; i < magnitudes.length / 2; i++) {
      fftData.push({
        frequency: (i * freqStep).toFixed(1),
        magnitude: magnitudes[i].toFixed(6),
      });
    }

    // Salvar TXT
    const baseName = path.basename(inputPath);
    const txtFilename = baseName + '_fft.txt';
    const txtPath = path.join('uploads', txtFilename);

    const txtContent = 'Frequency(Hz)\tMagnitude\n' +
      fftData.map(d => `${d.frequency}\t${d.magnitude}`).join('\n');

    fs.writeFileSync(txtPath, txtContent);

    // Responder JSON com URL e dados FFT para plotagem
    res.json({
      downloadUrl: '/' + txtFilename,
      samples: fftData
    });

    // Limpeza: opcional, pode apagar arquivos temporários
    // fs.unlinkSync(inputPath);
    // fs.unlinkSync(wavPath);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
});
