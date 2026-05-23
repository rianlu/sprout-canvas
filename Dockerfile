FROM node:22-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY index.html ./
COPY tsconfig*.json ./
COPY vite.config.mts ./
COPY src/ ./src/
COPY js/ ./js/
COPY css/ ./css/
COPY server.mjs ./
COPY server/ ./server/

RUN npm run build

FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json ./
COPY server.mjs ./
COPY server/ ./server/
COPY js/ ./js/
COPY css/ ./css/
COPY config/local.config.example.json ./config/local.config.example.json
COPY --from=build /app/dist ./dist

RUN mkdir -p logs output config

EXPOSE 8787

CMD ["node", "server.mjs"]
