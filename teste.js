const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const wav = require('wav-decoder');

const app = express();
app.use(cors());

// Criar a pasta "uploads" se não existir
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
}

// Configurar o Multer para armazenar os arquivos com a extensão correta
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname) || '.wav';
        cb(null, `${Date.now()}${ext}`);
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

    const fileName = req.file.filename;
    console.log(`Áudio recebido e salvo como: ${fileName}`);
    res.send({ message: 'Áudio recebido com sucesso!', file: fileName });
});

// Rota para converter .wav para .txt
app.get('/convert/:fileName', async (req, res) => {
    const fileName = req.params.fileName;
    const filePath = path.join(__dirname, 'uploads', fileName);

    if (!fs.existsSync(filePath)) {
        return res.status(404).send('Arquivo não encontrado');
    }

    try {
        const buffer = fs.readFileSync(filePath);
        const decoded = await wav.decode(buffer);
        const sampleRate = decoded.sampleRate;
        const samples = decoded.channelData[0];

        const txtFilePath = path.join(__dirname, 'uploads', 'audio.txt');
        const writeStream = fs.createWriteStream(txtFilePath);

        samples.forEach((sample, index) => {
            const time = index / sampleRate;
            writeStream.write(`${time.toFixed(6)} ${sample.toFixed(6)}\n`);
        });

        writeStream.end();

        res.send({ message: 'Conversão concluída', file: 'audio.txt' });
    } catch (error) {
        console.error('Erro ao processar o arquivo:', error);
        res.status(500).send('Erro interno ao processar o áudio');
    }
});

// Rota para acessar os arquivos gravados
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Iniciar o servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
