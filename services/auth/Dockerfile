FROM node:22-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a
WORKDIR /app
COPY services/auth/package.json ./
COPY services/auth/package-lock.json ./package-lock.json
RUN npm ci
COPY services/auth/tsconfig.json ./
COPY services/auth/src/ ./src/
COPY shared/ /shared/
RUN npm run build

FROM node:22-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a
WORKDIR /app
COPY services/auth/package.json ./
COPY services/auth/package-lock.json ./package-lock.json
RUN npm ci --omit=dev
# Latest Alpine security fixes; drop npm/yarn/corepack, which the service never uses at runtime.
RUN apk upgrade --no-cache \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn-* \
              /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg
COPY --from=0 /app/dist ./dist
COPY shared/ /shared/
EXPOSE 4002
CMD ["node", "dist/index.js"]
