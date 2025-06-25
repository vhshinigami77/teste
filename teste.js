const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const wavDecoder = require('wav-decoder');
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
  const fileBuffer = fs.readFileSync(wavPath);
  const audioData = await wavDecoder.decode(fileBuffer);
  const { sampleRate, channelData } = audioData;

  if (!sampleRate || !channelData || !channelData[0]) {
    throw new Error('Erro ao extrair dados do WAV. Dados inválidos.');
  }

  const amplitudeData = channelData[0];

  return amplitudeData.map((amplitude, index) => {
    const time = index / sampleRate;
    const amp = Number.isFinite(amplitude) ? amplitude : 0;
    return {
      time: time.toFixed(6),
      amplitude: amp.toFixed(6)
    };
  });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
