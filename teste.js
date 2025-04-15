const express = require('express');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const app = express();
const PORT = process.env.PORT || 10000;

// Configuração do multer para uploads
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
  const datPath = `${inputPath}_audio_data.dat`;

  // Conversão usando FFmpeg de qualquer formato para WAV
  const ffmpeg = spawn('ffmpeg', [
    '-y', // overwrite
    '-i', inputPath, // entrada: qualquer formato (ogg, webm, opus...)
    '-ac', '1', // forçar mono
    '-ar', '44100', // sample rate
    wavPath // saída
  ]);

  ffmpeg.stderr.on('data', data => console.log(`FFmpeg stderr: ${data}`));

  ffmpeg.on('close', code => {
    if (code !== 0) {
      console.error(`Erro na conversão FFmpeg: código ${code}`);
      return res.status(500).send(`Erro na conversão do áudio: código ${code}`);
    }

    if (!fs.existsSync(wavPath)) {
      console.error('Erro: Arquivo WAV não foi gerado.');
      return res.status(500).send('Erro: Arquivo WAV não encontrado.');
    }

    // Após conversão, processar com SoX ou outro
    const sox = spawn('sox', [
      wavPath, datPath, 'stat'
    ]);

    sox.stderr.on('data', data => console.log(`SoX stderr: ${data}`));

    sox.on('close', soxCode => {
      if (soxCode !== 0) {
        console.error(`Erro na conversão Sox: código ${soxCode}`);
        return res.status(500).send(`Erro no processamento com SoX.`);
      }

      console.log(`Arquivo processado com SoX e salvo em: ${datPath}`);
      const fileUrl = `/uploads/${path.basename(datPath)}`;
      res.json({ downloadUrl: fileUrl });
    });
  });
});

app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
