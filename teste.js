import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import cors from 'cors';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const app = express();
app.use(cors()); // <- Aqui habilita o CORS

const upload = multer({ dest: 'uploads/' });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Função para converter frequência em nota musical
function frequencyToNote(freq) {
  if (!freq || freq <= 0 || isNaN(freq)) return 'PAUSA';

  const A4 = 440;
  const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const semitones = Math.round(12 * Math.log2(freq / A4));
  const noteIndex = (semitones + 9 + 12 * 10) % 12;
  const octave = 4 + Math.floor((semitones + 9) / 12);
  return `${NOTES[noteIndex]}${octave}`;
}

app.use(express.static('public'));

app.post('/upload', upload.single('audio'), async (req, res) => {
  try {
    const inputPath = req.file.path;
    const outputPath = `${inputPath}.wav`;

    execSync(`ffmpeg -i ${inputPath} -ar 44100 -ac 1 ${outputPath}`);

    const buffer = fs.readFileSync(outputPath);
    const headerSize = 44;
    const sampleRate = 44100;
    const int16Samples = [];

    for (let i = headerSize; i < buffer.length; i += 2) {
      const sample = buffer.readInt16LE(i);
      int16Samples.push(sample);
    }

    const windowSize = sampleRate;
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

    const frequencyFromIndex = minFreq + peakIndex * freqStep;
    const note = frequencyToNote(peakFreq);

    // === LOGS SOLICITADOS ===
    console.log('============================');
    console.log(`maxMag: ${maxMag.toFixed(2)}`);
    console.log(`peakIndex: ${peakIndex}`);
    console.log(`frequencyFromIndex: ${frequencyFromIndex.toFixed(2)} Hz`);
    console.log(`dominantFrequency: ${peakFreq.toFixed(2)} Hz`);
    console.log(`dominantNote: ${note}`);
    console.log('============================');

    res.json({
      dominantFrequency: peakFreq,
      dominantNote: note
    });

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
