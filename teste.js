import express from 'express';
import cors from 'cors';
import { Worker } from 'worker_threads';

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

const worker = new Worker('./audioWorker.js');
let responseQueue = [];

worker.on('message', msg => {
  const res = responseQueue.shift();
  if (res) res.json(msg);
});

app.post('/upload', (req, res) => {
  const { samples, sampleRate } = req.body;

  if (!samples || samples.length < 1024) {
    return res.json({ note:'PAUSA', frequency:0, intensity:0 });
  }

  const int16 = samples.map(v =>
    Math.max(-1, Math.min(1, v)) * 32767
  );

  responseQueue.push(res);

  worker.postMessage({
    samples: int16,
    sampleRate
  });
});

app.listen(3000, () =>
  console.log('Servidor rodando em http://localhost:3000')
);
