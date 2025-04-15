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
const PORT = process.env.PORT || 10000;

// Pasta para uploads
const upload = multer({ dest: 'uploads/' });
app.use(cors());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));  // Servir arquivos da pasta uploads

const uploadsDir = path.join(__dirname, 'uploads');

if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
    console.log('Pasta de uploads criada:', uploadsDir);
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname) || '.webm';
        cb(null, `${Date.now()}${ext}`);
    }
});

// Rota principal
app.get('/', (req, res) => {
    res.send('Servidor online e pronto para receber áudio!');
});

const uploadMiddleware = multer({ storage });

async function convertToWav(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
        console.log(`Iniciando conversão: ${inputPath} -> ${outputPath}`);

        const ffmpeg = spawn(ffmpegPath, [
            '-y',                 // sobrescreve se já existir
            '-i', inputPath,      // arquivo de entrada
            '-ar', '44100',       // taxa de amostragem
            '-ac', '1',           // mono
            '-f', 'wav',          // formato WAV
            outputPath
        ]);

        ffmpeg.stderr.on('data', (data) => {
            console.error(`FFmpeg stderr: ${data}`);
        });

        ffmpeg.on('close', (code) => {
            if (code === 0) {
                console.log('Conversão para WAV concluída.');
                resolve(outputPath);
            } else {
                reject(new Error(`FFmpeg falhou com código ${code}`));
            }
        });
    });
}

async function processAudio(originalPath) {
    const wavPath = originalPath.replace(path.extname(originalPath), '.wav');
    console.log(`Caminho do arquivo WAV: ${wavPath}`);

    try {
        await convertToWav(originalPath, wavPath);

        const fileBuffer = fs.readFileSync(wavPath);
        const audioData = await wavDecoder.decode(fileBuffer);

        if (!audioData.channelData || audioData.channelData.length === 0) {
            throw new Error('Nenhum dado de áudio encontrado no arquivo WAV.');
        }

        const { sampleRate, channelData } = audioData;
        const amplitudeData = channelData[0];

        // Log para depuração
        console.log('AudioData:', audioData);
        console.log('Sample Rate:', sampleRate);
        console.log('Channel Data (first channel):', amplitudeData);

        // Gerar os dados de tempo e amplitude
        const timeData = amplitudeData.map((amplitude, index) => ({
            time: index / sampleRate,
            amplitude: amplitude
        }));

        const csv = parse(timeData);
        const csvPath = path.join(uploadsDir, `${Date.now()}_audio_data.csv`);

        // Salvar o CSV
        fs.writeFileSync(csvPath, csv);
        console.log(`CSV gerado em: ${csvPath}`);

        return { wavFilePath: wavPath, csvFilePath: csvPath };

    } catch (error) {
        console.error('Erro ao processar o áudio:', error);
        throw error;
    }
}

// Rota para upload de áudio
app.post('/upload', uploadMiddleware.single('audio'), async (req, res) => {
    if (!req.file) {
        return res.status(400).send('Nenhum arquivo enviado.');
    }

    const inputPath = req.file.path;
    console.log('Arquivo recebido:', inputPath);

    try {
        const { wavFilePath, csvFilePath } = await processAudio(inputPath);

        console.log(`WAV gerado: ${wavFilePath}`);
        console.log(`CSV gerado: ${csvFilePath}`);

        res.json({
            message: 'Áudio processado com sucesso!',
            wavFile: `/uploads/${path.basename(wavFilePath)}`,
            csvFile: `/uploads/${path.basename(csvFilePath)}`
        });
    } catch (error) {
        console.error('Erro ao processar áudio:', error);
        res.status(500).send('Erro ao processar áudio.');
    }
});

app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
