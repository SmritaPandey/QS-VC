FROM node:22-alpine
WORKDIR /app
COPY services/recording/package.json ./
COPY services/recording/package-lock.json ./package-lock.json
RUN npm ci
COPY services/recording/tsconfig.json ./
COPY services/recording/src/ ./src/
COPY shared/entitlements.cjs shared/entitlements.d.cts /shared/
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY services/recording/package.json ./
COPY services/recording/package-lock.json ./package-lock.json
RUN npm ci --omit=dev
COPY --from=0 /app/dist ./dist
COPY shared/entitlements.cjs /shared/

EXPOSE 4004
CMD ["node", "dist/index.js"]
