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

// Rota para upload do áudio e conversão para .txt
app.post('/upload', upload.single('audio'), async (req, res) => {
    if (!req.file) {
        return res.status(400).send('Nenhum arquivo enviado.');
    }

    const fileName = req.file.filename;
    console.log(`Áudio recebido e salvo como: ${fileName}`);

    try {
        // Lê o arquivo de áudio .wav
        const filePath = path.join(__dirname, 'uploads', fileName);
        const buffer = fs.readFileSync(filePath);
        
        // Decodifica o arquivo WAV
        const decoded = await wav.decode(buffer);
        const sampleRate = decoded.sampleRate;
        const samples = decoded.channelData[0];

        // Define o caminho do arquivo .txt
        const txtFileName = `${fileName.replace(path.extname(fileName), '.txt')}`;
        const txtFilePath = path.join(__dirname, 'uploads', txtFileName);
        const writeStream = fs.createWriteStream(txtFilePath);

        // Converte o áudio para o formato .txt (tempo e amplitude)
        samples.forEach((sample, index) => {
            const time = index / sampleRate;
            writeStream.write(`${time.toFixed(6)} ${sample.toFixed(6)}\n`);
        });

        writeStream.end();

        // Envia a resposta com o nome do arquivo .txt gerado
        res.send({
            message: 'Áudio recebido e convertido para .txt com sucesso!',
            file: txtFileName
        });
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
