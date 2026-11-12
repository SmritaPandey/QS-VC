FROM node:22-alpine AS builder

WORKDIR /app
COPY frontend/web/package.json ./
COPY frontend/web/package-lock.json ./package-lock.json
RUN npm ci
RUN ln -s /app/node_modules /node_modules
COPY frontend/web/tsconfig.json ./
COPY frontend/web/vite.config.ts ./
COPY frontend/web/index.html ./
COPY frontend/web/src/ ./src/
COPY frontend/web/public/ ./public/
COPY shared/ /shared/
ARG VITE_DEPLOYMENT
RUN VITE_DEPLOYMENT="$VITE_DEPLOYMENT" npx vite build

FROM nginx:alpine AS runtime
# Latest Alpine security fixes for the static web server image.
RUN apk upgrade --no-cache
COPY --from=builder /app/dist /usr/share/nginx/html
COPY frontend/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY frontend/web/security-headers.conf /etc/nginx/qsvc-security-headers.conf
EXPOSE 5173
CMD ["nginx", "-g", "daemon off;"]
