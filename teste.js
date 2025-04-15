const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { parse } = require('json2csv');
const wavDecoder = require('wav-decoder');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const cors = require('cors');

const app = express();
const uploadsDir = path.join(__dirname, 'uploads');

// Cria a pasta de uploads se não existir
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
  console.log('Pasta de uploads criada:', uploadsDir);
}

// Configuração do Multer para armazenar arquivos de áudio
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}${path.extname(file.originalname)}`);
  }
});

const upload = multer({ storage });

// Habilitar CORS para o frontend
app.use(cors());
app.use('/uploads', express.static(uploadsDir)); // Serve arquivos da pasta 'uploads'

// Rota para upload do áudio
app.post('/upload', upload.single('audio'), async (req, res) => {
  if (!req.file) {
    return res.status(400).send('Nenhum arquivo enviado.');
  }

  const inputPath = req.file.path;
  const wavPath = `${inputPath}.wav`;
  const csvPath = `${inputPath}_audio_data.csv`;

  try {
    // Converter para WAV usando FFmpeg
    await convertToWav(inputPath, wavPath);

    // Processar o áudio e gerar os dados de amplitude
    const timeData = await processAudio(wavPath);

    // Gerar o CSV a partir dos dados
    const csv = parse(timeData);
    fs.writeFileSync(csvPath, csv);
    console.log(`CSV gerado em: ${csvPath}`);

    // Enviar resposta com o link do arquivo CSV
    res.json({ downloadUrl: `/uploads/${path.basename(csvPath)}`, filename: path.basename(csvPath) });
  } catch (error) {
    console.error('Erro ao processar o áudio:', error);
    res.status(500).send('Erro ao processar o áudio.');
  }
});

// Função para converter o arquivo para WAV usando FFmpeg
async function convertToWav(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    console.log(`Iniciando conversão: ${inputPath} -> ${outputPath}`);

    const ffmpeg = spawn(ffmpegPath, [
      '-y',                 // sobrescreve se já existir
      '-i', inputPath,      // arquivo de entrada
      '-ar', '44100',       // taxa de amostragem
      '-ac', '1',           // mono
      '-f', 'wav',          // formato WAV
      outputPath
    ]);

    ffmpeg.stderr.on('data', (data) => {
      console.error(`FFmpeg stderr: ${data}`);
    });

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        console.log('Conversão para WAV concluída.');
        resolve(outputPath);
      } else {
        reject(new Error(`FFmpeg falhou com código ${code}`));
      }
    });
  });
}

// Função para processar o áudio e gerar os dados de amplitude
async function processAudio(wavPath) {
  const fileBuffer = fs.readFileSync(wavPath);
  const audioData = await wavDecoder.decode(fileBuffer);
  const { sampleRate, channelData } = audioData;

  const amplitudeData = channelData[0]; // Assumindo áudio mono

  return amplitudeData.map((amplitude, index) => ({
    time: (index / sampleRate).toFixed(6), // Tempo em segundos
    amplitude: amplitude.toFixed(6)        // Amplitude
  }));
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
