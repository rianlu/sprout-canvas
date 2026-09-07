FROM node:22-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY index.html ./
COPY tsconfig*.json ./
COPY vite.config.mts ./
COPY postcss.config.cjs tailwind.config.cjs ./
COPY public/ ./public/
COPY src/ ./src/
COPY shared/ ./shared/

RUN npm run build

FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0

COPY package.json ./
COPY server.mjs ./
COPY server/ ./server/
COPY shared/ ./shared/
COPY config/local.config.example.json ./config/local.config.example.json
COPY --from=build /app/dist ./dist

RUN mkdir -p logs data config

EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:8787/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.mjs"]
