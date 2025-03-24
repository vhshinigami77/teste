const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const wavDecoder = require('wav-decoder');
const WavEncoder = require('wav-encoder'); // Para criar um WAV válido
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
const upload = multer({
    storage,
    fileFilter: (req, file, cb) => {
        // Verifica se o arquivo é um WAV válido
        if (file.mimetype !== 'audio/wav') {
            return cb(new Error('Somente arquivos WAV são permitidos.'));
        }
        cb(null, true);
    }
});

// Rota de verificação do servidor
app.get('/', (req, res) => {
    res.send('Servidor está rodando! 🚀');
});

// Função para processar o áudio
async function processAudio(filePath) {
    const fileBuffer = fs.readFileSync(filePath);  // Lê o arquivo como buffer

    try {
        // Usa wav-decoder para tentar decodificar o arquivo WAV
        const audioData = await wavDecoder.decode(fileBuffer);  // 'decode' ao invés de 'decodeFile'
        console.log('Audio decodificado com sucesso:', audioData);

        // Se o áudio foi decodificado com sucesso, retornamos o caminho original
        return filePath; 
    } catch (error) {
        console.error('Erro ao processar o áudio:', error);
        
        // Caso o WAV esteja corrompido ou não seja válido, recriamos um novo arquivo WAV
        const newFilePath = await createValidWavFile(filePath);
        return newFilePath;  // Retorna o caminho do novo arquivo WAV válido
    }
}

// Função para criar um arquivo WAV válido a partir de amostras (exemplo simples de reconstrução)
async function createValidWavFile(filePath) {
    const samples = new Float32Array(44100); // Exemplo de amostras (1 segundo de áudio com 44100Hz)
    const sampleRate = 44100; // Taxa de amostragem típica de 44.1 kHz

    // Cria o objeto de dados de áudio com a taxa de amostragem e os dados das amostras
    const audioData = {
        sampleRate: sampleRate,
        channelData: [samples],  // Dados do canal de áudio
    };

    try {
        // Codifica os dados no formato WAV e grava em um arquivo
        const buffer = await WavEncoder.encode(audioData);
        const newFilePath = path.join(uploadsDir, `${Date.now()}_valid.wav`);
        fs.writeFileSync(newFilePath, buffer);  // Grava o arquivo WAV válido
        console.log('Arquivo WAV válido criado com sucesso!');
        return newFilePath;  // Retorna o caminho do novo arquivo WAV válido
    } catch (error) {
        console.error('Erro ao criar arquivo WAV válido:', error);
        throw new Error('Erro ao criar arquivo WAV válido');
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
        const processedFilePath = await processAudio(filePath);  // Processa o arquivo WAV

        // Retorna a resposta com o caminho do arquivo processado (pode ser o arquivo original ou o corrigido)
        res.send({ message: 'Áudio recebido e processado com sucesso!', file: fileName, processedFile: processedFilePath });
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
