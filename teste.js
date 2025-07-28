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
const upload = multer({ dest: 'uploads/' }); // Salva arquivos temporariamente na pasta uploads/
ffmpeg.setFfmpegPath(ffmpegStatic); // Configura o caminho do executável do ffmpeg

app.use(express.json());

// Pasta pública onde os arquivos de saída (.txt) são salvos
const publicDir = path.join(process.cwd(), 'teste');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir);
}

// Rota para upload do áudio
app.post('/upload', upload.single('audio'), async (req, res) => {
  console.log(`🚀 Arquivo recebido: ${req.file.originalname} (${req.file.size} bytes)`);

  const inputPath = req.file.path;
  const outputWavPath = inputPath + '.wav';

  try {
    // Conversão para WAV
    console.log('⚙️ Convertendo para WAV...');
    await convertToWav(inputPath, outputWavPath);
    console.log('✅ Conversão concluída.');

    // Lê o buffer do arquivo WAV e extrai as amostras normalizadas [-1, 1]
    const wavBuffer = fs.readFileSync(outputWavPath);
    const samples = extractSamplesFromWav(wavBuffer);

    const sampleRate = 44100; // Taxa de amostragem padrão
    const blockSize = Math.floor(sampleRate * 0.1); // Blocos de 0.1s

    // Calcula a amplitude média de cada bloco
    const amplitudeData = [];
    for (let i = 0; i < samples.length; i += blockSize) {
      const block = samples.slice(i, i + blockSize);
      const avg = block.reduce((acc, v) => acc + Math.abs(v), 0) / block.length;
      amplitudeData.push({ time: (i / sampleRate).toFixed(1), amplitude: avg });
    }

    // Gera arquivo amplitude.txt
    const ampFilename = `amplitude_${Date.now()}.txt`;
    const ampPath = path.join(publicDir, ampFilename);
    const ampContent = amplitudeData.map(d => `${d.time}\t${d.amplitude}`).join('\n');
    fs.writeFileSync(ampPath, ampContent);

    // FFT em blocos de 1024 samples
    const fftBlockSize = 1024;
    const fftBlocks = Math.floor(samples.length / fftBlockSize);

    let maxDominantAmplitude = 0;
    let dominantFrequency = 0;

    for (let i = 0; i < fftBlocks; i++) {
      const blockSamples = samples.slice(i * fftBlockSize, (i + 1) * fftBlockSize);
      const phasors = fft(blockSamples);

      // Calcula magnitude de cada componente da FFT
      const fftData = phasors.map((c, idx) => {
        const re = c[0];
        const im = c[1];
        return {
          frequency: (idx * sampleRate) / fftBlockSize,
          amplitude: Math.sqrt(re * re + im * im)
        };
      }).slice(0, fftBlockSize / 2); // Pega até Nyquist

      // Encontra o pico de amplitude neste bloco
      const blockMax = fftData.reduce((acc, val) => val.amplitude > acc.amplitude ? val : acc, { amplitude: 0 });

      // Atualiza a frequência dominante se esse bloco tiver maior amplitude
      if (blockMax.amplitude > maxDominantAmplitude) {
        maxDominantAmplitude = blockMax.amplitude;
        dominantFrequency = blockMax.frequency;
      }
    }

    const limiar = 2e-3; // Limiar de silêncio
    const dominantNote = maxDominantAmplitude < limiar ? 'PAUSA' : frequencyToNote(dominantFrequency);

    // Gera nota.txt com a nota dominante
    const notaFilename = `nota_${Date.now()}.txt`;
    const notaPath = path.join(publicDir, notaFilename);
    fs.writeFileSync(notaPath, dominantNote);

    // Limpa arquivos temporários
    fs.unlinkSync(inputPath);
    fs.unlinkSync(outputWavPath);

    // Envia resposta para o front-end
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

// Função para converter WebM para WAV usando ffmpeg
function convertToWav(input, output) {
  return new Promise((resolve, reject) => {
    ffmpeg(input)
      .toFormat('wav')
      .on('end', resolve)
      .on('error', reject)
      .save(output);
  });
}

// Função para extrair amostras PCM do buffer WAV
function extractSamplesFromWav(buffer) {
  const samples = [];
  for (let i = 44; i < buffer.length; i += 2) {
    const sample = buffer.readInt16LE(i);
    samples.push(sample / 32768); // Normaliza para [-1, 1]
  }
  return samples;
}

// ✅ Função corrigida: converte frequência para nota musical com precisão
function frequencyToNote(freq) {
  if (!freq || freq <= 0) return 'PAUSA';

  const notas = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const A4 = 440;
  const n = Math.round(12 * Math.log2(freq / A4)); // distância em semitons
  const noteIndex = n + 69; // 69 = número MIDI do A4
  const nota = notas[noteIndex % 12];
  const oitava = Math.floor(noteIndex / 12) - 1;
  return nota + oitava;
}

// Serve arquivos .txt da pasta 'teste'
app.use(express.static('teste'));

// Inicializa servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor ouvindo na porta ${PORT}`);
});
