const express = require('express');
const multer = require('multer');
const path = require('path');
const app = express();

// Configuração do Multer para armazenar os arquivos
const upload = multer({ dest: 'uploads/' });

// Rota para upload do áudio
app.post('/upload', upload.single('audio'), (req, res) => {
    const fileName = req.file.filename; // Nome do arquivo gravado
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
