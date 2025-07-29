import express from 'express';
import multer from 'multer';
import cors from 'cors';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import fs from 'fs';
import path from 'path';

const app = express();
app.use(cors());

// Configuração do multer para receber uploads na pasta 'uploads/'
const upload = multer({ dest: 'uploads/' });

// Configura o caminho do ffmpeg
ffmpeg.setFfmpegPath(ffmpegStatic);

app.use(express.json());

// Cria a pasta pública para salvar arquivos de saída (se não existir)
const publicDir = path.join(process.cwd(), 'teste');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir);
}

// Endpoint para receber arquivo de áudio via POST
app.post('/upload', async (req, res) => {
  // Executa o middleware multer para capturar arquivo 'audio'
  upload.single('audio')(req, res, async (err) => {
    if (err) {
      return res.status(500).json({ error: 'Erro no upload do arquivo' });
    }

    console.log(`🚀 Arquivo recebido: ${req.file.originalname} (${req.file.size} bytes)`);

    const inputPath = req.file.path;
    const outputWavPath = inputPath + '.wav';

    try {
      // Converte o áudio enviado para formato WAV
      await convertToWav(inputPath, outputWavPath);
      console.log('✅ Conversão para WAV concluída.');

      // Lê o arquivo WAV convertido em buffer
      const wavBuffer = fs.readFileSync(outputWavPath);

      // Extrai amostras normalizadas do WAV (valores entre -1 e 1)
      const samples = extractSamplesFromWav(wavBuffer);

      const sampleRate = 44100; // taxa de amostragem fixa usada no projeto

      // --- Calcula amplitude média em blocos de 0.1s ---
      const blockSize = Math.floor(sampleRate * 0.1); // número de amostras por bloco
      const amplitudeData = [];
      for (let i = 0; i < samples.length; i += blockSize) {
        const block = samples.slice(i, i + blockSize);
        // Média da amplitude absoluta das amostras do bloco
        const avg = block.reduce((acc, v) => acc + Math.abs(v), 0) / block.length;
        amplitudeData.push({ time: (i / sampleRate).toFixed(1), amplitude: avg });
      }

      // --- Detecta frequência fundamental via autocorrelação ---
      const dominantFreq = detectFundamentalAutocorrelation(samples, sampleRate);

      // --- Converte frequência e amplitude do primeiro bloco em nota ---
      const dominantNote = frequencyToNote(dominantFreq, amplitudeData[0]?.amplitude || 0);

      // Salva os dados de amplitude em arquivo TXT na pasta pública
      const ampFilename = `amplitude_${Date.now()}.txt`;
      const ampPath = path.join(publicDir, ampFilename);
      const ampContent = amplitudeData.map(d => `${d.time}\t${d.amplitude}`).join('\n');
      fs.writeFileSync(ampPath, ampContent);

      // Salva a nota detectada em arquivo TXT na pasta pública
      const notaFilename = `nota_${Date.now()}.txt`;
      const notaPath = path.join(publicDir, notaFilename);
      fs.writeFileSync(notaPath, dominantNote);

      // Remove arquivos temporários do upload e conversão
      fs.unlinkSync(inputPath);
      fs.unlinkSync(outputWavPath);

      // Retorna JSON com os dados para o front-end
      res.json({
        samples: amplitudeData,
        dominantFrequency: dominantFreq,
        dominantNote,
        downloads: {
          amplitude: `/${ampFilename}`,
          nota: `/${notaFilename}`
        }
      });

    } catch (error) {
      console.error('❌ Erro:', error);
      res.status(500).json({ error: 'Erro no processamento do áudio' });
    }
  });
});

// Função para converter arquivo de áudio para WAV usando ffmpeg
function convertToWav(input, output) {
  return new Promise((resolve, reject) => {
    ffmpeg(input)
      .toFormat('wav')
      .on('end', resolve)
      .on('error', reject)
      .save(output);
  });
}

// Função que extrai amostras do arquivo WAV e normaliza para -1..1
function extractSamplesFromWav(buffer) {
  const samples = [];
  // Ignora cabeçalho WAV (44 bytes)
  for (let i = 44; i < buffer.length; i += 2) {
    // Leitura de amostra 16-bit little-endian
    const sample = buffer.readInt16LE(i);
    samples.push(sample / 32768); // normaliza para -1 a 1
  }
  return samples;
}

// Função que detecta a frequência fundamental usando autocorrelação
function detectFundamentalAutocorrelation(samples, sampleRate) {
  // Define faixa de frequências consideradas (130 Hz ~ dó2 até 1000 Hz)
  const minFreq = 130;
  const maxFreq = 1000;

  // Calcula os limites de lag (em número de amostras) para autocorrelação
  const minLag = Math.floor(sampleRate / maxFreq);
  const maxLag = Math.floor(sampleRate / minFreq);

  let bestLag = -1;
  let maxCorrelation = 0;

  // Loop para encontrar o lag que maximiza a autocorrelação
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

  // Refinamento para evitar falsos harmônicos (sub-harmônicos)
  for (let divisor = 2; divisor <= 4; divisor++) {
    let candidateLag = Math.floor(bestLag / divisor);
    if (candidateLag < minLag) break;

    let candidateSum = 0;
    for (let i = 0; i < samples.length - candidateLag; i++) {
      candidateSum += samples[i] * samples[i + candidateLag];
    }

    // Se a autocorrelação do candidato for razoavelmente alta, escolhe ele
    if (candidateSum > 0.8 * maxCorrelation) {
      bestLag = candidateLag;
      maxCorrelation = candidateSum;
    }
  }

  // Retorna a frequência fundamental estimada
  return sampleRate / bestLag;
}

// Função que converte frequência e amplitude para nota musical considerando limiar
function frequencyToNote(freq, amplitude) {
  const limiar = 2e-3;

  // Se a frequência for inválida ou amplitude abaixo do limiar, retorna "PAUSA"
  if (!freq || freq <= 0 || amplitude < limiar) {
    return 'PAUSA';
  }

  // Nomes das notas numa oitava (de C a B)
  const notas = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

  // Cálculo da posição da nota relativa a 440 Hz (Lá4)
  const n = 12 * Math.log2(freq / 440);
  const rounded = Math.round(n + 9);
  const q = Math.floor(rounded / 12);
  const r = rounded % 12;

  // Retorna a nota concatenada com a oitava (4 + q)
  return notas[r] + (4 + q);
}

// Servir arquivos estáticos da pasta 'teste' para download pelo front-end
app.use(express.static('teste'));

// Inicia o servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor ouvindo na porta ${PORT}`);
});
