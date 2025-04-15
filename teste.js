const express = require('express');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const wav = require('node-wav');

const app = express();
const PORT = process.env.PORT || 10000;

// Pasta para uploads
const upload = multer({ dest: 'uploads/' });
app.use(cors());
app.use('/uploads', express.static(path.join(__dirname, 'uploads'))); // Servir arquivos

// Rota principal
app.get('/', (req, res) => {
  res.send('Servidor online e pronto para receber áudio!');
});

// Upload + Processamento
app.post('/upload', upload.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).send('Nenhum arquivo enviado.');

  const inputPath = req.file.path;
  const wavPath = `${inputPath}.wav`;
  const datPath = `${inputPath}_audio_data.dat`;

  // Converter para WAV (mono, 44100 Hz, float32)
  const ffmpeg = spawn('ffmpeg', ['-y', '-i', inputPath, '-ac', '1', '-ar', '44100', '-sample_fmt', 'flt', wavPath]);

  ffmpeg.stderr.on('data', data => console.log(`FFmpeg stderr: ${data}`));

  ffmpeg.on('close', (code) => {
    if (code !== 0) {
      return res.status(500).send(`Erro na conversão FFmpeg: código ${code}`);
    }

    if (!fs.existsSync(wavPath)) {
      return res.status(500).send('Erro: Arquivo WAV não foi gerado.');
    }

    try {
      const buffer = fs.readFileSync(wavPath);
      const result = wav.decode(buffer);

      console.log('Resultado da Decodificação do WAV:', result);

      if (!result || !result.channelData || result.channelData.length === 0 || !result.channelData[0].length) {
        console.error("Erro: Dados do canal inválidos ou vazios.");
        return res.status(500).send('Erro ao decodificar o áudio.');
      }

      const channelData = result.channelData[0]; // mono
      const sampleRate = result.sampleRate;

      const data = channelData.map((amplitude, index) => {
        const time = (index / sampleRate).toFixed(6);
        const amplitudeValue = amplitude.toFixed(6);
        return `${time}\t${amplitudeValue}`;
      }).join('\n');

      if (!data || data.length === 0) {
        console.error("Erro: Nenhum dado válido foi escrito no arquivo .dat.");
        return res.status(500).send('Erro: Nenhum dado válido foi gerado para o arquivo .dat.');
      }

      fs.writeFileSync(datPath, data);
      console.log(`Arquivo .dat gerado em: ${datPath}`);

      const fileUrl = `/uploads/${path.basename(datPath)}`;
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
