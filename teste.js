const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { spawn } = require('child_process');
const fs = require('fs');
const wav = require('node-wav');
const { Parser } = require('json2csv');
const path = require('path');
const ffmpegPath = require('ffmpeg-static');

const app = express();
const PORT = 10000;

app.use(cors());
app.use(express.static('uploads'));

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1E9)}`;
    cb(null, uniqueName);
  }
});

const upload = multer({ storage: storage });

app.post('/upload', upload.single('audio'), (req, res) => {
  if (!req.file) {
    return res.status(400).send('Nenhum arquivo foi enviado.');
  }

  const inputPath = req.file.path;
  const wavPath = `${inputPath}.wav`;
  const datPath = `${inputPath}_audio_data.dat`;
  const csvPath = `${inputPath}_audio_data.csv`;

  // ffmpeg conversion
  const ffmpeg = spawn(ffmpegPath, [
    '-y',
    '-i', inputPath,
    '-ac', '1',
    '-ar', '44100',
    wavPath
  ]);

  ffmpeg.stderr.on('data', data => console.error(`FFmpeg stderr: ${data}`));
  ffmpeg.on('error', error => {
    console.error(`Erro ao iniciar ffmpeg: ${error.message}`);
    res.status(500).send('Erro ao processar o áudio.');
  });

  ffmpeg.on('close', code => {
    if (code !== 0) {
      console.error(`FFmpeg falhou com código ${code}`);
      return res.status(500).send('Falha na conversão do áudio.');
    }

    // Decodifica WAV
    try {
      const buffer = fs.readFileSync(wavPath);
      const result = wav.decode(buffer);

      console.log('Resultado da Decodificação:', result);

      const audioData = result.channelData[0]; // Assume mono
      fs.writeFileSync(datPath, Buffer.from(new Float32Array(audioData).buffer));

      // CSV export
      const json = audioData.map((value, index) => ({ index, value }));
      const csv = new Parser({ fields: ['index', 'value'] }).parse(json);
      fs.writeFileSync(csvPath, csv);

      res.json({ datFile: datPath, csvFile: csvPath });
    } catch (err) {
      console.error('Erro ao processar WAV:', err);
      res.status(500).send('Erro ao processar o arquivo WAV.');
    }
  });
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
