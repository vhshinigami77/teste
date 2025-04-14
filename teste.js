const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const wavDecoder = require('wav-decoder');
const { parse } = require('json2csv');
const cors = require('cors');

const app = express();
app.use(cors());

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => cb(null, `${Date.now()}.wav`)
});
const upload = multer({ storage });

async function convertWithFfmpeg(inputPath) {
    const outputPath = inputPath.replace('.wav', '_converted.wav');
    return new Promise((resolve, reject) => {
        const command = `ffmpeg -y -i "${inputPath}" -ac 1 -ar 44100 -f wav "${outputPath}"`;
        exec(command, (error) => {
            if (error) reject(error);
            else resolve(outputPath);
        });
    });
}

async function processAudio(filePath) {
    const convertedPath = await convertWithFfmpeg(filePath);
    const fileBuffer = fs.readFileSync(convertedPath);
    const audioData = await wavDecoder.decode(fileBuffer);

    console.log(`Decodificado: ${audioData.channelData[0].length} amostras.`);

    const { sampleRate, channelData } = audioData;
    const timeData = channelData[0].map((amplitude, index) => ({
        time: index / sampleRate,
        amplitude
    }));

    const csv = parse(timeData);
    const csvFilePath = path.join(uploadsDir, `${Date.now()}_audio_data.csv`);
    fs.writeFileSync(csvFilePath, csv);
    return { wavFilePath: convertedPath, csvFilePath };
}

app.post('/upload', upload.single('audio'), async (req, res) => {
    if (!req.file) return res.status(400).send('Nenhum arquivo enviado.');
    const filePath = path.join(uploadsDir, req.file.filename);

    try {
        const { wavFilePath, csvFilePath } = await processAudio(filePath);
        res.send({
            message: 'Áudio processado com sucesso!',
            wavFile: `/uploads/${path.basename(wavFilePath)}`,
            csvFile: `/uploads/${path.basename(csvFilePath)}`
        });
    } catch (error) {
        console.error('Erro ao processar o áudio:', error);
        res.status(500).send('Erro ao processar o áudio.');
    }
});

app.use('/uploads', express.static(uploadsDir));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
