// server.js
import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import ffmpeg from "fluent-ffmpeg";
import { fileURLToPath } from "url";

// ==========================
// Configuração inicial
// ==========================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const upload = multer({ dest: "uploads/" });
const PORT = process.env.PORT || 3000;

// ==========================
// Funções auxiliares
// ==========================

// Tabela de notas musicais
const NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/**
 * Converte frequência em nota musical + oitava
 * @param {number} frequency
 * @returns {string} Nota (ex: "C4")
 */
function frequencyToNote(frequency) {
  if (frequency <= 0) return "PAUSA";

  const noteNumber = 12 * (Math.log2(frequency / 440)) + 69;
  const noteIndex = Math.round(noteNumber) % 12;
  const octave = Math.floor(noteNumber / 12) - 1; // 🔥 AJUSTADO: agora C4 = 261 Hz
  return `${NOTES[noteIndex]}${octave}`;
}

/**
 * Aplica DFT simplificada numa janela de 1 segundo
 * Frequências de 16 Hz a 1048 Hz com passo de 2 Hz
 */
function analyzeDFT(samples, sampleRate) {
  const N = samples.length;
  const freqs = [];
  const magnitudes = [];

  for (let f = 16; f <= 1048; f += 2) {
    let real = 0;
    let imag = 0;

    for (let n = 0; n < N; n++) {
      const angle = (-2 * Math.PI * f * n) / sampleRate;
      real += samples[n] * Math.cos(angle);
      imag += samples[n] * Math.sin(angle);
    }

    const mag = Math.sqrt(real * real + imag * imag);
    freqs.push(f);
    magnitudes.push(mag);
  }

  // Acha o pico
  let peakIndex = magnitudes.indexOf(Math.max(...magnitudes));

  // Interpolação parabólica para refinar a frequência
  if (peakIndex > 0 && peakIndex < magnitudes.length - 1) {
    const alpha = magnitudes[peakIndex - 1];
    const beta = magnitudes[peakIndex];
    const gamma = magnitudes[peakIndex + 1];

    const correction = 0.5 * (alpha - gamma) / (alpha - 2 * beta + gamma);
    peakIndex = peakIndex + correction;
  }

  const dominantFrequency = freqs[Math.round(peakIndex)];
  const magnitudeNorm = magnitudes[Math.round(peakIndex)] / Math.max(...magnitudes);

  return { dominantFrequency, magnitude: magnitudeNorm };
}

// ==========================
// Rotas
// ==========================

app.use(express.static("public"));

app.post("/upload", upload.single("audio"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Nenhum arquivo enviado" });
  }

  const inputPath = req.file.path;
  const wavPath = path.join("uploads", `${Date.now()}.wav`);

  // Converte para WAV PCM 44.1kHz
  ffmpeg(inputPath)
    .audioChannels(1)
    .audioFrequency(44100)
    .toFormat("wav")
    .save(wavPath)
    .on("end", () => {
      // Lê o WAV em PCM
      fs.readFile(wavPath, (err, buffer) => {
        if (err) {
          console.error("Erro ao ler WAV:", err);
          return res.status(500).json({ error: "Erro ao processar áudio" });
        }

        // Extrai amostras PCM
        const data = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        const samples = [];
        for (let i = 44; i < buffer.length; i += 2) {
          const sample = data.getInt16(i, true);
          samples.push(sample / 32768.0); // normaliza -1 a 1
        }

        // Análise espectral
        const { dominantFrequency, magnitude } = analyzeDFT(samples, 44100);
        const dominantNote = frequencyToNote(dominantFrequency);

        // Resposta JSON
        res.json({
          dominantFrequency,
          dominantNote,
          magnitude,
        });

        // Limpeza
        fs.unlinkSync(inputPath);
        fs.unlinkSync(wavPath);
      });
    })
    .on("error", (err) => {
      console.error("Erro no FFmpeg:", err);
      res.status(500).json({ error: "Erro ao converter áudio" });
    });
});

// ==========================
// Inicializa servidor
// ==========================
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
