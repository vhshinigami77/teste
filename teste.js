const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const wavDecoder = require('wav-decoder');
const WavEncoder = require('wav-encoder');
const cors = require('cors');
const { parse } = require('json2csv');

const app = express();
app.use(cors());

// Cria pasta uploads se não existir
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
}

// Configuração do Multer
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname) || '.wav';
        cb(null, `${Date.now()}${ext}`);
    }
});

const upload = multer({
    storage,
    fileFilter: (req, file, cb) => {
        if (file.mimetype !== 'audio/wav' && file.mimetype !== 'audio/webm') {
            return cb(new Error('Somente arquivos WAV ou WEBM são permitidos.'));
        }
        cb(null, true);
    }
});

// Processamento do áudio
async function processAudio(filePath) {
    const fileBuffer = fs.readFileSync(filePath);

    try {
        const audioData = await wavDecoder.decode(fileBuffer);
        console.log('Áudio decodificado com sucesso!');
        const csvFilePath = await generateCsvFromAudioData(audioData);
        return { wavFilePath: filePath, csvFilePath };
    } catch (error) {
        console.error('Erro ao decodificar áudio:', error);
        const newFilePath = await createValidWavFile(filePath);
        const audioData = await wavDecoder.decode(fs.readFileSync(newFilePath));
        const csvFilePath = await generateCsvFromAudioData(audioData);
        return { wavFilePath: newFilePath, csvFilePath };
    }
}

// Função que gera CSV com duas colunas: tempo e amplitude
async function generateCsvFromAudioData(audioData) {
    const { sampleRate, channelData } = audioData;
    const amplitudeData = channelData[0];

    if (!amplitudeData || amplitudeData.length === 0) {
        throw new Error('Nenhum dado de amplitude encontrado no áudio.');
    }

    const timeData = amplitudeData.map((amplitude, index) => ({
        time: (index / sampleRate).toFixed(6),
        amplitude: amplitude.toFixed(6)
    }));

    const fields = ['time', 'amplitude'];
    const opts = { fields, header: true };
    const csv = parse(timeData, opts);

    const csvFilePath = path.join(uploadsDir, `${Date.now()}_audio_data.csv`);
    fs.writeFileSync(csvFilePath, csv);
    console.log('Arquivo CSV gerado:', csvFilePath);
    return csvFilePath;
}

// Gera WAV válido caso o arquivo esteja corrompido
async function createValidWavFile(filePath) {
    const samples = new Float32Array(44100);
    const sampleRate = 44100;

    const audioData = {
        sampleRate: sampleRate,
        channelData: [samples]
    };

    try {
        const buffer = await WavEncoder.encode(audioData);
        const newFilePath = path.join(uploadsDir, `${Date.now()}_valid.wav`);
        fs.writeFileSync(newFilePath, buffer);
        console.log('Arquivo WAV válido criado.');
        return newFilePath;
    } catch (error) {
        console.error('Erro ao criar WAV válido:', error);
        throw new Error('Erro ao criar arquivo WAV válido.');
    }
}

// Rota de upload
app.post('/upload', upload.single('audio'), async (req, res) => {
    if (!req.file) {
        return res.status(400).send('Nenhum arquivo enviado.');
    }

    const filePath = path.join(uploadsDir, req.file.filename);
    try {
        const { wavFilePath, csvFilePath } = await processAudio(filePath);
        res.send({
            message: 'Áudio recebido e processado com sucesso!',
            wavFile: wavFilePath,
            csvFile: csvFilePath
        });
    } catch (error) {
        console.error('Erro no processamento:', error);
        res.status(500).send('Erro ao processar o áudio.');
    }
});

// Servir arquivos estáticos
app.use('/uploads', express.static(uploadsDir));

// Inicia o servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
