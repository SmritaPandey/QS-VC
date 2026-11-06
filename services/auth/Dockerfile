FROM node:20-alpine
WORKDIR /app
COPY services/auth/package.json ./
RUN npm install
COPY services/auth/tsconfig.json ./
COPY services/auth/src/ ./src/
COPY shared/ /shared/
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY services/auth/package.json ./
RUN npm install --omit=dev
COPY --from=0 /app/dist ./dist
COPY shared/ /shared/
EXPOSE 4002
CMD ["node", "dist/index.js"]
