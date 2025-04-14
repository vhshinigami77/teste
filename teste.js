const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const wavDecoder = require('wav-decoder');
const WavEncoder = require('wav-encoder'); // Para criar um WAV válido
const cors = require('cors');
const { parse } = require('json2csv'); // Biblioteca para gerar CSV
const ffmpeg = require('fluent-ffmpeg');  // Biblioteca para conversão de formatos de áudio
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

// Função para converter outros formatos de áudio para WAV
async function convertToWav(inputPath) {
    const outputPath = inputPath.replace(path.extname(inputPath), '_converted.wav');
    return new Promise((resolve, reject) => {
        ffmpeg(inputPath)
            .outputOptions([
                '-ac 1',          // Mono (1 canal)
                '-ar 44100',      // Sample rate de 44.1kHz
                '-f wav',         // Forçar o formato WAV
                '-acodec pcm_s16le'  // PCM Linear 16 bits (formato compatível)
            ])
            .on('end', () => resolve(outputPath))
            .on('error', reject)
            .save(outputPath);
    });
}

// Função para processar o áudio
async function processAudio(filePath) {
    const fileBuffer = fs.readFileSync(filePath);  // Lê o arquivo como buffer

    try {
        // Usa wav-decoder para tentar decodificar o arquivo WAV
        const audioData = await wavDecoder.decode(fileBuffer);  // 'decode' ao invés de 'decodeFile'
        console.log('Audio decodificado com sucesso:', audioData);

        // Se o áudio foi decodificado com sucesso, retornamos o caminho original
        const csvFilePath = await generateCsvFromAudioData(audioData); // Gera o CSV com base nos dados do áudio
        return { wavFilePath: filePath, csvFilePath };  // Retorna os caminhos do WAV e do CSV
    } catch (error) {
        console.error('Erro ao processar o áudio:', error);
        
        // Caso o WAV esteja corrompido ou não seja válido, tentamos converter o arquivo para WAV válido
        const newFilePath = await convertToWav(filePath);
        const audioData = await wavDecoder.decode(fs.readFileSync(newFilePath));
        const csvFilePath = await generateCsvFromAudioData(audioData); // Gera o CSV com o novo WAV válido
        return { wavFilePath: newFilePath, csvFilePath };  // Retorna os caminhos do novo WAV e CSV
    }
}

// Função para gerar um CSV com base nos dados do áudio
async function generateCsvFromAudioData(audioData) {
    const { sampleRate, channelData } = audioData;
    const amplitudeData = channelData[0]; // Vamos processar o primeiro canal de áudio (mono)

    console.log(`Decodificado: ${amplitudeData.length} amostras.`);

    if (amplitudeData.length === 0) {
        throw new Error('Sem dados de áudio para gerar o CSV');
    }

    const timeData = amplitudeData.map((amplitude, index) => ({
        time: (index / sampleRate).toFixed(6), // O tempo é dado pela posição do sample dividido pela taxa de amostragem
        amplitude: amplitude.toFixed(6) // A amplitude do áudio
    }));

    // Converte os dados para CSV
    const csv = parse(timeData);
    const csvFilePath = path.join(uploadsDir, `${Date.now()}_audio_data.csv`);

    // Escreve o CSV no arquivo
    fs.writeFileSync(csvFilePath, csv);
    console.log('Arquivo CSV gerado com sucesso:', csvFilePath);

    return csvFilePath;
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
        const { wavFilePath, csvFilePath } = await processAudio(filePath);  // Processa o arquivo WAV e gera o CSV

        // Retorna a resposta com o caminho do arquivo processado (pode ser o arquivo original ou o corrigido)
        res.send({ 
            message: 'Áudio recebido e processado com sucesso!', 
            wavFile: wavFilePath, 
            csvFile: csvFilePath  // Caminho do arquivo CSV gerado
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
