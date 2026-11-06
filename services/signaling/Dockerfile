FROM node:20-alpine

WORKDIR /app
COPY services/signaling/package.json ./
RUN npm install
COPY services/signaling/tsconfig.json ./
COPY services/signaling/src/ ./src/
COPY shared/ /shared/
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY services/signaling/package.json ./
RUN npm install --omit=dev
COPY --from=0 /app/dist ./dist

ENV HOST=0.0.0.0
COPY shared/ /shared/
EXPOSE 4001
CMD ["node", "dist/index.js"]
