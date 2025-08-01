import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const app = express();
const upload = multer({ dest: 'uploads/' });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Função para converter frequência em nota musical
function frequencyToNote(freq) {
  if (!freq || freq <= 0 || isNaN(freq)) return 'PAUSA';

  const A4 = 440;
  const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const semitones = Math.round(12 * Math.log2(freq / A4));
  const noteIndex = (semitones + 9 + 12 * 10) % 12; // +9 para alinhar com A=0
  const octave = 4 + Math.floor((semitones + 9) / 12);
  return `${NOTES[noteIndex]}${octave}`;
}

app.use(express.static('public'));

app.post('/upload', upload.single('audio'), async (req, res) => {
  try {
    const inputPath = req.file.path;
    const outputPath = `${inputPath}.wav`;

    // Converte o áudio para WAV com 44.1kHz mono
    execSync(`ffmpeg -i ${inputPath} -ar 44100 -ac 1 ${outputPath}`);

    // Lê os dados do arquivo WAV
    const buffer = fs.readFileSync(outputPath);
    const headerSize = 44;
    const sampleRate = 44100;
    const int16Samples = [];

    for (let i = headerSize; i < buffer.length; i += 2) {
      const sample = buffer.readInt16LE(i);
      int16Samples.push(sample);
    }

    // Aplica DFT manual para obter o espectro entre 16 e 1048 Hz (passo 2Hz)
    const windowSize = sampleRate; // 1s de janela
    const N = Math.min(windowSize, int16Samples.length);
    const freqStep = 2;
    const minFreq = 16;
    const maxFreq = 1048;
    const spectrum = [];

    let maxMag = 0;
    let peakFreq = 0;

    for (let freq = minFreq; freq <= maxFreq; freq += freqStep) {
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
      }
    }

    const note = frequencyToNote(peakFreq);

    // Envia resposta ao front-end
    res.json({
      dominantFrequency: peakFreq,
      dominantNote: note
    });

    // Limpeza de arquivos
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
