FROM node:22-alpine
WORKDIR /app
COPY services/auth/package.json ./
COPY services/auth/package-lock.json ./package-lock.json
RUN npm ci
COPY services/auth/tsconfig.json ./
COPY services/auth/src/ ./src/
COPY shared/ /shared/
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY services/auth/package.json ./
COPY services/auth/package-lock.json ./package-lock.json
RUN npm ci --omit=dev
COPY --from=0 /app/dist ./dist
COPY shared/ /shared/
EXPOSE 4002
CMD ["node", "dist/index.js"]
