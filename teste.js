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

if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}${path.extname(file.originalname)}`)
});

const upload = multer({ storage });
app.use(cors());
app.use('/uploads', express.static(uploadsDir));
app.use(express.json());

app.post('/upload', upload.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).send('Nenhum arquivo enviado.');

  const inputPath = req.file.path;
  const wavPath = `${inputPath}.converted.wav`;
  const txtPath = `${inputPath}_audio_data.txt`;

  try {
    await convertToWav(inputPath, wavPath);
    const timeData = await processAudio(wavPath);

    const lines = timeData.map(({ time, amplitude }) => `${time}\t${amplitude}`);
    fs.writeFileSync(txtPath, lines.join('\n'));

    res.json({
      downloadUrl: `/uploads/${path.basename(txtPath)}`,
      samples: timeData, // Envia os pontos reduzidos para o gráfico
      sampleRate: timeData.length > 1 ? (1 / (timeData[1].time - timeData[0].time)).toFixed(1) : "N/A"
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Erro ao processar áudio.');
  }
});

function convertToWav(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(ffmpegPath, [
      '-y',
      '-i', inputPath,
      '-ar', '44100',
      '-ac', '1',
      '-f', 'wav',
      outputPath
    ]);

    ffmpeg.stderr.on('data', (data) => console.error(`FFmpeg: ${data}`));
    ffmpeg.on('close', (code) => {
      if (code === 0) resolve(outputPath);
      else reject(new Error(`FFmpeg falhou com código ${code}`));
    });
  });
}

function processAudio(wavPath) {
  return new Promise((resolve, reject) => {
    const fileStream = fs.createReadStream(wavPath);
    const reader = new wav.Reader();

    let sampleRate;
    let timeData = [];
    let sampleIndex = 0;
    let nextTime = 0;

    reader.on('format', (format) => {
      sampleRate = format.sampleRate;
    });

    reader.on('data', (chunk) => {
      for (let i = 0; i < chunk.length; i += 2) {
        const sample = chunk.readInt16LE(i);
        const amplitude = sample / 32768;
        const time = sampleIndex / sampleRate;

        if (time >= nextTime) {
          timeData.push({ time: time.toFixed(2), amplitude: amplitude.toFixed(6) });
          nextTime += 0.1; // 10 centésimos de segundo
        }

        sampleIndex++;
      }
    });

    reader.on('end', () => resolve(timeData));
    reader.on('error', reject);
    fileStream.pipe(reader);
  });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
