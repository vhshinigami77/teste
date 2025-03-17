const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors'); // Importar o pacote CORS
const app = express();

// Habilitar CORS para permitir acesso do frontend
app.use(cors());

// Criar a pasta "uploads" se não existir
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
}

// Configurar o Multer para armazenar os arquivos com a extensão correta
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/'); // Diretório onde os arquivos serão salvos
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname) || '.wav'; // Mantém a extensão do arquivo original
        cb(null, `${Date.now()}${ext}`); // Nomeia o arquivo com timestamp para evitar conflitos
    }
});
const upload = multer({ storage });

// Rota de verificação do servidor
app.get('/', (req, res) => {
    res.send('Servidor está rodando! 🚀');
});

// Rota para upload do áudio
app.post('/upload', upload.single('audio'), (req, res) => {
    if (!req.file) {
        return res.status(400).send('Nenhum arquivo enviado.');
    }

    const fileName = req.file.filename; // Nome do arquivo salvo
    console.log(`Áudio recebido e salvo como: ${fileName}`);
    res.send({ message: 'Áudio recebido com sucesso!', file: fileName });
});

// Rota para acessar os arquivos gravados
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Iniciar o servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
