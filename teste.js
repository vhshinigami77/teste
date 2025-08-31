// backend.js
import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import cors from 'cors';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const app = express();
app.use(cors());
const upload = multer({ dest: 'uploads/' });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ========================
// Função: frequencyToNoteCStyle
// ========================
function frequencyToNoteCStyle(freq) {
  if (!freq || freq <= 0 || isNaN(freq)) return 'PAUSA';
  const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const n = 12 * Math.log2(freq / 440);
  const q = Math.floor(Math.round(n + 9) / 12);
  const r = Math.round(n + 9) % 12;
  return `${NOTES[r]}${4 + q}`;
}

app.use(express.static('public'));

app.post('/upload', upload.single('audio'), async (req, res) => {
  try {
    const inputPath = req.file.path;
    const outputPath = `${inputPath}.wav`;

    // Converte para WAV, mono, 44.1 kHz
    execSync(`ffmpeg -i ${inputPath} -ar 44100 -ac 1 ${outputPath}`);

    const buffer = fs.readFileSync(outputPath);
    const headerSize = 44;
    const sampleRate = 44100;
    const int16Samples = [];
    for (let i = headerSize; i < buffer.length; i += 2) {
      int16Samples.push(buffer.readInt16LE(i));
    }

    // ========================
    // DFT manual
    // ========================
    const windowSize = sampleRate; // 1 segundo
    const N = Math.min(windowSize, int16Samples.length);
    const freqStep = 2;
    const minFreq = 16;
    const maxFreq = 1048;

    let maxMag = 0;
    let peakFreq = 0;

    for (let freq = minFreq; freq <= maxFreq; freq += freqStep) {
      let real = 0, imag = 0;
      for (let n = 0; n < N; n++) {
        const angle = (2 * Math.PI * freq * n) / sampleRate;
        real += int16Samples[n] * Math.cos(angle);
        imag -= int16Samples[n] * Math.sin(angle);
      }
      const magnitude = Math.sqrt(real*real + imag*imag);
      if (magnitude > maxMag) {
        maxMag = magnitude;
        peakFreq = freq;
      }
    }

    // ==================
    // Limiar e conversão
    // ==================
    const limiar = 2e-3;
    let note;
    if (!peakFreq || isNaN(peakFreq) || maxMag < limiar) {
      note = 'PAUSA';
      peakFreq = 0;
      maxMag = 0;
    } else {
      note = frequencyToNoteCStyle(peakFreq);
    }

    // ==================
    // Normalização baseada no pico real do áudio
    // ==================
    const peakSample = Math.max(...int16Samples.slice(0, N).map(s => Math.abs(s))) || 1; // evita divisão por 0
    const normalizedMagnitude = maxMag / (peakSample * N);

    // LOG
    console.log('============================');
    console.log(`dominantFrequency: ${peakFreq.toFixed(2)} Hz`);
    console.log(`dominantNote: ${note}`);
    console.log(`normalizedMagnitude: ${normalizedMagnitude.toFixed(2)}`);
    console.log('============================');

    // Envia resposta JSON
    res.json({
      dominantFrequency: peakFreq,
      dominantNote: note,
      magnitude: normalizedMagnitude
    });

    // Remove arquivos temporários
    fs.unlinkSync(inputPath);
    fs.unlinkSync(outputPath);

  } catch (err) {
    console.error('Erro:', err);
    res.status(500).json({ error: 'Erro na análise do áudio.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
