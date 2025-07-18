const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const ffmpegPath = require('ffmpeg-static');
const { execFile } = require('child_process');
const wav = require('wav');
const fft = require('fft-js').fft;
const fftUtil = require('fft-js').util;

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(cors()); // Permite requisições de qualquer origem (modifique para segurança se quiser)

// Rota para upload do áudio
app.post('/upload', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Arquivo de áudio não enviado' });
    }

    const inputPath = req.file.path;
    const wavPath = inputPath + '.wav';

    // Converter o arquivo para WAV (mono 44100Hz) usando ffmpeg
    await new Promise((resolve, reject) => {
      execFile(
        ffmpegPath,
        [
          '-i', inputPath,
          '-ac', '1',
          '-ar', '44100',
          '-f', 'wav',
          wavPath,
        ],
        (error) => {
          if (error) reject(error);
          else resolve();
        }
      );
    });

    // Ler o WAV e extrair os samples
    const samples = await new Promise((resolve, reject) => {
      const fileStream = fs.createReadStream(wavPath);
      const reader = new wav.Reader();

      let audioData = [];

      reader.on('format', function (format) {
        // console.log('Formato WAV:', format);
      });

      reader.on('data', function (chunk) {
        // chunk é um Buffer com samples PCM 16bit mono
        for (let i = 0; i < chunk.length; i += 2) {
          const sample = chunk.readInt1
