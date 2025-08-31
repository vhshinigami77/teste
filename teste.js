// backend.js
import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import cors from "cors";

const app = express();
app.use(express.json());
app.use(express.static("public"));
app.use(cors());

const upload = multer({ dest: "uploads/" });
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Converte frequência em nota musical
function frequencyToNoteCStyle(freq) {
  if (!freq || freq <= 0 || isNaN(freq)) return "PAUSA";
  const NOTES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
  const n = 12 * Math.log2(freq / 440);
  const q = Math.floor(Math.round(n + 9) / 12);
  const r = Math.round(n + 9) % 12;
  return `${NOTES[r]}${4 + q}`;
}

// Upload e análise de áudio
app.post("/upload", upload.single("audio"), async (req, res) => {
  try {
    if(!req.file) return res.status(400).json({ error: "Nenhum arquivo enviado." });

    const inputPath = req.file.path;
    const outputPath = `${inputPath}.wav`;

    // Converte para WAV mono 44.1 kHz
    execSync(`ffmpeg -i ${inputPath} -ar 44100 -ac 1 ${outputPath}`);

    const buffer = fs.readFileSync(outputPath);
    const headerSize = 44;
    const sampleRate = 44100;
    const int16Samples = [];
    for (let i = headerSize; i < buffer.length; i += 2) {
      int16Samples.push(buffer.readInt16LE(i));
    }

    // DFT manual
    const windowSize = sampleRate;
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

    // ==========================
    // Magnitude em escala logarítmica (dB)
    // ==========================
    const epsilon = 1e-6; // evita log(0)
    const maxPossibleMag = 32768 * N; // valor máximo teórico
    const magDb = 20 * Math.log10(maxMag / maxPossibleMag + epsilon);

    // Define níveis de brilho
    let magnitudeLevel = "low";
    if (magDb > -6) magnitudeLevel = "high";       // muito alto
    else if (magDb > -20) magnitudeLevel = "medium"; // médio
    else magnitudeLevel = "low";                   // baixo

    const note = peakFreq ? frequencyToNoteCStyle(peakFreq) : "PAUSA";

    res.json({
      dominantFrequency: peakFreq,
      dominantNote: note,
      magnitude: magDb,
      level: magnitudeLevel
    });

    fs.unlinkSync(inputPath);
    fs.unlinkSync(outputPath);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro na análise do áudio." });
  }
});

// Inicializa servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
