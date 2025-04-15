# Usar imagem base com Node.js LTS
FROM node:16

# Atualizar e instalar ffmpeg e sox
RUN apt-get update && \
    apt-get install -y ffmpeg sox && \
    rm -rf /var/lib/apt/lists/*

# Definir diretório de trabalho
WORKDIR /app

# Copiar os arquivos do projeto para dentro do container
COPY . .

# Instalar as dependências do Node.js
RUN npm install

# Expor a porta 10000 que o backend vai escutar
EXPOSE 10000

# Comando para iniciar o servidor
CMD ["npm", "start"]
