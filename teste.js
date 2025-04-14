const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const wavDecoder = require('wav-decoder');
const { parse } = require('json2csv');
const ffmpeg = require('fluent-ffmpeg');
const cors = require('cors');

const app = express();
app.use(cors());

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => cb(null, `${Date.now()}${path.extname(file.originalname)}`)
});
const upload = multer({ storage });

async function convertToWav(inputPath) {
    const outputPath = inputPath.replace(path.extname(inputPath), '_converted.wav');
    return new Promise((resolve, reject) => {
        ffmpeg(inputPath)
            .toFormat('wav')
            .on('end', () => resolve(outputPath))
            .on('error', reject)
            .save(outputPath);
    });
}

async function generateCsvFromAudioData(audioData) {
    const { sampleRate, channelData } = audioData;
    const amplitudeData = channelData[0];
    if (!amplitudeData || amplitudeData.length === 0) throw new Error('Sem dados de amplitude.');

    const timeData = amplitudeData.map((amp, i) => ({
        time: (i / sampleRate).toFixed(6),
        amplitude: amp.toFixed(6)
    }));

    const csv = parse(timeData, { fields: ['time', 'amplitude'] });
    const csvPath = path.join(uploadsDir, `${Date.now()}_audio_data.csv`);
    fs.writeFileSync(csvPath, csv);
    return csvPath;
}

app.post('/upload', upload.single('audio'), async (req, res) => {
    if (!req.file) return res.status(400).send('Nenhum arquivo enviado.');

    try {
        const convertedPath = await convertToWav(req.file.path);
        const fileBuffer = fs.readFileSync(convertedPath);
        const audioData = await wavDecoder.decode(fileBuffer);
        const csvPath = await generateCsvFromAudioData(audioData);
        res.send({ 
            message: 'Processamento completo!',
            wavFile: convertedPath,
            csvFile: csvPath
        });
    } catch (error) {
        console.error(error);
        res.status(500).send('Erro ao processar áudio.');
    }
});

app.use('/uploads', express.static(uploadsDir));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
