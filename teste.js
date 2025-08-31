// ========================
// Importação de módulos
// ========================
import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import cors from 'cors';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

// Criação do app Express
const app = express();
app.use(cors()); // Permite chamadas do front-end

// Configura o multer para salvar arquivos temporários em "uploads/"
const upload = multer({ dest: 'uploads/' });

// Ajuste para __dirname e __filename em ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ========================
// Função: converte frequência → nota musical
// ========================
function frequencyToNoteCStyle(freq) {
  if (!freq || freq <= 0 || isNaN(freq)) return 'PAUSA';

  // Notas dentro de uma oitava
  const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  // Calcula índice relativo ao A4 = 440Hz
  const n = 12 * Math.log2(freq / 440);
  const q = Math.floor(Math.round(n + 9) / 12);
  const r = Math.round(n + 9) % 12;

  return `${NOTES[r]}${4 + q}`;
}

// ========================
// Rota principal: upload e análise
// ========================
app.post('/upload', upload.single('audio'), async (req, res) => {
  try {
    const inputPath = req.file.path;       // Arquivo enviado (webm)
    const outputPath = `${inputPath}.wav`; // Arquivo convertido para WAV

    // Conversão para WAV mono 44.1kHz via ffmpeg
    execSync(`ffmpeg -i ${inputPath} -ar 44100 -ac 1 ${outputPath}`);

    // Leitura dos dados binários
    const buffer = fs.readFileSync(outputPath);
    const headerSize = 44;    // Cabeçalho WAV
    const sampleRate = 44100;
    const int16Samples = [];

    // Extrai amostras 16 bits little-endian
    for (let i = headerSize; i < buffer.length; i += 2) {
      const sample = buffer.readInt16LE(i);
      int16Samples.push(sample);
    }

    // ========================
    // DFT manual (janela de 1s)
    // ========================
    const windowSize = sampleRate;                // 1 segundo
    const N = Math.min(windowSize, int16Samples.length);
    const freqStep = 2;                           // passo de 2 Hz
    const minFreq = 16;
    const maxFreq = 1048;

    let maxMag = 0;   // magnitude máxima encontrada
    let peakFreq = 0; // frequência correspondente
    let peakIndex = -1;

    // Varre frequências de interesse
    for (let i = 0, freq = minFreq; freq <= maxFreq; freq += freqStep, i++) {
      let real = 0;
      let imag = 0;

      // Soma DFT
      for (let n = 0; n < N; n++) {
        const angle = (2 * Math.PI * freq * n) / sampleRate;
        real += int16Samples[n] * Math.cos(angle);
        imag -= int16Samples[n] * Math.sin(angle);
      }

      const magnitude = Math.sqrt(real * real + imag * imag);

      // Guarda o pico
      if (magnitude > maxMag) {
        maxMag = magnitude;
        peakFreq = freq;
        peakIndex = i;
      }
    }

    // ========================
    // Detecção de nota ou pausa
    // ========================
    const limiar = 2e-3; // limiar mínimo
    let note;
    if (!peakFreq || isNaN(peakFreq) || maxMag < limiar) {
      note = 'PAUSA';
      peakFreq = 0;
    } else {
      note = frequencyToNoteCStyle(peakFreq);
    }

    // Salva a nota em arquivo texto (opcional)
    fs.writeFileSync('nota.txt', note);

    // Logs de depuração
    console.log('============================');
    console.log(`maxMag: ${maxMag.toFixed(2)}`);
    console.log(`peakIndex: ${peakIndex}`);
    console.log(`dominantFrequency: ${peakFreq.toFixed(2)} Hz`);
    console.log(`dominantNote: ${note}`);
    console.log('============================');

    // Resposta JSON para o front-end
    res.json({
      dominantFrequency: peakFreq,
      dominantNote: note,
      magnitude: maxMag,     // magnitude da nota dominante
      maxMagnitude: maxMag   // usado para normalização adaptativa
    });

    // Limpa arquivos temporários
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
