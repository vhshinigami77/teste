const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(express.static('uploads'));  // Servir arquivos processados

app.post('/upload', upload.single('audio'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Nenhum arquivo enviado!' });
  }

  const inputPath = req.file.path;
  const outputWav = `${inputPath}.wav`;

  const ffmpeg = spawn('ffmpeg', ['-y', '-i', inputPath, '-ac', '1', '-ar', '44100', outputWav]);

  ffmpeg.stderr.on('data', data => {
    console.log(`FFmpeg: ${data}`);
  });

  ffmpeg.on('close', code => {
    if (code !== 0) {
      console.error(`FFmpeg finalizou com erro (code ${code})`);
      return res.status(500).json({ error: 'Falha ao converter áudio.' });
    }

    const txtPath = `${inputPath}.txt`;
    fs.writeFileSync(txtPath, 'Áudio processado com sucesso!');

    res.json({ downloadUrl: `/${path.basename(txtPath)}` });
  });
});

// PORTA ajustada para Render
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Servidor online na porta ${PORT}`));
