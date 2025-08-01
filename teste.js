import express from 'express';
import multer from 'multer';
import fs from 'fs';
import wav from 'node-wav';
import { execSync } from 'child_process';

const app = express();
const upload = multer({ dest: 'uploads/' });

app.post('/upload', upload.single('audio'), async (req, res) => {
  const webmPath = req.file.path;
  const wavPath = webmPath + '.wav';
  const rawPath = 'amostras.txt';

  try {
    // Convertendo WebM para WAV
    execSync(`ffmpeg -i ${webmPath} -ar 44100 -ac 1 ${wavPath}`);

    // Decodificando WAV
    const buffer = fs.readFileSync(wavPath);
    const result = wav.decode(buffer);
    const sampleRate = result.sampleRate;
    const samples = result.channelData[0];

    // Pegando os primeiros 1 segundo (janela de 44100 amostras)
    const chunkSize = sampleRate * 1;
    const chunk = samples.slice(0, chunkSize);

    // Escrevendo as amostras no arquivo
    const lines = chunk.map((x, i) => `${i / sampleRate}\t${x}`);
    fs.writeFileSync(rawPath, lines.join('\n'));

    // DFT manual com passo de 2Hz
    const N = chunk.length;
    const minFreq = 16;
    const maxFreq = 1048;
    const step = 2;

    let maxMag = 0;
    let peakIndex = -1;
    const mags = [];

    for (let f = minFreq; f <= maxFreq; f += step) {
      let re = 0, im = 0;
      for (let n = 0; n < N; n++) {
        const angle = (2 * Math.PI * f * n) / sampleRate;
        re += chunk[n] * Math.cos(angle);
        im -= chunk[n] * Math.sin(angle);
      }
      const mag = Math.sqrt(re * re + im * im);
      mags.push({ f, mag });

      if (mag > maxMag) {
        maxMag = mag;
        peakIndex = mags.length - 1;
      }
    }

    // Imprimindo os valores solicitados
    const freqPeak = minFreq + (peakIndex * step);
    console.log(`maxMag = ${maxMag}`);
    console.log(`peakIndex = ${peakIndex}`);
    console.log(`frequência correspondente = ${freqPeak} Hz`);

    // Escrevendo resultado (sem interpolação)
    fs.writeFileSync('resultado_saida.txt', `${freqPeak}\t${maxMag}`);

    // Executa o código C++ compilado que gera nota.txt
    execSync('./detecta_nota');

    const nota = fs.readFileSync('nota.txt', 'utf-8').trim();

    res.json({
      dominantFrequency: freqPeak,
      dominantNote: nota
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao processar o áudio' });
  } finally {
    // Limpeza de arquivos
    fs.unlinkSync(webmPath);
    if (fs.existsSync(wavPath)) fs.unlinkSync(wavPath);
  }
});

app.listen(3000, () => {
  console.log('Servidor rodando na porta 3000');
});
