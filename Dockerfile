# Usar uma imagem base com Node.js
FROM node:16

# Instalar o Sox
RUN apt-get update && apt-get install -y sox

# Definir diretório de trabalho
WORKDIR /app

# Copiar os arquivos do projeto para o contêiner
COPY . .

# Instalar dependências do Node.js
RUN npm install

# Expor a porta do servidor
EXPOSE 10000

# Comando para iniciar o servidor
CMD ["npm", "start"]

