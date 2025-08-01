// Importação dos módulos necessários
import express from 'express'; // Framework web para Node.js
import multer from 'multer'; // Middleware para lidar com uploads multipart/form-data
import fs from 'fs'; // Módulo para manipular o sistema de arquivos
import path from 'path'; // Utilitário para lidar com caminhos de arquivos
import cors from 'cors'; // Middleware para permitir requisições CORS (entre domínios diferentes)
import { execSync } from 'child_process'; // Permite executar comandos no terminal
import { fileURLToPath } from 'url'; // Necessário para usar __dirname com módulos ES

// Criação do app Express
const app = express();
app.use(cors()); // Habilita CORS para permitir chamadas do front-end (outro domínio)

// Configura o multer para salvar arquivos enviados na pasta 'uploads'
const upload = multer({ dest: 'uploads/' });

// Define __filename e __dirname para uso com ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ========================
// Função: frequencyToNote
// ========================
// Converte uma frequência (Hz) em uma nota musical (ex: 440 Hz => A4)
function frequencyToNote(freq) {
  if (!freq || freq <= 0 || isNaN(freq)) return 'PAUSA'; // Caso inválido

  const A4 = 440; // Frequência padrão da nota Lá 4 (A4)
  const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']; // Notas musicais
  const semitones = Math.round(12 * Math.log2(freq / A4)); // Distância em semitons
  const noteIndex = (semitones + 9 + 12 * 10) % 12; // Corrige para índice válido
  const octave = 4 + Math.floor((semitones + 9) / 12); // Calcula a oitava
  return `${NOTES[noteIndex]}${octave}`;
}

// Serve arquivos estáticos (por exemplo, HTML do front-end)
app.use(express.static('public'));

// ======================
// Rota: POST /upload
// ======================
// Recebe o áudio enviado do front-end, converte e processa
app.post('/upload', upload.single('audio'), async (req, res) => {
  try {
    const inputPath = req.file.path; // Caminho temporário do arquivo enviado (formato .webm)
    const outputPath = `${inputPath}.wav`; // Caminho de saída após conversão

    // Converte o áudio usando FFmpeg para WAV, mono, 44.1 kHz
    execSync(`ffmpeg -i ${inputPath} -ar 44100 -ac 1 ${outputPath}`);

    // Lê os dados binários do arquivo WAV
    const buffer = fs.readFileSync(outputPath);
    const headerSize = 44; // Cabeçalho WAV tem 44 bytes
    const sampleRate = 44100; // Taxa de amostragem usada
    const int16Samples = [];

    // Extrai amostras de 16 bits a partir dos dados brutos
    for (let i = headerSize; i < buffer.length; i += 2) {
      const sample = buffer.readInt16LE(i); // Lê 2 bytes (Little Endian)
      int16Samples.push(sample);
    }

    // ========================
    // Parâmetros do DFT manual
    // ========================
    const windowSize = sampleRate; // Janela de 1 segundo
    const N = Math.min(windowSize, int16Samples.length); // Usa até 1s de áudio
    const freqStep = 2; // Resolução de 2 Hz
    const minFreq = 16;
    const maxFreq = 1048;

    const spectrum = []; // Guarda o espectro de frequência
    let maxMag = 0;      // Maior magnitude encontrada
    let peakFreq = 0;    // Frequência correspondente à maior magnitude
    let peakIndex = -1;  // Índice da frequência dominante

    // Loop sobre as frequências de interesse (DFT manual)
    for (let i = 0, freq = minFreq; freq <= maxFreq; freq += freqStep, i++) {
      let real = 0;
      let imag = 0;

      // Soma os termos da DFT para cada frequência
      for (let n = 0; n < N; n++) {
        const angle = (2 * Math.PI * freq * n) / sampleRate;
        real += int16Samples[n] * Math.cos(angle);
        imag -= int16Samples[n] * Math.sin(angle);
      }

      const magnitude = Math.sqrt(real * real + imag * imag); // Calcula módulo
      spectrum.push({ freq, magnitude }); // Salva no espectro

      // Verifica se esta frequência é a dominante
      if (magnitude > maxMag) {
        maxMag = magnitude;
        peakFreq = freq;
        peakIndex = i;
      }
    }

    const frequencyFromIndex = minFreq + peakIndex * freqStep; // Frequência estimada pelo índice
    const note = frequencyToNote(peakFreq); // Converte frequência em nota

    // ==================
    // LOGS NO TERMINAL
    // ==================
    console.log('============================');
    console.log(`maxMag: ${maxMag.toFixed(2)}`);
    console.log(`peakIndex: ${peakIndex}`);
    console.log(`frequencyFromIndex: ${frequencyFromIndex.toFixed(2)} Hz`);
    console.log(`dominantFrequency: ${peakFreq.toFixed(2)} Hz`);
    console.log(`dominantNote: ${note}`);
    console.log('============================');

    // Envia resposta JSON para o front-end
    res.json({
      dominantFrequency: peakFreq,
      dominantNote: note
    });

    // Remove os arquivos temporários
    fs.unlinkSync(inputPath);
    fs.unlinkSync(outputPath);
  } catch (err) {
    // Em caso de erro, envia erro para o cliente e mostra no console
    console.error('Erro:', err);
    res.status(500).json({ error: 'Erro na análise do áudio.' });
  }
});

// ==========================
// Inicializa o servidor
// ==========================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
