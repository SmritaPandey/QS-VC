FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm install --ignore-scripts
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

FROM node:20-alpine
RUN apk add --no-cache python3 py3-pip make g++ linux-headers && ln -sf python3 /usr/bin/python

WORKDIR /app
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi
COPY --from=builder /app/dist ./dist

EXPOSE 4000
EXPOSE 40000-40100/udp

CMD ["node", "dist/index.js"]
