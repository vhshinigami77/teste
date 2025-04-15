const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const app = express();
const upload = multer({ dest: 'uploads/' });

// Permitir CORS para o frontend
const cors = require('cors');
app.use(cors());

// Servir arquivos processados
app.use(express.static('uploads'));

app.post('/upload', upload.single('audio'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Nenhum arquivo enviado!' });
  }

  const inputPath = req.file.path;
  const outputWav = `${inputPath}.wav`;

  const ffmpeg = spawn('ffmpeg', [
    '-y', '-i', inputPath,
    '-ac', '1', '-ar', '44100', outputWav
  ]);

  ffmpeg.stderr.on('data', data => {
    console.log(`FFmpeg: ${data}`);
  });

  ffmpeg.on('close', code => {
    if (code !== 0) {
      console.error(`FFmpeg finalizou com erro (code ${code})`);
      return res.status(500).json({ error: 'Falha ao converter áudio.' });
    }

    // Simula processamento: gera arquivo .txt
    const txtPath = `${inputPath}.txt`;
    fs.writeFileSync(txtPath, 'Áudio processado com sucesso!');

    res.json({ downloadUrl: `/uploads/${path.basename(txtPath)}` });
  });
});

// Usar process.env.PORT para garantir que o Render aloque a porta corretamente
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor online na porta ${PORT}`));
