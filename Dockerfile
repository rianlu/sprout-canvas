# Pinned by digest so every build uses the same Node; bump it deliberately to update.
ARG NODE_IMAGE=node:22-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914
# `build` compiles the frontend in the image (CI and local checks). `prebuilt` takes an existing dist/
# from the context, so scripts/deploy.sh can assemble the image on a small server without npm.
ARG FRONTEND=build

FROM ${NODE_IMAGE} AS build
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

FROM ${NODE_IMAGE} AS prebuilt
WORKDIR /app
COPY dist/ ./dist/
RUN test -f dist/index.html

FROM ${FRONTEND} AS frontend

FROM ${NODE_IMAGE}
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0

# Application files stay root-owned and read-only to the service user.
COPY package.json ./
COPY server.mjs ./
COPY server/ ./server/
COPY shared/ ./shared/
COPY config/local.config.example.json ./config/local.config.example.json
COPY --from=frontend /app/dist ./dist
RUN install -d -m 0700 -o node -g node data logs

USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:8787/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.mjs"]

# Last, so a new revision only changes image metadata and every layer above stays cached.
ARG REVISION=unknown
LABEL org.opencontainers.image.source="https://github.com/rianlu/sprout-canvas" \
      org.opencontainers.image.revision="$REVISION"
