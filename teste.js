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

function frequencyToNoteCStyle(freq) {
  if (!freq || freq <= 0 || isNaN(freq)) return 'PAUSA';
  const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const n = 12 * Math.log2(freq / 440);
  const q = Math.floor(Math.round(n + 9) / 12);
  const r = Math.round(n + 9) % 12;
  return `${NOTES[(r + 12) % 12]}${4 + q}`;
}

app.use(express.static('public'));

app.post('/upload', upload.single('audio'), async (req, res) => {
  const inputPath = req.file && req.file.path;
  const outputPath = inputPath ? `${inputPath}.wav` : null;

  try {
    if (!inputPath) throw new Error('Arquivo não enviado');

    // converte para WAV mono 44.1kHz (coloque caminhos entre aspas para segurança)
    execSync(`ffmpeg -y -i "${inputPath}" -ar 44100 -ac 1 "${outputPath}"`, { stdio: 'ignore' });

    const buffer = fs.readFileSync(outputPath);
    const headerSize = 44;
    const sampleRate = 44100;
    const int16Samples = [];
    for (let i = headerSize; i < buffer.length; i += 2) {
      int16Samples.push(buffer.readInt16LE(i));
    }

    // ===========================
    // Parâmetros de análise
    // ===========================
    const windowSize = sampleRate; // 1 segundo de janela
    const N = Math.min(windowSize, int16Samples.length);
    if (N < 64) throw new Error('Áudio muito curto para análise');

    // ===========================
    // Pré-processamento: remover DC (média) e aplicar janela Hann
    // ===========================
    let mean = 0;
    for (let i = 0; i < N; i++) mean += int16Samples[i];
    mean /= N;

    // aplicação de janela Hann e cópia para buffer float
    const x = new Float32Array(N);
    for (let n = 0; n < N; n++) {
      const w = 0.5 * (1 - Math.cos((2 * Math.PI * n) / (N - 1))); // Hann
      x[n] = (int16Samples[n] - mean) * w;
    }

    // ===========================
    // RMS da janela (para dB)
    // ===========================
    let sumSq = 0;
    for (let i = 0; i < N; i++) sumSq += x[i] * x[i];
    const rms = Math.sqrt(sumSq / N);
    // OBS: aqui x[] já tem janela aplicada; usamos RMS da janela aplicada.
    // Se silêncio / muito baixo: marcar PAUSA
    const silenceRmsThreshold = 0.01 * 32768 / 32768; // valor relativo; ajustável
    // Note: x[] was centered and windowed; absolute scale close to original/2 etc.
    // We'll use absolute RMS on int16 window (without window) for silence decision too:
    let sumSqRaw = 0;
    for (let i = 0; i < N; i++) sumSqRaw += (int16Samples[i] - mean) ** 2;
    const rmsRaw = Math.sqrt(sumSqRaw / N);

    // ===========================
    // Goertzel function (magnitude)
    // ===========================
    function goertzelMag(samples, freq, sr) {
      const omega = (2 * Math.PI * freq) / sr;
      const coeff = 2 * Math.cos(omega);
      let s0 = 0, s1 = 0, s2 = 0;
      for (let i = 0; i < samples.length; i++) {
        s0 = samples[i] + coeff * s1 - s2;
        s2 = s1;
        s1 = s0;
      }
      const real = s1 - s2 * Math.cos(omega);
      const imag = s2 * Math.sin(omega);
      return Math.sqrt(real * real + imag * imag);
    }

    // ===========================
    // Parâmetros de varredura e HPS
    // ===========================
    const minFreq = 16;
    const maxFreq = 1200; // suficiente para flauta doce
    const step = 1; // 1 Hz (melhor resolução)
    const bins = Math.floor((maxFreq - minFreq) / step) + 1;

    // Calcular magnitudes para cada frequência
    const mags = new Float64Array(bins);
    for (let i = 0; i < bins; i++) {
      const f = minFreq + i * step;
      mags[i] = goertzelMag(x, f, sampleRate) + 1e-12; // evita zero
    }

    // ===========================
    // HPS (Harmonic Product Spectrum) em soma de logs (estável)
    // ===========================
    const maxHarm = 6; // 2..6 normalmente bom para flautas; pode ajustar
    const hpsLog = new Float64Array(bins).fill(0);

    for (let i = 0; i < bins; i++) {
      let acc = 0;
      const f = minFreq + i * step;
      for (let h = 1; h <= maxHarm; h++) {
        const fh = f * h;
        if (fh > maxFreq) break;
        const j = Math.round((fh - minFreq) / step);
        if (j >= 0 && j < bins) acc += Math.log(mags[j]);
      }
      hpsLog[i] = acc;
    }

    // Encontra pico no HPS (estimativa da fundamental)
    let peakIdx = 0;
    for (let i = 1; i < bins; i++) if (hpsLog[i] > hpsLog[peakIdx]) peakIdx = i;
    let peakFreq = minFreq + peakIdx * step;

    // Interpolação parabólica no HPS para refinar pico
    if (peakIdx > 0 && peakIdx < bins - 1) {
      const ym1 = hpsLog[peakIdx - 1];
      const y0 = hpsLog[peakIdx];
      const yp1 = hpsLog[peakIdx + 1];
      const denom = (ym1 - 2 * y0 + yp1);
      if (Math.abs(denom) > 1e-12) {
        const delta = 0.5 * (ym1 - yp1) / denom; // deslocamento em bins
        peakFreq += delta * step;
      }
    }

    // Magnitude simples no pico identificado (usando o array mags)
    const approxPeakIdx = Math.round((peakFreq - minFreq) / step);
    const peakMag = mags[Math.max(0, Math.min(bins - 1, approxPeakIdx))] || 0;

    // ===========================
    // Decisão de silêncio / PAUSA
    // ===========================
    // Usamos rmsRaw (baseado em int16) para considerar silêncio ambiente
    // Ajuste esse limiar conforme o microfone/ruído do ambiente
    const silenceThresholdRaw = 300; // experimente 100..1000 dependendo do equipamento
    let note = 'PAUSA';
    if (rmsRaw < silenceThresholdRaw) {
      // silêncio -> PAUSA
      peakFreq = 0;
    } else {
      // aceitar a freq estimada como nota
      note = frequencyToNoteCStyle(peakFreq);
    }

    // ===========================
    // Cálculo de intensidade em dB e normalização 0..1
    // ===========================
    // Referência: 16-bit max = 32768
    let dB;
    if (rmsRaw <= 0) dB = -100;
    else dB = 20 * Math.log10(rmsRaw / 32768);

    // Mapeia dB para 0..1
    const minDb = -60; // silêncio considerado
    const maxDb = -5;  // volume alto típico
    let intensity = (dB - minDb) / (maxDb - minDb);
    intensity = Math.max(0, Math.min(1, intensity));

    // LOGS
    console.log('============================');
    console.log(`peakFreq (HPS): ${peakFreq.toFixed(2)} Hz`);
    console.log(`peakMag (raw): ${peakMag.toFixed(2)}`);
    console.log(`rmsRaw: ${rmsRaw.toFixed(2)}  dB: ${dB.toFixed(2)}  intensity: ${intensity.toFixed(2)}`);
    console.log(`note: ${note}`);
    console.log('============================');

    // Resposta JSON para o frontend (magnitude => intensity 0..1)
    res.json({
      dominantFrequency: Number(peakFreq.toFixed(2)),
      dominantNote: note,
      magnitude: Number(intensity.toFixed(3)),
      db: Number(dB.toFixed(2))
    });

  } catch (err) {
    console.error('Erro:', err);
    res.status(500).json({ error: 'Erro na análise do áudio.', message: err.message });
  } finally {
    // limpa arquivos temporários com segurança
    try { if (inputPath && fs.existsSync(inputPath)) fs.unlinkSync(inputPath); } catch(e){/*ignore*/}
    try { if (outputPath && fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch(e){/*ignore*/}
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
