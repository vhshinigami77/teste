// Importação dos módulos necessários
import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import cors from 'cors';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

// Criação do app Express
const app = express();
app.use(cors());

// Configura o multer para salvar arquivos enviados na pasta 'uploads'
const upload = multer({ dest: 'uploads/' });

// Define __filename e __dirname para uso com ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ========================
// Função: frequencyToNoteCStyle
// ========================
function frequencyToNoteCStyle(freq) {
  if (!freq || freq <= 0 || isNaN(freq)) return 'PAUSA';

  const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  // Número de semitons relativo a A4
  const n = 12 * Math.log2(freq / 440);
  const q = Math.floor(Math.round(n + 9) / 12);
  const r = Math.round(n + 9) % 12;

  return `${NOTES[r]}${4 + q}`;
}

// Serve arquivos estáticos
app.use(express.static('public'));

// ======================
// Rota: POST /upload
// ======================
app.post('/upload', upload.single('audio'), async (req, res) => {
  try {
    const inputPath = req.file.path;
    const outputPath = `${inputPath}.wav`;

    // Converte o áudio usando FFmpeg para WAV, mono, 44.1 kHz
    execSync(`ffmpeg -i ${inputPath} -ar 44100 -ac 1 ${outputPath}`);

    // Lê os dados binários do arquivo WAV
    const buffer = fs.readFileSync(outputPath);
    const headerSize = 44;
    const sampleRate = 44100;
    const int16Samples = [];

    for (let i = headerSize; i < buffer.length; i += 2) {
      const sample = buffer.readInt16LE(i);
      int16Samples.push(sample);
    }

    // ========================
    // Parâmetros do DFT manual
    // ========================
    const windowSize = sampleRate; // Janela de 1 segundo
    const N = Math.min(windowSize, int16Samples.length);
    const freqStep = 2;
    const minFreq = 16;
    const maxFreq = 1048;

    const spectrum = [];
    let maxMag = 0;
    let peakFreq = 0;
    let peakIndex = -1;

    for (let i = 0, freq = minFreq; freq <= maxFreq; freq += freqStep, i++) {
      let real = 0;
      let imag = 0;

      for (let n = 0; n < N; n++) {
        const angle = (2 * Math.PI * freq * n) / sampleRate;
        real += int16Samples[n] * Math.cos(angle);
        imag -= int16Samples[n] * Math.sin(angle);
      }

      const magnitude = Math.sqrt(real * real + imag * imag);
      spectrum.push({ freq, magnitude });

      if (magnitude > maxMag) {
        maxMag = magnitude;
        peakFreq = freq;
        peakIndex = i;
      }
    }

    // ==================
    // Limiar e conversão para nota
    // ==================
    const limiar = 2e-3;

    let note;
    if (maxMag < limiar) {
      console.log('PAUSA...');
      note = 'PAUSA';
    } else {
      note = frequencyToNoteCStyle(peakFreq);
    }

    // Escreve nota.txt
    fs.writeFileSync('nota.txt', note);

    // LOGS
    console.log('============================');
    console.log(`maxMag: ${maxMag.toFixed(2)}`);
    console.log(`peakIndex: ${peakIndex}`);
    console.log(`dominantFrequency: ${peakFreq.toFixed(2)} Hz`);
    console.log(`dominantNote: ${note}`);
    console.log('============================');

    // Envia resposta JSON
    res.json({
      dominantFrequency: peakFreq,
      dominantNote: note
    });

    // Remove arquivos temporários
    fs.unlinkSync(inputPath);
    fs.unlinkSync(outputPath);
  } catch (err) {
    console.error('Erro:', err);
    res.status(500).json({ error: 'Erro na análise do áudio.' });
  }
});

// ==========================
// Inicializa o servidor
// ==========================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
