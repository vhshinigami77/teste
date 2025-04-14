const express = require('express');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { parse } = require('json2csv');
const wav = require('node-wav');

const app = express();
const PORT = process.env.PORT || 10000;

// Pasta para uploads
const upload = multer({ dest: 'uploads/' });
app.use(cors());
app.use('/files', express.static(path.join(__dirname, 'uploads')));  // Servir arquivos da pasta uploads

// Rota principal
app.get('/', (req, res) => {
  res.send('Servidor online e pronto para receber áudio!');
});

// Upload + Processamento
app.post('/upload', upload.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).send('Nenhum arquivo enviado.');

  const inputPath = req.file.path;
  const wavPath = `${inputPath}.wav`;
  const csvPath = `${inputPath}_audio_data.csv`;

  // Converter para WAV usando FFmpeg
  const ffmpeg = spawn('ffmpeg', ['-y', '-i', inputPath, '-ac', '1', '-ar', '44100', wavPath]);

  ffmpeg.stderr.on('data', data => console.log(`FFmpeg stderr: ${data}`));

  ffmpeg.on('close', (code) => {
    if (code !== 0) {
      return res.status(500).send(`Erro na conversão FFmpeg: código ${code}`);
    }

    // Ler o WAV e processar
    try {
      const buffer = fs.readFileSync(wavPath);
      const result = wav.decode(buffer);

      const channelData = result.channelData[0]; // mono
      const sampleRate = result.sampleRate;

      const data = channelData.map((amplitude, index) => ({
        time: (index / sampleRate).toFixed(6),
        amplitude: amplitude.toFixed(6)
      }));

      // Converter para CSV
      const csv = parse(data, { fields: ['time', 'amplitude'] });
      fs.writeFileSync(csvPath, csv);

      console.log(`CSV gerado em: ${csvPath}`);

      // Enviar link para o frontend
      const fileUrl = `/files/${path.basename(csvPath)}`;
      res.json({ downloadUrl: fileUrl });

    } catch (error) {
      console.error("Erro ao processar o áudio:", error);
      res.status(500).send("Erro ao processar o áudio.");
    }
  });
});

app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
