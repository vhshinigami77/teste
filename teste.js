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
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));  // Servir arquivos da pasta uploads

// Rota principal
app.get('/', (req, res) => {
  res.send('Servidor online e pronto para receber áudio!');
});

// Upload + Processamento
app.post('/upload', upload.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).send('Nenhum arquivo enviado.');

  const inputPath = req.file.path;
  const wavPath = `${inputPath}.wav`;
  const txtPath = `${inputPath}_audio_data.txt`;

  // Converter para WAV usando FFmpeg
  const ffmpeg = spawn('ffmpeg', ['-y', '-i', inputPath, '-ac', '1', '-ar', '44100', wavPath]);

  ffmpeg.stderr.on('data', data => console.log(`FFmpeg stderr: ${data}`));

  ffmpeg.on('close', (code) => {
    if (code !== 0) {
      return res.status(500).send(`Erro na conversão FFmpeg: código ${code}`);
    }

    // Verificar se o arquivo WAV foi gerado corretamente
    if (!fs.existsSync(wavPath)) {
      return res.status(500).send('Erro: Arquivo WAV não foi gerado.');
    }

    // Ler o WAV e processar
    try {
      const buffer = fs.readFileSync(wavPath);
      const result = wav.decode(buffer);

      // Log para verificar a estrutura do resultado da decodificação
      console.log('Resultado da Decodificação do WAV:', result);

      // Verificar se a decodificação foi bem-sucedida
      if (!result || !result.channelData || result.channelData.length === 0) {
        console.error("Erro ao decodificar o áudio, dados de canal ausentes.");
        return res.status(500).send('Erro ao decodificar o áudio.');
      }

      const channelData = result.channelData[0]; // mono
      const sampleRate = result.sampleRate;

      // Verificar se os dados do canal são válidos
      if (!channelData || channelData.length === 0) {
        console.error("Erro: Nenhum dado de áudio encontrado.");
        return res.status(500).send('Erro: Nenhum dado de áudio encontrado.');
      }

      // Gerar os dados para o arquivo .txt
      const data = channelData.map((amplitude, index) => {
        const time = (index / sampleRate).toFixed(6);
        const amplitudeValue = amplitude.toFixed(6);
        
        // Verificar se o valor de amplitude é um número válido
        if (isNaN(amplitudeValue)) {
          console.error(`Valor de amplitude inválido na amostra ${index}: ${amplitudeValue}`);
        }

        return `${time}\t${amplitudeValue}`;
      }).join('\n');

      // Verificar se o arquivo .txt foi gerado corretamente
      if (!data || data.length === 0) {
        console.error("Erro: Nenhum dado válido foi escrito no arquivo .txt.");
        return res.status(500).send('Erro: Nenhum dado válido foi gerado para o arquivo .txt.');
      }

      // Escrever os dados no arquivo .txt
      fs.writeFileSync(txtPath, data);

      console.log(`Arquivo .txt gerado em: ${txtPath}`);

      // Enviar link para o frontend
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
