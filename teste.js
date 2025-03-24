const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const wavDecoder = require('wav-decoder');  // Importando a biblioteca para decodificar o arquivo WAV
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

// Função para processar o áudio e gerar os dados de tempo e amplitude
const processAudio = async (audioPath) => {
    const audioData = await wavDecoder.decodeFile(audioPath);
    const sampleRate = audioData.sampleRate;
    const samples = audioData.channelData[0]; // Considerando o primeiro canal de áudio (mono)

    // Gerar um array com tempo (em segundos) e amplitude
    const data = samples.map((sample, index) => {
        const time = index / sampleRate;  // Tempo em segundos
        return { time: time.toFixed(6), amplitude: sample.toFixed(6) };
    });

    // Gerar arquivo CSV com os dados
    const csvContent = data.map(item => `${item.time},${item.amplitude}`).join('\n');
    const outputPath = path.join(uploadsDir, 'audio_data.csv');
    fs.writeFileSync(outputPath, csvContent);

    return outputPath;
};

// Rota para upload do áudio
app.post('/upload', upload.single('audio'), async (req, res) => {
    if (!req.file) {
        return res.status(400).send('Nenhum arquivo enviado.');
    }

    const fileName = req.file.filename;
    const audioPath = path.join(__dirname, 'uploads', fileName);

    try {
        const outputPath = await processAudio(audioPath); // Processa o arquivo e gera o CSV
        console.log(`Áudio recebido e salvo como: ${fileName}`);
        res.send({
            message: 'Áudio recebido com sucesso!',
            file: fileName,
            dataFile: outputPath // Retorna o caminho do arquivo CSV gerado
        });
    } catch (error) {
        console.error('Erro ao processar o áudio:', error);
        res.status(500).send('Erro ao processar o áudio.');
    }
});

// Rota para acessar os arquivos gravados
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Iniciar o servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
