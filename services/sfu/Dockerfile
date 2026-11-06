# mediasoup ships a prebuilt worker only for glibc Linux. On Alpine (musl) it compiles ~1400 C++ files
# from source, and Alpine's newer GCC fails on mediasoup's bundled libwebrtc (missing <cstdint>).
# Debian slim downloads the prebuilt worker; the toolchain stays as a fallback if that download fails.
# Node 22: the SFU lockfile's mediasoup 3.32 requires Node >= 22.
FROM node:22-bookworm-slim AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

FROM node:22-bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist

EXPOSE 4000
EXPOSE 40000-40100/udp

CMD ["node", "dist/index.js"]
