FROM node:20-alpine
WORKDIR /app
COPY services/auth/package.json ./
RUN npm install
COPY services/auth/tsconfig.json ./
COPY services/auth/src/ ./src/
COPY shared/database.cjs shared/database.d.cts /shared/
COPY shared/jwt-secret.cjs shared/jwt-secret.d.cts /shared/
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY services/auth/package.json ./
RUN npm install --omit=dev
COPY --from=0 /app/dist ./dist
COPY shared/database.cjs /shared/database.cjs

COPY shared/jwt-secret.cjs /shared/
EXPOSE 4002
CMD ["node", "dist/index.js"]
