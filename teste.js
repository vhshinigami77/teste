import express from 'express';
import multer from 'multer';
import cors from 'cors';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import fs from 'fs';
import path from 'path';

const app = express();
app.use(cors());
const upload = multer({ dest: 'uploads/' });
ffmpeg.setFfmpegPath(ffmpegStatic);

app.use(express.json());

const publicDir = path.join(process.cwd(), 'teste');
if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir);

// --- Conversão para WAV ---
function convertToWav(input, output) {
  return new Promise((resolve, reject) => {
    ffmpeg(input)
      .toFormat('wav')
      .on('end', resolve)
      .on('error', reject)
      .save(output);
  });
}

// --- Extração de amostras PCM normalizadas de arquivo WAV ---
function extractSamplesFromWav(buffer) {
  const samples = [];
  // WAV header = 44 bytes
  for (let i = 44; i < buffer.length; i += 2) {
    const sample = buffer.readInt16LE(i);
    samples.push(sample / 32768); // Normaliza entre -1 e 1
  }
  return samples;
}

// --- Cálculo da Transformada Discreta de Fourier (simplificado) ---
function calculateDFT(samples, sampleRate) {
  const f1 = 16;      // Frequência mínima (Hz)
  const f2 = 1048;    // Frequência máxima (Hz)
  const df = 2;       // Passo em Hz
  const dt = 1 / sampleRate;

  const totalf = Math.round((f2 - f1) / df) + 1;
  const magnitude = new Array(totalf);

  let maiorMag = 0;
  let freqDominante = 0;

  for (let j = 0; j < totalf; j++) {
    const f = f1 + j * df;
    let real = 0;
    let imag = 0;

    for (let i = 0; i < samples.length; i++) {
      real += samples[i] * Math.cos(2 * Math.PI * f * i * dt);
      imag += -samples[i] * Math.sin(2 * Math.PI * f * i * dt);
    }
    real *= dt;
    imag *= dt;

    magnitude[j] = Math.sqrt(real * real + imag * imag);

    if (magnitude[j] > maiorMag) {
      maiorMag = magnitude[j];
      freqDominante = f;
    }
  }

  return { freqDominante, maiorMag, magnitude, f1, df, totalf };
}

// --- Converter frequência para nota musical ---
function frequencyToNote(freq, amplitude, limiar = 2e-3) {
  if (!freq || freq <= 0 || amplitude < limiar) return 'PAUSA';

  const notas = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

  const n = 12 * Math.log2(freq / 440);
  const rounded = Math.round(n + 9);
  const noteIndex = ((rounded % 12) + 12) % 12; // mod 12
  const octave = 4 + Math.floor((rounded) / 12);

  return notas[noteIndex] + octave;
}

app.post('/upload', upload.single('audio'), async (req, res) => {
  console.log(`🚀 Arquivo recebido: ${req.file.originalname} (${req.file.size} bytes)`);

  const inputPath = req.file.path;
  const outputWavPath = inputPath + '.wav';

  try {
    // Converter para WAV
    await convertToWav(inputPath, outputWavPath);
    console.log('✅ Conversão para WAV concluída.');

    // Ler WAV convertido
    const wavBuffer = fs.readFileSync(outputWavPath);
    const samples = extractSamplesFromWav(wavBuffer);
    const sampleRate = 44100; // fixo, deve ser conferido

    // Calcular amplitude média por blocos de 0.1s
    const blockSize = Math.floor(sampleRate * 0.1);
    const amplitudeData = [];
    for (let i = 0; i < samples.length; i += blockSize) {
      const block = samples.slice(i, i + blockSize);
      const avg = block.reduce((acc, v) => acc + Math.abs(v), 0) / block.length;
      amplitudeData.push({ time: (i / sampleRate).toFixed(1), amplitude: avg });
    }

    // Salvar amplitude em arquivo txt
    const ampFilename = `amplitude_${Date.now()}.txt`;
    const ampPath = path.join(publicDir, ampFilename);
    const ampContent = amplitudeData.map(d => `${d.time}\t${d.amplitude}`).join('\n');
    fs.writeFileSync(ampPath, ampContent);

    // Calcular DFT e obter frequência dominante e magnitude
    const { freqDominante, maiorMag, magnitude, f1, df, totalf } = calculateDFT(samples, sampleRate);

    // Salvar espectro em arquivo txt
    const espectroFilename = `espectro_${Date.now()}.txt`;
    const espectroPath = path.join(publicDir, espectroFilename);
    let espectroContent = '';
    for (let j = 0; j < totalf; j++) {
      espectroContent += `${(f1 + j * df).toFixed(2)}\t${magnitude[j].toExponential(6)}\n`;
    }
    fs.writeFileSync(espectroPath, espectroContent);

    // Salvar resultado (frequência dominante e magnitude)
    const resultadoFilename = `resultado_${Date.now()}.txt`;
    const resultadoPath = path.join(publicDir, resultadoFilename);
    fs.writeFileSync(resultadoPath, `${freqDominante.toExponential(6)} ${maiorMag.toExponential(6)}`);

    // Detectar nota musical
    const dominantNote = frequencyToNote(freqDominante, maiorMag);

    // Salvar nota detectada em arquivo txt
    const notaFilename = `nota_${Date.now()}.txt`;
    const notaPath = path.join(publicDir, notaFilename);
    fs.writeFileSync(notaPath, dominantNote);

    // Limpar arquivos temporários
    fs.unlinkSync(inputPath);
    fs.unlinkSync(outputWavPath);

    // Responder JSON com dados e links para download
    res.json({
      samples: amplitudeData,
      dominantFrequency: freqDominante,
      dominantNote,
      downloads: {
        amplitude: `/${ampFilename}`,
        espectro: `/${espectroFilename}`,
        resultado: `/${resultadoFilename}`,
        nota: `/${notaFilename}`
      }
    });
  } catch (err) {
    console.error('❌ Erro:', err);
    res.status(500).json({ error: 'Erro no processamento do áudio' });
  }
});

// Servir arquivos estáticos da pasta teste
app.use(express.static('teste'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor ouvindo na porta ${PORT}`);
});
