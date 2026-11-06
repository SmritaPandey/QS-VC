FROM node:20-alpine
WORKDIR /app
COPY services/recording/package.json ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY services/recording/tsconfig.json ./
COPY services/recording/src/ ./src/
COPY shared/entitlements.cjs shared/entitlements.d.cts /shared/
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY services/recording/package.json ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi
COPY --from=0 /app/dist ./dist
COPY shared/entitlements.cjs /shared/

EXPOSE 4004
CMD ["node", "dist/index.js"]
