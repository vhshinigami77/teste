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

    // --- Amplitude média por bloco ---
    const blockSize = Math.floor(sampleRate * 0.1);
    const amplitudeData = [];
    for (let i = 0; i < samples.length; i += blockSize) {
      const block = samples.slice(i, i + blockSize);
      const avg = block.reduce((acc, v) => acc + Math.abs(v), 0) / block.length;
      amplitudeData.push({ time: (i / sampleRate).toFixed(1), amplitude: avg });
    }

    // --- Autocorrelação para detectar frequência fundamental ---
    const autocorrFreq = detectFundamentalAutocorrelation(samples, sampleRate);
    const limiar = 2e-3;
    const dominantNote = !autocorrFreq || amplitudeData[0].amplitude < limiar
      ? 'PAUSA'
      : frequencyToNoteDetailed(autocorrFreq);

    // Salvar arquivos txt
    const ampFilename = `amplitude_${Date.now()}.txt`;
    const ampPath = path.join(publicDir, ampFilename);
    const ampContent = amplitudeData.map(d => `${d.time}\t${d.amplitude}`).join('\n');
    fs.writeFileSync(ampPath, ampContent);

    const notaFilename = `nota_${Date.now()}.txt`;
    const notaPath = path.join(publicDir, notaFilename);
    fs.writeFileSync(notaPath, dominantNote);

    // Limpeza dos arquivos temporários
    fs.unlinkSync(inputPath);
    fs.unlinkSync(outputWavPath);

    res.json({
      samples: amplitudeData,
      dominantFrequency: autocorrFreq,
      dominantNote,
      downloads: {
        amplitude: `/${ampFilename}`,
        nota: `/${notaFilename}`
      }
    });

  } catch (err) {
    console.error('❌ Erro:', err);
    res.status(500).json({ error: 'Erro no processamento do áudio' });
  }
});

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

// --- Extração de amostras PCM normalizadas ---
function extractSamplesFromWav(buffer) {
  const samples = [];
  for (let i = 44; i < buffer.length; i += 2) {
    const sample = buffer.readInt16LE(i);
    samples.push(sample / 32768);
  }
  return samples;
}

// --- Autocorrelação para detectar a frequência fundamental com refinamento ---
function detectFundamentalAutocorrelation(samples, sampleRate) {
  const minFreq = 130;  // limite inferior ~ dó2
  const maxFreq = 1000; // limite superior

  const minLag = Math.floor(sampleRate / maxFreq);
  const maxLag = Math.floor(sampleRate / minFreq);

  let bestLag = -1;
  let maxCorrelation = 0;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i < samples.length - lag; i++) {
      sum += samples[i] * samples[i + lag];
    }
    if (sum > maxCorrelation) {
      maxCorrelation = sum;
      bestLag = lag;
    }
  }

  if (bestLag === -1) return null;

  // Refinar para evitar sub-harmônicos
  for (let divisor = 2; divisor <= 4; divisor++) {
    let candidateLag = Math.floor(bestLag / divisor);
    if (candidateLag < minLag) break;

    let candidateSum = 0;
    for (let i = 0; i < samples.length - candidateLag; i++) {
      candidateSum += samples[i] * samples[i + candidateLag];
    }

    if (candidateSum > 0.8 * maxCorrelation) {
      bestLag = candidateLag;
      maxCorrelation = candidateSum;
    }
  }

  return sampleRate / bestLag;
}

// --- Converter frequência para nota musical com cents ---
function frequencyToNoteDetailed(freq) {
  if (!freq || freq <= 0) return 'PAUSA';

  const A4 = 440;
  const notas = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

  const semitonesFromA4 = 12 * Math.log2(freq / A4);
  const semitonesRounded = Math.round(semitonesFromA4);
  const cents = Math.round((semitonesFromA4 - semitonesRounded) * 100);
  const noteIndex = (semitonesRounded + 9 + 1200) % 12;
  const octave = 4 + Math.floor((semitonesRounded + 9) / 12);

  return `${notas[noteIndex]}${octave} (${cents >= 0 ? '+' : ''}${cents} cents)`;
}

app.use(express.static('teste'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor ouvindo na porta ${PORT}`);
});
