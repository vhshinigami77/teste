const express = require('express');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const audioread = require('audioread');

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
  const datPath = `${inputPath}_audio_data.dat`;

  // Abrir o arquivo de áudio com audioread
  const stream = fs.createReadStream(inputPath);
  const reader = audioread(stream);

  let channelData = [];
  let sampleRate = reader.sampleRate;

  // Ler os dados do arquivo de áudio
  reader.on('data', (chunk) => {
    channelData = channelData.concat(chunk);
  });

  reader.on('end', () => {
    console.log('Leitura do áudio concluída.');

    if (!channelData || channelData.length === 0) {
      console.error("Erro: Dados do canal inválidos ou vazios.");
      return res.status(500).send('Erro: Dados do canal inválidos.');
    }

    // Processamento dos dados de áudio
    const data = channelData.map((amplitude, index) => {
      if (isNaN(amplitude)) {
        console.error(`Amostra inválida na posição ${index}: ${amplitude}`);
        amplitude = 0;  // Substitui por 0 em caso de NaN
      }
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
  });

  reader.on('error', (err) => {
    console.error("Erro ao processar o arquivo de áudio:", err);
    res.status(500).send("Erro ao processar o áudio.");
  });
});

app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
