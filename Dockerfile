# Robô do Painel da Loja — versão para rodar no Google Cloud (São Paulo)
FROM mcr.microsoft.com/playwright:v1.47.2-jammy
WORKDIR /app
COPY package.json ./
RUN npm install
COPY coletar.mjs ./
CMD ["node", "coletar.mjs"]
