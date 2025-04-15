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
const uploadsDir = path.join(__dirname, 'uploads');

// Configuração do CORS
app.use(cors());

// Middleware para servir arquivos da pasta uploads
app.use('/uploads', express.static(uploadsDir));

// Criar a pasta de uploads caso ela não exista
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
    console.log('Pasta de uploads criada:', uploadsDir);
}

// Configuração do Multer para armazenamento dos arquivos
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname) || '.webm';
        cb(null, `${Date.now()}${ext}`);
    }
});

const upload = multer({ storage });

// Função para converter o áudio para o formato WAV usando FFmpeg
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

// Rota principal
app.get('/', (req, res) => {
    res.send('Servidor online e pronto para receber áudio!');
});

// Rota de upload e processamento de áudio
app.post('/upload', upload.single('audio'), async (req, res) => {
    if (!req.file) {
        return res.status(400).send('Nenhum arquivo enviado.');
    }

    const inputPath = req.file.path;
    const wavPath = `${inputPath}.wav`;

    try {
        // Converter o arquivo para WAV
        await convertToWav(inputPath, wavPath);

        // Ler o arquivo WAV e processar os dados
        const buffer = fs.readFileSync(wavPath);
        const result = wavDecoder.decode(buffer);

        const channelData = result.channelData[0]; // mono
        const sampleRate = result.sampleRate;

        // Mapear os dados de amplitude e tempo
        const timeData = channelData.map((amplitude, index) => ({
            time: (index / sampleRate).toFixed(6),
            amplitude: amplitude.toFixed(6)
        }));

        // Gerar o CSV
        const csv = parse(timeData, { fields: ['time', 'amplitude'] });
        const csvPath = path.join(uploadsDir, `${Date.now()}_audio_data.csv`);
        fs.writeFileSync(csvPath, csv);

        console.log(`CSV gerado em: ${csvPath}`);

        // Retornar os links para download dos arquivos gerados
        res.json({
            message: 'Áudio processado com sucesso!',
            wavFile: `/uploads/${path.basename(wavPath)}`,
            csvFile: `/uploads/${path.basename(csvPath)}`
        });
    } catch (error) {
        console.error('Erro ao processar o áudio:', error);
        res.status(500).send('Erro ao processar o áudio.');
    }
});

// Iniciar o servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
