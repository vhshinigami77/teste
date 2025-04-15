const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { parse } = require('json2csv');

const app = express();
const uploadsDir = path.join(__dirname, 'uploads');

// Cria o diretório de uploads, se não existir
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
  console.log('Pasta de uploads criada:', uploadsDir);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}${path.extname(file.originalname)}`);
  }
});

const upload = multer({ storage });

app.use('/uploads', express.static(uploadsDir));

app.post('/upload', upload.single('audio'), (req, res) => {
  if (!req.file) return res.status(400).send('Nenhum arquivo enviado.');

  // Processamento do arquivo (exemplo simples, sem conversão para WAV)
  const filePath = req.file.path;
  const csvPath = filePath.replace(path.extname(filePath), '_audio_data.csv');
  const timeData = []; // Exemplo de dados para CSV

  // Aqui você pode preencher `timeData` com os dados extraídos do áudio
  const csv = parse(timeData);

  // Salvar o CSV
  fs.writeFileSync(csvPath, csv);
  console.log(`CSV gerado em: ${csvPath}`);

  // Retornar o caminho para o frontend
  res.json({ downloadUrl: `/uploads/${path.basename(csvPath)}`, filename: path.basename(csvPath) });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
