FROM node:22-bookworm-slim AS sfu-build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY services/sfu/package*.json ./
RUN npm ci
COPY services/sfu/tsconfig.json ./
COPY services/sfu/src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim AS bridge-build
WORKDIR /poly
COPY deploy/poly-bridge/package*.json ./
RUN npm ci --ignore-scripts
COPY deploy/poly-bridge/tsconfig.json ./
COPY deploy/poly-bridge/src ./src
RUN npm run build && npm prune --omit=dev --ignore-scripts && rm -rf node_modules/mediasoup

FROM node:22-bookworm-slim
RUN apt-get update && apt-get upgrade -y --no-install-recommends && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=sfu-build /app/package.json ./package.json
COPY --from=sfu-build /app/node_modules ./node_modules
COPY --from=sfu-build /app/dist ./dist
COPY --from=bridge-build /poly /poly
ENV POLY_BRIDGE_MODULE=/poly/dist/index.js
USER node
CMD ["node", "dist/index.js"]
