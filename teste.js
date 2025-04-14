const express = require('express');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const wav = require('node-wav');

const app = express();
const PORT = process.env.PORT || 10000;

const upload = multer({ dest: 'uploads/' });

app.use(cors());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.get('/', (req, res) => {
  res.send('Servidor online e pronto para receber áudio!');
});

app.post('/upload', upload.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).send('Nenhum arquivo enviado.');

  const inputPath = req.file.path;
  const wavPath = `${inputPath}.wav`;
  const txtPath = `${inputPath}_audio_data.txt`;

  console.log(`Iniciando conversão de: ${req.file.originalname}`);

  // Conversão para WAV com aumento de volume
  const ffmpeg = spawn('ffmpeg', [
    '-y',
    '-i', inputPath,
    '-ac', '1',
    '-ar', '44100',
    '-filter:a', 'volume=10dB',
    wavPath
  ]);

  ffmpeg.stderr.on('data', data => console.log(`FFmpeg: ${data.toString()}`));

  ffmpeg.on('close', (code) => {
    if (code !== 0) {
      console.error(`FFmpeg falhou (código ${code})`);
      return res.status(500).send(`Erro na conversão FFmpeg (código ${code})`);
    }

    if (!fs.existsSync(wavPath)) {
      console.error('Erro: Arquivo WAV não encontrado.');
      return res.status(500).send('Erro: WAV não gerado.');
    }

    try {
      const buffer = fs.readFileSync(wavPath);
      const result = wav.decode(buffer);

      console.log(`Decodificado: ${result.sampleRate} Hz, canais: ${result.channelData.length}`);

      if (!result || !result.channelData || result.channelData.length === 0) {
        console.error("Erro ao decodificar: dados de canal ausentes.");
        return res.status(500).send('Erro ao decodificar o áudio.');
      }

      const channelData = result.channelData[0]; // Mono
      const sampleRate = result.sampleRate;

      if (!channelData || channelData.length === 0) {
        console.error("Erro: Nenhum dado de áudio encontrado.");
        return res.status(500).send('Erro: Nenhum dado de áudio encontrado.');
      }

      const data = channelData.map((amplitude, index) => {
        const time = (index / sampleRate).toFixed(6);
        const amplitudeValue = amplitude.toFixed(6);
        return `${time}\t${amplitudeValue}`;
      }).join('\n');

      if (!data || data.length === 0) {
        console.error("Erro: Dados inválidos gerados para o TXT.");
        return res.status(500).send('Erro: Nenhum dado válido foi gerado para o arquivo .txt.');
      }

      fs.writeFileSync(txtPath, data);
      console.log(`✅ Arquivo TXT gerado: ${txtPath}`);

      const fileUrl = `/uploads/${path.basename(txtPath)}`;
      res.json({ downloadUrl: fileUrl });

      // ⚠️ Opcional: limpar arquivos temporários depois de enviar o link
      // fs.unlinkSync(inputPath);
      // fs.unlinkSync(wavPath);

    } catch (error) {
      console.error("Erro no processamento do áudio:", error);
      res.status(500).send("Erro ao processar o áudio.");
    }
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando em: http://localhost:${PORT}`);
});
