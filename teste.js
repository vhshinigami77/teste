const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const wavDecoder = require('wav-decoder');
const cors = require('cors');
const { parse } = require('json2csv');
const ffmpegPath = require('ffmpeg-static');
const { spawn } = require('child_process');

const app = express();
app.use(cors());

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname) || '.webm';
        cb(null, `${Date.now()}${ext}`);
    }
});
const upload = multer({ storage });

async function convertToWav(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
        const ffmpeg = spawn(ffmpegPath, [
            '-i', inputPath,
            '-ar', '44100',
            '-ac', '1',
            '-f', 'wav',
            outputPath
        ]);

        ffmpeg.on('close', code => {
            if (code === 0) {
                resolve(outputPath);
            } else {
                reject(new Error(`FFmpeg exited with code ${code}`));
            }
        });
    });
}

async function processAudio(originalPath) {
    const wavPath = originalPath.replace(path.extname(originalPath), '.wav');

    try {
        await convertToWav(originalPath, wavPath);
        const fileBuffer = fs.readFileSync(wavPath);
        const audioData = await wavDecoder.decode(fileBuffer);
        const csvPath = await generateCsvFromAudioData(audioData);
        return { wavFilePath: wavPath, csvFilePath: csvPath };
    } catch (error) {
        console.error('Erro no processamento FFmpeg/WAV:', error);
        throw error;
    }
}

async function generateCsvFromAudioData(audioData) {
    const { sampleRate, channelData } = audioData;
    const amplitudeData = channelData[0];

    const timeData = amplitudeData.map((amplitude, index) => ({
        time: index / sampleRate,
        amplitude: amplitude
    }));

    const csv = parse(timeData);
    const csvPath = path.join(uploadsDir, `${Date.now()}_audio_data.csv`);
    fs.writeFileSync(csvPath, csv);
    console.log('CSV gerado em:', csvPath);

    return csvPath;
}

app.post('/upload', upload.single('audio'), async (req, res) => {
    if (!req.file) {
        return res.status(400).send('Nenhum arquivo enviado.');
    }

    try {
        const filePath = path.join(uploadsDir, req.file.filename);
        const { wavFilePath, csvFilePath } = await processAudio(filePath);

        res.send({
            message: 'Áudio processado com sucesso!',
            wavFile: `/uploads/${path.basename(wavFilePath)}`,
            csvFile: `/uploads/${path.basename(csvFilePath)}`
        });
    } catch (error) {
        res.status(500).send('Erro ao processar áudio.');
    }
});

app.use('/uploads', express.static(uploadsDir));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
