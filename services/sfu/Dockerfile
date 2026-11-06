# mediasoup ships a prebuilt worker only for glibc Linux. On Alpine (musl) it compiles ~1400 C++ files
# from source, and Alpine's newer GCC fails on mediasoup's bundled libwebrtc (missing <cstdint>).
# Node 22: the SFU lockfile's mediasoup 3.32 requires Node >= 22.
#
# Two stages so the shipped image has no compiler, Python or npm (smaller, and nothing for the
# image vulnerability scan to flag): the builder installs dependencies (downloading or, as a
# fallback, compiling the mediasoup worker) and compiles TypeScript; the runtime copies the results.

FROM node:22-bookworm-slim AS builder
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
# Latest Debian security updates; drop npm/yarn/corepack, which the service never uses at runtime.
RUN apt-get update \
    && apt-get upgrade -y --no-install-recommends \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn-* \
              /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg
WORKDIR /app
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
USER node

EXPOSE 4000
EXPOSE 40000-40100/udp

CMD ["node", "dist/index.js"]
