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

// Diretório para salvar arquivos txt para download
const publicDir = path.join(process.cwd(), 'teste');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir);
}

app.use(express.static(publicDir));

app.post('/upload', upload.single('audio'), async (req, res) => {
  console.log(`🚀 Arquivo recebido: ${req.file.originalname} (${req.file.size} bytes)`);

  const inputPath = req.file.path;
  const outputWavPath = inputPath + '.wav';

  try {
    // Converte o áudio para WAV (44.1kHz, mono padrão)
    await convertToWav(inputPath, outputWavPath);
    console.log('✅ Conversão para WAV concluída.');

    const wavBuffer = fs.readFileSync(outputWavPath);
    const samples = extractSamplesFromWav(wavBuffer);
    const sampleRate = 44100; // presumido padrão WAV

    // Detecta a frequência dominante pelo FFT caseiro
    const dominantFreq = getDominantFrequency(samples, sampleRate);

    // Calcula amplitude média para filtro de limiar
    const amplitude = averageAmplitude(samples);
    const limiar = 2e-3;

    let dominantNote = 'PAUSA';
    if (amplitude >= limiar && dominantFreq > 0) {
      dominantNote = frequencyToNote(dominantFreq);
    }

    // Gera arquivo .txt com a nota para download
    const notaFilename = `nota_${Date.now()}.txt`;
    const notaPath = path.join(publicDir, notaFilename);
    fs.writeFileSync(notaPath, dominantNote);

    // Remove arquivos temporários
    fs.unlinkSync(inputPath);
    fs.unlinkSync(outputWavPath);

    // Retorna JSON com resultado e link para download da nota
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
      .outputOptions('-ar 44100', '-ac 1') // taxa amostragem 44.1kHz, mono
      .toFormat('wav')
      .on('end', resolve)
      .on('error', reject)
      .save(output);
  });
}

// Extrai samples do WAV ignorando cabeçalho padrão de 44 bytes
function extractSamplesFromWav(buffer) {
  const samples = [];
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

// FFT Cooley-Tukey recursiva (real input)
// Retorna array de {re, im} complexos
function fftReal(buffer) {
  const N = buffer.length;

  // Zero padding para potência de 2
  if ((N & (N - 1)) !== 0) {
    const size = 1 << Math.ceil(Math.log2(N));
    const padded = new Array(size).fill(0);
    for (let i = 0; i < N; i++) padded[i] = buffer[i];
    return fftReal(padded);
  }

  if (N <= 1) return [{ re: buffer[0], im: 0 }];

  const even = fftReal(buffer.filter((_, i) => i % 2 === 0));
  const odd = fftReal(buffer.filter((_, i) => i % 2 === 1));

  const combined = [];
  for (let k = 0; k < N / 2; k++) {
    const t = expComplex(-2 * Math.PI * k / N);
    const oddPart = complexMul(t, odd[k]);
    combined[k] = complexAdd(even[k], oddPart);
    combined[k + N / 2] = complexSub(even[k], oddPart);
  }
  return combined;
}

function expComplex(theta) {
  return { re: Math.cos(theta), im: Math.sin(theta) };
}
function complexAdd(a, b) {
  return { re: a.re + b.re, im: a.im + b.im };
}
function complexSub(a, b) {
  return { re: a.re - b.re, im: a.im - b.im };
}
function complexMul(a, b) {
  return { re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re };
}

// Encontra a frequência dominante no espectro FFT
function getDominantFrequency(samples, sampleRate) {
  const fft = fftReal(samples);
  let maxMag = 0;
  let maxIndex = 0;
  const N = fft.length;

  // Ignora o índice zero (DC)
  for (let i = 1; i < N / 2; i++) {
    const mag = Math.sqrt(fft[i].re ** 2 + fft[i].im ** 2);
    if (mag > maxMag) {
      maxMag = mag;
      maxIndex = i;
    }
  }

  return (maxIndex * sampleRate) / N;
}

// Converte frequência para nota musical (mesmo algoritmo C)
function frequencyToNote(freq) {
  if (!freq || freq <= 0) return 'PAUSA';

  const notas = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const A4 = 440;

  const n = 12 * Math.log2(freq / A4);
  const rounded = Math.round(n + 9);
  const octave = 4 + Math.floor(rounded / 12);
  const noteIndex = ((rounded % 12) + 12) % 12;

  return notas[noteIndex] + octave;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor ouvindo na porta ${PORT}`);
});
