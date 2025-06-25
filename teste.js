const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const wav = require('wav');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const cors = require('cors');

const app = express();
const uploadsDir = path.join(__dirname, 'uploads');

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
  console.log('Pasta de uploads criada:', uploadsDir);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}${path.extname(file.originalname)}`);
  }
});

const upload = multer({ storage });

app.use(cors());
app.use('/uploads', express.static(uploadsDir));

app.post('/upload', upload.single('audio'), async (req, res) => {
  if (!req.file) {
    return res.status(400).send('Nenhum arquivo enviado.');
  }

  const inputPath = req.file.path;
  const wavPath = `${inputPath}.wav`;
  const txtPath = `${inputPath}_audio_data.txt`;

  try {
    console.log('Iniciando conversão para WAV...');
    await convertToWav(inputPath, wavPath);
    console.log('Arquivo WAV gerado:', wavPath);

    const timeData = await processAudio(wavPath);
    console.log('Dados extraídos:', timeData.length);

    const lines = timeData.map(({ time, amplitude }) => `${time}\t${amplitude}`);
    fs.writeFileSync(txtPath, lines.join('\n'));
    console.log('Arquivo TXT gerado:', txtPath);

    res.json({
      downloadUrl: `/uploads/${path.basename(txtPath)}`,
      filename: path.basename(txtPath)
    });
  } catch (error) {
    console.error('Erro ao processar o áudio:', error);
    res.status(500).send('Erro ao processar o áudio.');
  }
});

async function convertToWav(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(ffmpegPath, [
      '-y',
      '-i', inputPath,
      '-ar', '44100',
      '-ac', '1',
      '-f', 'wav',
      outputPath
    ]);

    ffmpeg.stderr.on('data', (data) => {
      console.error(`FFmpeg stderr: ${data}`);
    });

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        console.log('Conversão para WAV concluída.');
        resolve(outputPath);
      } else {
        reject(new Error(`FFmpeg falhou com código ${code}`));
      }
    });
  });
}

async function processAudio(wavPath) {
  return new Promise((resolve, reject) => {
    const fileStream = fs.createReadStream(wavPath);
    const reader = new wav.Reader();

    let sampleRate;
    let timeData = [];
    let sampleIndex = 0;

    reader.on('format', (format) => {
      sampleRate = format.sampleRate;
      if (format.channels !== 1) {
        console.warn('Aviso: arquivo WAV não é mono. Será usado somente o primeiro canal.');
      }
    });

    reader.on('data', (chunk) => {
      // chunk é um Buffer de samples
      // Cada sample é 16 bits (2 bytes), little-endian, signed PCM

      // Para evitar problema com multi-canais, vamos considerar somente o primeiro canal, assumindo 16 bits PCM mono (1 canal)

      for (let i = 0; i < chunk.length; i += 2) {
        // Leitura do sample 16-bit assinado, little endian
        let sample = chunk.readInt16LE(i);
        // normaliza amplitude entre -1 e 1
        let amplitude = sample / 32768;
        let time = sampleIndex / sampleRate;
        timeData.push({
          time: time.toFixed(6),
          amplitude: amplitude.toFixed(6)
        });
        sampleIndex++;
      }
    });

    reader.on('end', () => {
      resolve(timeData);
    });

    reader.on('error', (err) => {
      reject(err);
    });

    fileStream.pipe(reader);
  });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
