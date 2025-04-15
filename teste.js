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
  const datPath = `${inputPath}_audio_data.dat`;

  // Converter para WAV com taxa de amostragem fixa 44100 Hz e mono
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

      console.log('Resultado da Decodificação do WAV:', {
        sampleRate: result.sampleRate,
        numChannels: result.channelData.length
      });

      if (!result || !result.channelData || result.channelData.length === 0) {
        console.error("Erro: Nenhum dado de canal encontrado.");
        return res.status(500).send('Erro ao decodificar o áudio.');
      }

      const channelData = result.channelData[0]; // mono
      const sampleRate = result.sampleRate;

      if (!Array.isArray(channelData) || channelData.length === 0) {
        console.error("Erro: Dados do canal inválidos ou vazios.");
        return res.status(500).send('Erro: Canal de áudio vazio.');
      }

      // Geração dos dados para o arquivo .dat (tempo\tamplitude)
      const dataLines = channelData.map((amplitude, index) => {
        const time = (index / sampleRate).toFixed(6);
        const amplitudeValue = Number.isFinite(amplitude) ? amplitude.toFixed(6) : 'NaN';
        return `${time}\t${amplitudeValue}`;
      });

      // Checagem final para evitar arquivo só com NaNs
      const validLines = dataLines.filter(line => !line.includes('NaN'));

      if (validLines.length === 0) {
        console.error("Erro: Todos os valores foram NaN. Verifique o fluxo de áudio e o arquivo de entrada.");
        return res.status(500).send('Erro: Dados inválidos no áudio.');
      }

      fs.writeFileSync(datPath, dataLines.join('\n'));
      console.log(`Arquivo .dat gerado com sucesso: ${datPath}`);

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
