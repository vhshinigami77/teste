const express = require('express');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const wav = require('node-wav');

const app = express();
const PORT = process.env.PORT || 10000;

// Configurar pasta de upload
const upload = multer({ dest: 'uploads/' });
app.use(cors());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));  // Servir arquivos da pasta uploads

// Rota simples de teste
app.get('/', (req, res) => {
  res.send('Servidor online e pronto para receber áudio!');
});

// Upload e processamento
app.post('/upload', upload.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).send('Nenhum arquivo enviado.');

  const inputPath = req.file.path;
  const wavPath = `${inputPath}.wav`;
  const txtPath = `${inputPath}_audio_data.txt`;

  // Converter para WAV com FFmpeg (mono e 44.1kHz)
  const ffmpeg = spawn('ffmpeg', ['-y', '-i', inputPath, '-ac', '1', '-ar', '44100', wavPath]);

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

      if (!result || !result.channelData || result.channelData.length === 0) {
        console.error("Erro ao decodificar o áudio, dados de canal ausentes.");
        return res.status(500).send('Erro ao decodificar o áudio.');
      }

      const channelData = result.channelData[0]; // Mono
      const sampleRate = result.sampleRate;

      if (!channelData || channelData.length === 0) {
        console.error("Erro: Nenhum dado de áudio encontrado.");
        return res.status(500).send('Erro: Nenhum dado de áudio encontrado.');
      }

      // Gerar dados do .txt evitando NaN
      const data = channelData.map((amplitude, index) => {
        const time = (index / sampleRate).toFixed(6);
        const amplitudeValue = Number.isFinite(amplitude) ? amplitude.toFixed(6) : '0.000000';

        if (!Number.isFinite(amplitude)) {
          console.warn(`Amostra inválida em index ${index}: valor = ${amplitude}`);
        }

        return `${time}\t${amplitudeValue}`;
      }).join('\n');

      if (!data || data.length === 0) {
        console.error("Erro: Nenhum dado válido foi escrito no arquivo .txt.");
        return res.status(500).send('Erro: Nenhum dado válido foi gerado para o arquivo .txt.');
      }

      fs.writeFileSync(txtPath, data);

      console.log(`Arquivo .txt gerado em: ${txtPath}`);

      // Enviar link para download
      const fileUrl = `/uploads/${path.basename(txtPath)}`;
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
