import express from 'express';
import multer from 'multer';
import cors from 'cors';
import fs from 'fs';
import { Worker } from 'worker_threads';
import { execSync } from 'child_process';

/* =====================================================
   Inicialização do servidor
===================================================== */
const app = express();
app.use(cors());

/* =====================================================
   Configuração do upload (arquivos temporários)
===================================================== */
const upload = multer({ dest: 'uploads/' });

/* =====================================================
   Endpoint principal de análise de áudio
===================================================== */
app.post('/upload', upload.single('audio'), (req, res) => {
  try {

    // Arquivo não enviado
    if (!req.file) {
      return res.status(400).json({ error: 'Arquivo não enviado' });
    }

    const inputPath = req.file.path;
    const wavPath = `${inputPath}.wav`;

    /* -----------------------------------------------
       Conversão para WAV PCM mono 44.1kHz
       Garante formato previsível para FFT
    ----------------------------------------------- */
    execSync(
      `ffmpeg -y -i "${inputPath}" -ar 44100 -ac 1 "${wavPath}"`,
      { stdio: 'ignore' }
    );

    /* -----------------------------------------------
       Leitura do WAV e extração de PCM (Int16)
    ----------------------------------------------- */
    const buffer = fs.readFileSync(wavPath);
    const HEADER = 44; // cabeçalho WAV padrão

    const samples = [];
    for (let i = HEADER; i < buffer.length; i += 2) {
      samples.push(buffer.readInt16LE(i));
    }

    /* -----------------------------------------------
       Worker Thread para DSP pesado
    ----------------------------------------------- */
    const worker = new Worker('./audioWorker.js', {
      workerData: {
        samples,
        sampleRate: 44100
      }
    });

    /* -----------------------------------------------
       Resposta do worker
    ----------------------------------------------- */
    worker.on('message', result => {
      res.json(result);

      // limpeza dos arquivos temporários
      fs.unlinkSync(inputPath);
      fs.unlinkSync(wavPath);
    });

    /* -----------------------------------------------
       Erros no worker
    ----------------------------------------------- */
    worker.on('error', err => {
      console.error(err);
      res.status(500).json({ error: 'Erro no processamento do áudio' });
    });

    worker.on('exit', code => {
      if (code !== 0) {
        console.error(`Worker finalizou com código ${code}`);
      }
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro geral no servidor' });
  }
});

/* =====================================================
   Inicialização do servidor HTTP
===================================================== */
app.listen(3000, () => {
  console.log('Servidor rodando em http://localhost:3000');
});
