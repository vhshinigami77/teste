const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(express.static('uploads'));  // Servir arquivos processados

// Endpoint para upload de áudio
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

    const txtPath = `${inputPath}.txt`;
    fs.writeFileSync(txtPath, 'Áudio processado com sucesso!');

    res.json({ downloadUrl: `/${path.basename(txtPath)}` });
  });
});

// Limpeza automática de arquivos antigos para evitar exceder o espaço disponível no Render
setInterval(() => {
  fs.readdir('uploads', (err, files) => {
    if (err) return;
    const agora = Date.now();
    files.forEach(file => {
      const filePath = path.join('uploads', file);
      fs.stat(filePath, (err, stats) => {
        if (!err && agora - stats.mtimeMs > 1000 * 60 * 10) {  // +10 minutos
          fs.unlink(filePath, () => {
            console.log(`Arquivo deletado: ${filePath}`);
          });
        }
      });
    });
  });
}, 1000 * 60 * 10);  // Roda a cada 10 minutos

// Usar a variável de ambiente PORT, caso disponível, ou qualquer porta disponível
const PORT = process.env.PORT || 0; // 0 permite que o sistema escolha uma porta disponível automaticamente
app.listen(PORT, () => {
  console.log(`Servidor online na porta ${PORT}`);
});
