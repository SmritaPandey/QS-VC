# Combined meeting + signaling for production (Render)
# Build context: repository root

FROM node:22-alpine AS signaling-build
WORKDIR /signaling
COPY services/signaling/package.json ./
COPY services/signaling/package-lock.json ./package-lock.json
RUN npm ci
COPY services/signaling/tsconfig.json ./
COPY services/signaling/src ./src
COPY shared/ /shared/
RUN npm run build

FROM node:22-alpine AS meeting-build
WORKDIR /meeting
COPY services/meeting/package.json ./
COPY services/meeting/package-lock.json ./package-lock.json
RUN npm ci
COPY services/meeting/tsconfig.json ./
COPY services/meeting/src ./src
COPY shared/ /shared/
RUN npm run build

FROM node:22-alpine
WORKDIR /app

COPY services/meeting/package.json ./package.json
COPY services/meeting/package-lock.json ./package-lock.json
RUN npm ci --omit=dev

COPY services/signaling/package.json ./signaling/package.json
COPY services/signaling/package-lock.json ./signaling/package-lock.json
RUN cd signaling && npm ci --omit=dev
# Latest Alpine security fixes; drop npm/yarn/corepack, which the service never uses at runtime.
RUN apk upgrade --no-cache \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn-* \
              /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg

COPY --from=meeting-build /meeting/dist ./dist
COPY --from=signaling-build /signaling/dist ./signaling/dist
COPY shared/ /shared/

ENV HOST=0.0.0.0
ENV SIGNALING_DIST=/app/signaling/dist/ws-attach.js
EXPOSE 4003
CMD ["node", "dist/index.js"]
