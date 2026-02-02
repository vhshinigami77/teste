import express from 'express';
import { Worker } from 'worker_threads';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: '5mb' }));

app.post('/upload', (req, res) => {
  const { samples, sampleRate } = req.body;

  if (!samples || !sampleRate) {
    return res.status(400).json({ error: 'Dados inválidos' });
  }

  const worker = new Worker(
    path.join(__dirname, 'audioWorker.js'),
    { type: 'module' }
  );

  worker.postMessage({ samples, sampleRate });

  worker.on('message', msg => {
    res.json(msg);
    worker.terminate();
  });

  worker.on('error', err => {
    console.error(err);
    res.status(500).json({ error: 'Erro no worker' });
    worker.terminate();
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Servidor rodando na porta', PORT);
});
