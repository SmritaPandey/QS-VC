FROM node:20-alpine AS builder

WORKDIR /app
COPY frontend/web/package.json ./
COPY frontend/web/package-lock.json ./package-lock.json
RUN npm ci
RUN ln -s /app/node_modules /node_modules
COPY frontend/web/tsconfig.json ./
COPY frontend/web/vite.config.ts ./
COPY frontend/web/index.html ./
COPY frontend/web/src/ ./src/
COPY shared/ /shared/
RUN npx vite build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY frontend/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 5173
CMD ["nginx", "-g", "daemon off;"]
