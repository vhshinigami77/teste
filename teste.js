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

// App Express
const app = express();
app.use(cors()); // permitir chamadas do front-end

// Upload temporário em "uploads/"
const upload = multer({ dest: 'uploads/' });

// Suporte a __dirname/__filename em ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ========================
// Conversão frequência → nota
// ========================
function frequencyToNoteCStyle(freq) {
  if (!freq || freq <= 0 || isNaN(freq)) return 'PAUSA';

  const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const n = 12 * Math.log2(freq / 440);   // semitons relativos a A4=440Hz
  const q = Math.floor(Math.round(n + 9) / 12);
  const r = Math.round(n + 9) % 12;
  return `${NOTES[r]}${4 + q}`;
}

// ========================
// Rota: POST /upload
// - Recebe webm/opus do browser
// - Converte para WAV 44.1kHz mono
// - Executa DFT manual 16..1048 Hz (passo 2Hz)
// - Retorna nota, frequência dominante e magnitude absoluta da dominante
// ========================
app.post('/upload', upload.single('audio'), async (req, res) => {
  try {
    const inputPath = req.file.path;        // arquivo enviado (webm)
    const outputPath = `${inputPath}.wav`;  // arquivo convertido

    // Converte via ffmpeg (certifique-se que ffmpeg está instalado no ambiente)
    execSync(`ffmpeg -i ${inputPath} -ar 44100 -ac 1 ${outputPath}`);

    // Lê WAV como bytes e extrai amostras int16
    const buffer = fs.readFileSync(outputPath);
    const headerSize = 44;
    const sampleRate = 44100;
    const int16Samples = [];
    for (let i = headerSize; i < buffer.length; i += 2) {
      int16Samples.push(buffer.readInt16LE(i));
    }

    // --------- DFT manual ----------
    const windowSize = sampleRate;                 // 1s de janela
    const N = Math.min(windowSize, int16Samples.length);
    const freqStep = 2;
    const minFreq = 16;
    const maxFreq = 1048;

    let maxMag = 0;
    let peakFreq = 0;
    let peakIndex = -1;

    for (let i = 0, f = minFreq; f <= maxFreq; f += freqStep, i++) {
      let real = 0, imag = 0;
      for (let n = 0; n < N; n++) {
        const angle = (2 * Math.PI * f * n) / sampleRate;
        real += int16Samples[n] * Math.cos(angle);
        imag -= int16Samples[n] * Math.sin(angle);
      }
      const mag = Math.hypot(real, imag); // magnitude

      if (mag > maxMag) {
        maxMag = mag;
        peakFreq = f;
        peakIndex = i;
      }
    }

    // --------- Nota ou pausa ----------
    const limiar = 2e-3; // limiar bem baixo; como estamos no inteiro 16-bit, normalmente maxMag >> limiar
    let note;
    if (!peakFreq || isNaN(peakFreq) || maxMag < limiar) {
      note = 'PAUSA';
      peakFreq = 0;
    } else {
      note = frequencyToNoteCStyle(peakFreq);
    }

    // (Opcional) salva a nota num arquivo texto
    fs.writeFileSync('nota.txt', note);

    // Logs
    console.log('============================');
    console.log(`maxMag: ${maxMag.toFixed(2)}`);
    console.log(`peakIndex: ${peakIndex}`);
    console.log(`dominantFrequency: ${peakFreq.toFixed(2)} Hz`);
    console.log(`dominantNote: ${note}`);
    console.log('============================');

    // Retorna APENAS a magnitude absoluta (sem normalizar),
    // para o front-end ajustar a opacidade de forma adaptativa por sessão.
    res.json({
      dominantFrequency: peakFreq,
      dominantNote: note,
      magnitude: maxMag
    });

    // Limpeza de temporários
    fs.unlinkSync(inputPath);
    fs.unlinkSync(outputPath);
  } catch (err) {
    console.error('Erro:', err);
    res.status(500).json({ error: 'Erro na análise do áudio.' });
  }
});

// ========================
// Inicialização do servidor
// ========================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
