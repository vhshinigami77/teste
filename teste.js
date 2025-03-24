const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const wavDecoder = require('wav-decoder'); // Importando o wav-decoder
const cors = require('cors');
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

// Função para processar o áudio
async function processAudio(filePath) {
    const fileBuffer = fs.readFileSync(filePath);  // Lê o arquivo como buffer

    try {
        // Usa wav-decoder para decodificar o arquivo WAV
        const audioData = await wavDecoder.decode(fileBuffer);  // 'decode' ao invés de 'decodeFile'
        console.log('Audio decodificado com sucesso:', audioData);

        // Aqui você pode processar os dados (exemplo: amplitude e tempo) para gerar o CSV
        // Retorne o caminho do arquivo CSV gerado, ou uma mensagem de sucesso
        return '/path/to/generated/file.csv';
    } catch (error) {
        console.error('Erro ao processar o áudio:', error);
        throw new Error('Erro ao processar o áudio');
    }
}

// Rota para upload do áudio
app.post('/upload', upload.single('audio'), async (req, res) => {
    if (!req.file) {
        return res.status(400).send('Nenhum arquivo enviado.');
    }

    const fileName = req.file.filename; // Nome do arquivo salvo
    const filePath = path.join(uploadsDir, fileName);

    try {
        // Processa o áudio depois que ele é enviado
        const csvPath = await processAudio(filePath);  // Processa o arquivo WAV e gera o CSV

        // Retorna a resposta com o caminho do arquivo CSV gerado
        res.send({ message: 'Áudio recebido e processado com sucesso!', file: fileName, csv: csvPath });
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
