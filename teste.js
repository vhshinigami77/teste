// =========================
// Importações
// =========================
import express from "express";
import multer from "multer";
import fs from "fs";
import cors from "cors";

// =========================
// Inicialização do servidor
// =========================
const app = express();
app.use(cors({ origin: "*" })); // permite requisições de qualquer origem
const upload = multer({ dest: "uploads/" });

// =========================
// Conversão frequência → nota
// =========================
function frequencyToNote(freq) {
  if (!freq || freq <= 0 || isNaN(freq)) return "PAUSA";
  const NOTES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
  const midi = Math.round(12 * Math.log2(freq / 440) + 69);   // 69 = A4
  const name = NOTES[(midi % 12 + 12) % 12];                  // garante índice válido
  const octave = Math.floor(midi / 12) - 1;                   // MIDI 60 = C4
  return `${name}${octave}`;
}

// =========================
// Correção de oitava
// =========================
function correctForOctaveErrors(peakFreq, spectrum, freqStep, minFreq) {
  let f = peakFreq;
  while (f / 2 >= minFreq) {
    const curIdx  = Math.round((f       - minFreq) / freqStep);
    const halfIdx = Math.round((f / 2   - minFreq) / freqStep);
    const curMag  = spectrum[curIdx]?.magnitude ?? 0;
    const halfMag = spectrum[halfIdx]?.magnitude ?? 0;
    if (halfMag >= 0.6 * curMag) {
      f = f / 2; // desce uma oitava
      continue;
    }
    break;
  }
  return f;
}

// =========================
// Rota /upload
// =========================
app.post("/upload", upload.single("audio"), (req, res) => {
  try {
    const filePath = req.file.path;
    const buffer = fs.readFileSync(filePath);

    // Cabeçalho WAV → taxa de amostragem
    const sampleRate = buffer.readUInt32LE(24);
    const dataOffset = 44;
    const int16Samples = new Int16Array(
      buffer.buffer,
      buffer.byteOffset + dataOffset,
      (buffer.length - dataOffset) / 2
    );

    // =========================
    // Parâmetros da análise
    // =========================
    const windowSize = sampleRate; // 1 segundo
    const minFreq = 16;
    const maxFreq = 1048;
    const freqStep = 1; // Hz

    // Aplica janela Hann
    const N = Math.min(windowSize, int16Samples.length);
    const hann = Array.from({length: N}, (_, n) => 0.5 * (1 - Math.cos(2 * Math.PI * n / (N - 1))));

    let maxMag = 0;
    let peakFreq = 0;
    const spectrum = [];

    // =========================
    // DFT manual
    // =========================
    for (let freq = minFreq; freq <= maxFreq; freq += freqStep) {
      let real = 0;
      let imag = 0;
      for (let n = 0; n < N; n++) {
        const x = int16Samples[n] * hann[n];
        const angle = (2 * Math.PI * freq * n) / sampleRate;
        real += x * Math.cos(angle);
        imag -= x * Math.sin(angle);
      }
      const magnitude = Math.sqrt(real * real + imag * imag);
      spectrum.push({ freq, magnitude });
      if (magnitude > maxMag) {
        maxMag = magnitude;
        peakFreq = freq;
      }
    }

    // =========================
    // Correção de oitava
    // =========================
    peakFreq = correctForOctaveErrors(peakFreq, spectrum, freqStep, minFreq);

    // =========================
    // Nota final
    // =========================
    let dominantNote = "PAUSA";
    if (maxMag > 1e6) { // limiar para detectar som
      dominantNote = frequencyToNote(peakFreq);
    }

    // Remove arquivo temporário
    fs.unlinkSync(filePath);

    // Resposta
    res.json({
      sampleRate,
      dominantFrequency: peakFreq,
      dominantNote
    });

  } catch (err) {
    console.error("Erro na análise:", err);
    res.status(500).json({ error: "Erro na análise do áudio" });
  }
});

// =========================
// Inicialização
// =========================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
