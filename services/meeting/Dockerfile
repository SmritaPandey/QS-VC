# Combined meeting + signaling for production (Render)
# Build context: repository root

FROM node:20-alpine AS signaling-build
WORKDIR /signaling
COPY services/signaling/package.json ./
RUN npm install
COPY services/signaling/tsconfig.json ./
COPY services/signaling/src ./src
RUN npm run build

FROM node:20-alpine AS meeting-build
WORKDIR /meeting
COPY services/meeting/package.json ./
RUN npm install
COPY services/meeting/tsconfig.json ./
COPY services/meeting/src ./src
RUN npm run build

FROM node:20-alpine
WORKDIR /app

COPY services/meeting/package.json ./package.json
RUN npm install --omit=dev

COPY services/signaling/package.json ./signaling/package.json
RUN cd signaling && npm install --omit=dev

COPY --from=meeting-build /meeting/dist ./dist
COPY --from=signaling-build /signaling/dist ./signaling-dist

ENV HOST=0.0.0.0
ENV SIGNALING_DIST=/app/signaling-dist/ws-attach.js
EXPOSE 4003
CMD ["node", "dist/index.js"]
