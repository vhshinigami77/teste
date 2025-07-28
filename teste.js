import express from 'express';
import multer from 'multer';
import cors from 'cors';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import fs from 'fs';
import path from 'path';
import { fft } from 'fft-js';

const app = express();
app.use(cors());
const upload = multer({ dest: 'uploads/' });
ffmpeg.setFfmpegPath(ffmpegStatic);
app.use(express.json());

// Cria pasta para salvar arquivos .txt
const publicDir = path.join(process.cwd(), 'teste');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir);
}

app.post('/upload', upload.single('audio'), async (req, res) => {
  console.log(`🚀 Arquivo recebido: ${req.file.originalname} (${req.file.size} bytes)`);

  const inputPath = req.file.path;
  const outputWavPath = inputPath + '.wav';

  try {
    // Converte o áudio para WAV
    console.log('⚙️ Convertendo para WAV...');
    await convertToWav(inputPath, outputWavPath);
    console.log('✅ Conversão concluída.');

    // Lê e extrai amostras do WAV
    const wavBuffer = fs.readFileSync(outputWavPath);
    const samples = extractSamplesFromWav(wavBuffer);

    const sampleRate = 44100;
    const blockSize = Math.floor(sampleRate * 0.1); // blocos de 0.1s para amplitude

    // Calcula amplitude média por bloco
    const amplitudeData = [];
    for (let i = 0; i < samples.length; i += blockSize) {
      const block = samples.slice(i, i + blockSize);
      const avg = block.reduce((acc, v) => acc + Math.abs(v), 0) / block.length;
      amplitudeData.push({ time: (i / sampleRate).toFixed(1), amplitude: avg });
    }

    // Salva amplitude.txt
    const ampFilename = `amplitude_${Date.now()}.txt`;
    const ampPath = path.join(publicDir, ampFilename);
    const ampContent = amplitudeData.map(d => `${d.time}\t${d.amplitude}`).join('\n');
    fs.writeFileSync(ampPath, ampContent);

    // ✅ FFT de TODAS as amostras (sem blocos)
    const phasors = fft(samples);
    const fftData = phasors.map((c, idx) => {
      const re = c[0];
      const im = c[1];
      return {
        frequency: (idx * sampleRate) / samples.length,
        amplitude: Math.sqrt(re * re + im * im)
      };
    }).slice(0, Math.floor(samples.length / 2)); // Só até Nyquist

    // Frequência com maior amplitude global
    const peak = fftData.reduce((max, val) => val.amplitude > max.amplitude ? val : max, { amplitude: 0 });

    const limiar = 2e-3;
    const dominantFrequency = peak.frequency;
    const dominantNote = peak.amplitude < limiar ? 'PAUSA' : frequencyToNote(dominantFrequency);

    // Salva nota.txt
    const notaFilename = `nota_${Date.now()}.txt`;
    const notaPath = path.join(publicDir, notaFilename);
    fs.writeFileSync(notaPath, dominantNote);

    // Remove arquivos temporários
    fs.unlinkSync(inputPath);
    fs.unlinkSync(outputWavPath);

    // Retorna para front-end
    res.json({
      samples: amplitudeData,
      dominantFrequency,
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

// Converte para WAV
function convertToWav(input, output) {
  return new Promise((resolve, reject) => {
    ffmpeg(input)
      .toFormat('wav')
      .on('end', resolve)
      .on('error', reject)
      .save(output);
  });
}

// Extrai amostras normalizadas do WAV
function extractSamplesFromWav(buffer) {
  const samples = [];
  for (let i = 44; i < buffer.length; i += 2) {
    const sample = buffer.readInt16LE(i);
    samples.push(sample / 32768);
  }
  return samples;
}

// Converte frequência para nota musical
function frequencyToNote(freq) {
  if (!freq || freq <= 0) return 'PAUSA';

  const notas = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const A4 = 440;
  const n = Math.round(12 * Math.log2(freq / A4));
  const noteIndex = n + 69;
  const nota = notas[noteIndex % 12];
  const oitava = Math.floor(noteIndex / 12) - 1;
  return nota + oitava;
}

app.use(express.static('teste'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor ouvindo na porta ${PORT}`);
});
