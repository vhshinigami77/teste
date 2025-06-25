const express = require('express');           // Framework web para criar o servidor
const multer = require('multer');             // Middleware para upload de arquivos multipart/form-data
const path = require('path');                 // Utilitário para manipulação de caminhos de arquivos
const fs = require('fs');                     // Módulo para manipulação do sistema de arquivos
const wav = require('wav');                   // Biblioteca para leitura de arquivos WAV em stream
const { spawn } = require('child_process');  // Para executar processos externos (aqui: ffmpeg)
const ffmpegPath = require('ffmpeg-static'); // Caminho estático para o binário ffmpeg
const cors = require('cors');                 // Middleware para habilitar CORS (cross-origin requests)

const app = express();

// Diretório onde os arquivos enviados e gerados serão salvos
const uploadsDir = path.join(__dirname, 'uploads');

// Cria a pasta uploads se ela não existir
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
  console.log('Pasta de uploads criada:', uploadsDir);
}

// Configuração do armazenamento do multer
const storage = multer.diskStorage({
  // Define o destino do arquivo no disco
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  // Define o nome do arquivo com timestamp e extensão original
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}${path.extname(file.originalname)}`);
  }
});

const upload = multer({ storage }); // Instancia o multer com essa configuração

app.use(cors());                     // Permite requisições de qualquer origem
app.use('/uploads', express.static(uploadsDir)); // Expõe a pasta uploads para download via URL

// Rota POST para upload de arquivo áudio
app.post('/upload', upload.single('audio'), async (req, res) => {
  // Validação simples: se não recebeu arquivo, retorna erro 400
  if (!req.file) {
    return res.status(400).send('Nenhum arquivo enviado.');
  }

  // Caminho completo do arquivo enviado
  const inputPath = req.file.path;
  // Definimos o caminho do arquivo WAV que será gerado após conversão
  const wavPath = `${inputPath}.wav`;
  // Caminho para o arquivo TXT com os dados extraídos
  const txtPath = `${inputPath}_audio_data.txt`;

  try {
    console.log('Iniciando conversão para WAV...');
    // Executa a conversão do arquivo original para WAV (mono, 44.1 kHz)
    await convertToWav(inputPath, wavPath);
    console.log('Arquivo WAV gerado:', wavPath);

    // Processa o arquivo WAV para extrair dados de tempo e amplitude
    const timeData = await processAudio(wavPath);
    console.log('Dados extraídos:', timeData.length);

    // Mapeia os dados extraídos para uma string com tabulação entre tempo e amplitude
    const lines = timeData.map(({ time, amplitude }) => `${time}\t${amplitude}`);
    // Salva os dados no arquivo TXT
    fs.writeFileSync(txtPath, lines.join('\n'));
    console.log('Arquivo TXT gerado:', txtPath);

    // Retorna para o cliente a URL para download do arquivo TXT gerado
    res.json({
      downloadUrl: `/uploads/${path.basename(txtPath)}`,
      filename: path.basename(txtPath)
    });
  } catch (error) {
    // Em caso de erro, loga e retorna status 500
    console.error('Erro ao processar o áudio:', error);
    res.status(500).send('Erro ao processar o áudio.');
  }
});

// Função para converter qualquer áudio recebido para WAV mono 44.1kHz usando ffmpeg
async function convertToWav(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    // Executa ffmpeg com os parâmetros para conversão e sobrescrita (-y)
    const ffmpeg = spawn(ffmpegPath, [
      '-y',
      '-i', inputPath,   // arquivo de entrada
      '-ar', '44100',    // sample rate 44.1 kHz
      '-ac', '1',        // canal mono
      '-f', 'wav',       // formato WAV
      outputPath         // arquivo de saída
    ]);

    // Mostra logs do ffmpeg (stderr)
    ffmpeg.stderr.on('data', (data) => {
      console.error(`FFmpeg stderr: ${data}`);
    });

    // Quando o processo terminar, verifica o código de saída para resolver ou rejeitar a Promise
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

// Função para processar o arquivo WAV e extrair os dados de tempo e amplitude
async function processAudio(wavPath) {
  return new Promise((resolve, reject) => {
    // Cria um stream de leitura para o arquivo WAV
    const fileStream = fs.createReadStream(wavPath);
    // Instancia o leitor WAV
    const reader = new wav.Reader();

    let sampleRate;       // Para armazenar sample rate do WAV
    let timeData = [];    // Array para armazenar os dados de saída
    let sampleIndex = 0;  // Índice do sample para cálculo do tempo

    // Quando o cabeçalho do WAV for lido, captura o formato
    reader.on('format', (format) => {
      sampleRate = format.sampleRate;
      // Aviso se o áudio não for mono
      if (format.channels !== 1) {
        console.warn('Aviso: arquivo WAV não é mono. Será usado somente o primeiro canal.');
      }
    });

    // Cada 'data' emitido é um Buffer contendo samples PCM 16-bit assinados little-endian
    reader.on('data', (chunk) => {
      // Itera de 2 em 2 bytes para ler cada sample 16-bit
      for (let i = 0; i < chunk.length; i += 2) {
        // Lê o sample como inteiro 16-bit little-endian
        let sample = chunk.readInt16LE(i);
        // Normaliza a amplitude para o intervalo -1 a 1
        let amplitude = sample / 32768;
        // Calcula o tempo do sample atual em segundos
        let time = sampleIndex / sampleRate;
        // Adiciona ao array de dados (com 6 casas decimais para legibilidade)
        timeData.push({
          time: time.toFixed(6),
          amplitude: amplitude.toFixed(6)
        });
        sampleIndex++;
      }
    });

    // Quando terminar de ler o arquivo, resolve a Promise com os dados extraídos
    reader.on('end', () => {
      resolve(timeData);
    });

    // Tratamento de erros
    reader.on('error', (err) => {
      reject(err);
    });

    // Inicia o pipe do arquivo para o leitor WAV
    fileStream.pipe(reader);
  });
}

// Inicializa o servidor Express na porta definida pela variável de ambiente ou 3000
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
