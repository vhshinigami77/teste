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
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir);
}

app.post('/upload', upload.single('audio'), async (req, res) => {
  console.log(`🚀 Arquivo recebido: ${req.file.originalname} (${req.file.size} bytes)`);

  const inputPath = req.file.path;
  const outputWavPath = inputPath + '.wav';

  try {
    await convertToWav(inputPath, outputWavPath);
    console.log('✅ Conversão para WAV concluída.');

    const wavBuffer = fs.readFileSync(outputWavPath);
    const samples = extractSamplesFromWav(wavBuffer);
    const sampleRate = 44100;

    // Usando FFT manual estilo seu projeto C++
    const dominantFreq = getDominantFrequency(samples, sampleRate);

    // Calcula amplitude média para aplicar limiar
    const amplitude = averageAmplitude(samples);
    const limiar = 2e-3;

    let dominantNote = 'PAUSA';
    if (amplitude >= limiar && dominantFreq > 0) {
      dominantNote = frequencyToNote(dominantFreq);
    }

    // Gerar arquivo txt com a nota
    const notaFilename = `nota_${Date.now()}.txt`;
    const notaPath = path.join(publicDir, notaFilename);
    fs.writeFileSync(notaPath, dominantNote);

    // Limpar arquivos temporários
    fs.unlinkSync(inputPath);
    fs.unlinkSync(outputWavPath);

    res.json({
      dominantFrequency: dominantFreq,
      dominantNote,
      downloads: {
        nota: `/${notaFilename}`
      }
    });

  } catch (err) {
    console.error('❌ Erro:', err);
    res.status(500).json({ error: 'Erro no processamento do áudio' });
  }
});

function convertToWav(input, output) {
  return new Promise((resolve, reject) => {
    ffmpeg(input)
      .toFormat('wav')
      .on('end', resolve)
      .on('error', reject)
      .save(output);
  });
}

function extractSamplesFromWav(buffer) {
  const samples = [];
  // Pula cabeçalho WAV padrão de 44 bytes
  for (let i = 44; i < buffer.length; i += 2) {
    const sample = buffer.readInt16LE(i);
    samples.push(sample / 32768);
  }
  return samples;
}

function averageAmplitude(samples) {
  let sum = 0;
  for (const s of samples) {
    sum += Math.abs(s);
  }
  return sum / samples.length;
}

// Função ajustada para replicar seu FFT manual do C++
function getDominantFrequency(samples, sampleRate) {
  const f1 = 16;
  const f2 = 1048;
  const df = 2;

  const N = samples.length;
  const dt = 1 / sampleRate;
  let maiorMag = 0;
  let freqDominante = 0;

  for (let f = f1; f <= f2; f += df) {
    let real = 0;
    let imag = 0;

    for (let i = 0; i < N; i++) {
      const t = i * dt;
      real += samples[i] * Math.cos(2 * Math.PI * f * t);
      imag += -samples[i] * Math.sin(2 * Math.PI * f * t);
    }

    const mag = Math.sqrt(real * real + imag * imag);

    if (mag > maiorMag) {
      maiorMag = mag;
      freqDominante = f;
    }
  }

  return freqDominante;
}

// Conversão frequência -> nota musical igual ao seu código C++
function frequencyToNote(freq) {
  if (!freq || freq <= 0) return 'PAUSA';

  const notas = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const A4 = 440;

  const n = 12 * Math.log(freq / A4) / Math.log(2);
  const rounded = Math.round(n + 9);
  const octave = 4 + Math.floor(rounded / 12);
  const noteIndex = ((rounded % 12) + 12) % 12;

  return notas[noteIndex] + octave;
}

app.use(express.static('teste'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor ouvindo na porta ${PORT}`);
});
