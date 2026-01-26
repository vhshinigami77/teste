import express from 'express';
import multer from 'multer';
import cors from 'cors';
import fs from 'fs';
import { Worker } from 'worker_threads';
import { execSync } from 'child_process';

const app = express();
app.use(cors());

const upload = multer({ dest: 'uploads/' });

// ==============================
// Endpoint
// ==============================
app.post('/upload', upload.single('audio'), (req, res) => {
  try {
    const inputPath = req.file.path;
    const wavPath = ${inputPath}.wav;

    // Converte para WAV mono 44.1 kHz
    execSync(ffmpeg -y -i ${inputPath} -ar 44100 -ac 1 ${wavPath});

    const buffer = fs.readFileSync(wavPath);
    const HEADER = 44;

    const samples = [];
    for (let i = HEADER; i < buffer.length; i += 2) {
      samples.push(buffer.readInt16LE(i));
    }

    // Worker Thread
    const worker = new Worker('./audioWorker.js', {
      workerData: {
        samples,
        sampleRate: 44100
      }
    });

    worker.on('message', result => {
      res.json(result);
      fs.unlinkSync(inputPath);
      fs.unlinkSync(wavPath);
    });

    worker.on('error', err => {
      console.error(err);
      res.status(500).json({ error: 'Erro no processamento' });
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro geral' });
  }
});

app.listen(3000, () => {
  console.log('Servidor rodando em http://localhost:3000');
});
