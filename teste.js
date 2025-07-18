import express from 'express';
import multer from 'multer';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import fs from 'fs';
import path from 'path';
import { fft } from 'fft-js';
import { Parser } from 'json2csv';

const app = express();
const upload = multer({ dest: 'uploads/' });

ffmpeg.setFfmpegPath(ffmpegStatic);

app.use(express.json());

// Servir arquivos gerados para download
app.use('/outputs', express.static(path.join(process.cwd(), 'outputs')));

app.post('/upload', upload.single('audio'), async (req, res) => {
  console.log(`🚀 Arquivo recebido: ${req.file.originalname} (${req.file.size} bytes)`);

  const inputPath = req.file.path;
  const outputWavPath = inputPath + '.wav';

  try {
    console.log('⚙️ Convertendo para WAV...');
    await convertToWav(inputPath, outputWavPath);
    console.log('✅ Conversão concluída.');

    const wavBuffer = fs.readFileSync(outputWavPath);
    const samples = extractSamplesFromWav(wavBuffer);

    const sampleRate = 44100;
    const blockSize = Math.floor(sampleRate * 0.1);

    const amplitudeData = [];
    for (let i = 0; i < samples.length; i += blockSize) {
      const block = samples.slice(i, i + blockSize);
      const avg = block.reduce((acc, v) => acc + Math.abs(v), 0) / block.length;
      amplitudeData.push({ time: (i / sampleRate).toFixed(1), amplitude: avg });
    }

    // FFT
    const fftInput = samples.slice(0, 1024);
    const phasors = fft(fftInput);
    const fftData = phasors.map((c, i) => {
      const re = c[0];
      const im = c[1];
      const mag = Math.sqrt(re * re + im * im);
      return { frequency: (i * sampleRate) / fftInput.length, amplitude: mag };
    }).slice(0, fftInput.length / 2);

    // Garante que a pasta outputs existe
    if (!fs.existsSync('outputs')) {
      fs.mkdirSync('outputs');
    }

    // Criar arquivos para download
    const timestamp = Date.now();
    const fftFileName = `fft_${timestamp}.txt`;
    const ampFileName = `amplitude_${timestamp}.csv`;

    // Arquivo txt FFT: frequencia \t amplitude
    const fftLines = fftData.map(d => `${d.frequency.toFixed(1)}\t${d.amplitude.toFixed(6)}`).join('\n');
    fs.writeFileSync(path.join('outputs', fftFileName), "frequency(Hz)\tamplitude\n" + fftLines);

    // CSV amplitude média
    const parser = new Parser({ fields: ['time', 'amplitude'] });
    const ampCsv = parser.parse(amplitudeData);
    fs.writeFileSync(path.join('outputs', ampFileName), ampCsv);

    // Limpar arquivos temporários
    fs.unlinkSync(inputPath);
    fs.unlinkSync(outputWavPath);

    res.json({
      samples: amplitudeData,
      fft: fftData,
      fftDownloadUrl: `/outputs/${fftFileName}`,
      amplitudeDownloadUrl: `/outputs/${ampFileName}`
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
  for (let i = 44; i < buffer.length; i += 2) {
    const sample = buffer.readInt16LE(i);
    samples.push(sample / 32768);
  }
  return samples;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor ouvindo na porta ${PORT}`);
});
