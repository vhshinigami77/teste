const express = require('express');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const json2csv = require('json2csv').parse;

const app = express();
const PORT = process.env.PORT || 10000;

// Configuração do multer para uploads
const upload = multer({ dest: 'uploads/' });

app.use(cors());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Rota simples de teste
app.get('/', (req, res) => {
  res.send('Servidor online e pronto para receber áudio!');
});

// Rota para upload e processamento
app.post('/upload', upload.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).send('Nenhum arquivo enviado.');

  const inputPath = req.file.path;
  const wavPath = `${inputPath}.wav`;
  const datPath = `${inputPath}_audio_data.dat`;

  // Comando para usar o Sox
  const sox = spawn('sox', [inputPath, wavPath, 'rate', '44100', 'channels', '1']);

  sox.stderr.on('data', data => console.log(`Sox stderr: ${data}`));

  sox.on('close', (code) => {
    if (code !== 0) {
      console.error(`Erro na conversão Sox: código ${code}`);
      return res.status(500).send(`Erro na conversão do áudio: código ${code}`);
    }

    if (!fs.existsSync(wavPath)) {
      console.error('Erro: Arquivo WAV não foi gerado.');
      return res.status(500).send('Erro: Arquivo WAV não encontrado.');
    }

    try {
      const buffer = fs.readFileSync(wavPath);
      const channelData = new Float32Array(buffer.buffer);

      if (!channelData || channelData.length === 0) {
        console.error("Erro: Dados do canal inválidos ou vazios.");
        return res.status(500).send('Erro: Dados do canal inválidos.');
      }

      const sampleRate = 44100; // A taxa de amostragem foi definida para 44100Hz

      const data = channelData.map((amplitude, index) => {
        const time = (index / sampleRate).toFixed(6);     // tempo em segundos
        const amplitudeValue = amplitude.toFixed(6);      // amplitude normalizada
        return `${time}\t${amplitudeValue}`;
      }).join('\n');

      if (!data || data.length === 0) {
        console.error("Erro: Nenhum dado válido foi gerado.");
        return res.status(500).send('Erro ao gerar o arquivo .dat.');
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
