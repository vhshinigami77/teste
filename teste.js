const express = require("express");
const multer = require("multer");
const cors = require("cors");
const path = require("path");

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.static("uploads"));

// Configuração do multer para salvar os arquivos
const storage = multer.diskStorage({
  destination: "./uploads/",
  filename: (req, file, cb) => {
    cb(null, `audio_${Date.now()}${path.extname(file.originalname)}`);
  },
});
const upload = multer({ storage });

app.post("/upload", upload.single("audio"), (req, res) => {
  if (!req.file) {
    return res.status(400).send("Nenhum arquivo enviado.");
  }
  res.send({ message: "Arquivo recebido", filePath: `/uploads/${req.file.filename}` });
});

// Rota de teste
app.get("/", (req, res) => {
  res.send("Servidor de áudio rodando no Render!");
});

app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
});
