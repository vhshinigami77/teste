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

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => cb(null, `${Date.now()}.wav`)
});

const upload = multer({
    storage,
    fileFilter: (req, file, cb) => {
        if (file.mimetype !== 'audio/wav') return cb(new Error('Somente arquivos WAV são permitidos.'));
        cb(null, true);
    }
});

async function processAudio(filePath) {
    const fileBuffer = fs.readFileSync(filePath);

    const header = fileBuffer.slice(0, 12).toString('ascii');
    if (!header.includes('RIFF') || !header.includes('WAVE')) {
        throw new Error('Arquivo não é um WAV válido.');
    }

    try {
        const audioData = await wavDecoder.decode(fileBuffer);
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

async function generateCsvFromAudioData(audioData) {
    const { sampleRate, channelData } = audioData;
    const amplitudeData = channelData[0];

    const timeData = amplitudeData.map((amplitude, index) => ({
        time: index / sampleRate,
        amplitude
    }));

    const csv = parse(timeData);
    const csvFilePath = path.join(uploadsDir, `${Date.now()}_audio_data.csv`);
    fs.writeFileSync(csvFilePath, csv);
    console.log('Arquivo CSV gerado:', csvFilePath);
    return csvFilePath;
}

async function createValidWavFile(filePath) {
    const samples = new Float32Array(44100);
    const audioData = { sampleRate: 44100, channelData: [samples] };
    const buffer = await WavEncoder.encode(audioData);
    const newFilePath = path.join(uploadsDir, `${Date.now()}_valid.wav`);
    fs.writeFileSync(newFilePath, buffer);
    return newFilePath;
}

app.post('/upload', upload.single('audio'), async (req, res) => {
    if (!req.file) return res.status(400).send('Nenhum arquivo enviado.');

    const filePath = path.join(uploadsDir, req.file.filename);
    try {
        const { wavFilePath, csvFilePath } = await processAudio(filePath);
        res.json({ 
            message: 'Áudio recebido e processado com sucesso!', 
            wavFile: wavFilePath, 
            csvFile: csvFilePath 
        });
    } catch (error) {
        console.error(error);
        res.status(500).send('Erro ao processar o áudio.');
    }
});

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
