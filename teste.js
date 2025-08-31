// ================================
// BACKEND COMPLETO - Node.js + Express
// ================================

// Importação dos módulos
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

// Configuração do multer para salvar arquivos enviados
const upload = multer({ dest: 'uploads/' });

// Definindo __filename e __dirname para ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ================================
// Função: frequencyToNoteCStyle
// Converte uma frequência para nota musical
// ================================
function frequencyToNoteCStyle(freq) {
  if (!freq || freq <= 0 || isNaN(freq)) return 'PAUSA';

  const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  // Número de semitons de distância do A4 (440 Hz)
  const n = 12 * Math.log2(freq / 440);

  // Arredonda para o semitom mais próximo
  const nRound = Math.round(n);

  // Índice da nota (0=C ... 11=B)
  const noteIndex = ((nRound + 9) % 12 + 12) % 12; // +9 porque A=9 no array
  const octave = 4 + Math.floor((nRound + 9) / 12);

  return `${NOTES[noteIndex]}${octave}`;
}

// ================================
// Serve arquivos estáticos
// ================================
app.use(express.static('public'));

// ================================
// Rota POST /upload
// Recebe áudio, processa e retorna nota + frequência + magnitude
// ================================
app.post('/upload', upload.single('audio'), async (req, res) => {
  try {
    const inputPath = req.file.path;
    const outputPath = `${inputPath}.wav`;

    // Converte para WAV, mono, 44.1 kHz usando FFmpeg
    execSync(`ffmpeg -i ${inputPath} -ar 44100 -ac 1 ${outputPath}`);

    // Lê o arquivo WAV
    const buffer = fs.readFileSync(outputPath);
    const headerSize = 44; // cabeçalho WAV
    const sampleRate = 44100;
    const int16Samples = [];

    for (let i = headerSize; i < buffer.length; i += 2) {
      const sample = buffer.readInt16LE(i);
      int16Samples.push(sample);
    }

    // ================================
    // DFT manual para detectar frequência dominante
    // ================================
    const windowSize = sampleRate; // 1 segundo
    const N = Math.min(windowSize, int16Samples.length);
    const freqStep = 2;
    const minFreq = 16;
    const maxFreq = 1048;

    let maxMag = 0;
    let peakFreq = 0;
    let peakIndex = -1;

    for (let freq = minFreq, i = 0; freq <= maxFreq; freq += freqStep, i++) {
      let real = 0;
      let imag = 0;

      for (let n = 0; n < N; n++) {
        const angle = (2 * Math.PI * freq * n) / sampleRate;
        real += int16Samples[n] * Math.cos(angle);
        imag -= int16Samples[n] * Math.sin(angle);
      }

      const magnitude = Math.sqrt(real * real + imag * imag);

      if (magnitude > maxMag) {
        maxMag = magnitude;
        peakFreq = freq;
        peakIndex = i;
      }
    }

    // ================================
    // Determina nota ou PAUSA
    // ================================
    const threshold = 2e-3; // limite mínimo de magnitude
    let note;
    if (!peakFreq || isNaN(peakFreq) || maxMag < threshold) {
      note = 'PAUSA';
      peakFreq = 0; // frequência zero quando é pausa
    } else {
      note = frequencyToNoteCStyle(peakFreq);
    }

    // Salva nota.txt
    fs.writeFileSync('nota.txt', note);

    // ================================
    // LOGS
    // ================================
    console.log('============================');
    console.log(`maxMag: ${maxMag.toFixed(2)}`);
    console.log(`peakIndex: ${peakIndex}`);
    console.log(`dominantFrequency: ${peakFreq.toFixed(2)} Hz`);
    console.log(`dominantNote: ${note}`);
    console.log('============================');

    // ================================
    // Retorna JSON com frequência, nota e magnitude
    // ================================
    res.json({
      dominantFrequency: peakFreq,
      dominantNote: note,
      magnitude: maxMag // <-- magnitude usada para opacidade no frontend
    });

    // Remove arquivos temporários
    fs.unlinkSync(inputPath);
    fs.unlinkSync(outputPath);
  } catch (err) {
    console.error('Erro:', err);
    res.status(500).json({ error: 'Erro na análise do áudio.' });
  }
});

// ================================
// Inicializa servidor
// ================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
