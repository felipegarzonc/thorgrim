# AoS Coach — production image. The army data (BSData) and the web app are
# built into the image; lists, games, uploaded books and the saved API key
# live in /data, which must be a persistent disk.
FROM node:22-slim

WORKDIR /app
ENV NODE_ENV=development
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
# Optional override of where the army data is downloaded from (testing).
ARG BSDATA_TARBALL_URL=""
RUN npm run data && npm run build

ENV NODE_ENV=production \
    PORT=8787 \
    STORAGE_DIR=/data \
    PUBLIC=1
EXPOSE 8787
CMD ["npx", "tsx", "server/index.ts"]
