const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors'); // Importar o pacote CORS
const app = express();

// Habilitar CORS para permitir acesso do frontend
app.use(cors());

// Configurar o Multer para salvar os arquivos na pasta "uploads"
const upload = multer({
    dest: 'uploads/', // Diretório onde os arquivos serão salvos
});

// Certifique-se de que a pasta "uploads" existe no servidor
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);  // Cria a pasta uploads se não existir
}

// Rota para upload do áudio
app.post('/upload', upload.single('audio'), (req, res) => {
    console.log('Arquivo recebido:', req.file); // Logar o arquivo recebido
    if (!req.file) {
        return res.status(400).send('Nenhum arquivo enviado.');
    }

    const fileName = req.file.filename; // Nome gerado automaticamente pelo multer
    console.log(`Áudio gravado: ${fileName}`);
    res.send({ message: 'Áudio recebido com sucesso!', file: fileName });
});

// Rota para acessar os arquivos gravados
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Iniciar o servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
