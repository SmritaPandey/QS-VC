FROM node:22-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/qsvc
ENV PUPPETEER_SKIP_DOWNLOAD=true
# Dependency manifests first: `npm ci` (including the mediasoup worker) is reused from the
# Docker layer cache on every release that does not change a package.json or the lockfile.
COPY package.json package-lock.json ./
COPY services/sfu/package.json services/sfu/
COPY services/signaling/package.json services/signaling/
COPY services/auth/package.json services/auth/
COPY services/meeting/package.json services/meeting/
COPY services/recording/package.json services/recording/
COPY services/mcu/package.json services/mcu/
COPY frontend/web/package.json frontend/web/
RUN npm ci
COPY services ./services
COPY frontend/web ./frontend/web
COPY shared ./shared
COPY db ./db
COPY deploy/aws/prepare-demo-db.cjs ./deploy/aws/prepare-demo-db.cjs
# Same-origin routes are compiled into the AWS website, never the old Render URLs.
RUN printf 'VITE_API_URL=\nVITE_AUTH_URL=\nVITE_MEETING_URL=\nVITE_RECORDING_URL=\nVITE_SIGNALING_URL=\n' > frontend/web/.env.production
RUN npm run build
RUN mkdir -p /opt/qsvc/certs && node -e "fetch('https://truststore.pki.rds.amazonaws.com/ap-south-1/ap-south-1-bundle.pem').then(r=>{if(!r.ok)throw Error('RDS CA download failed');return r.text()}).then(p=>require('fs').writeFileSync('/opt/qsvc/certs/rds-ca.pem',p))"
ENV NODE_ENV=production
USER node
CMD ["node", "services/auth/dist/index.js"]

FROM nginx:alpine AS web
COPY --from=build /opt/qsvc/frontend/web/dist /usr/share/nginx/html
COPY frontend/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY frontend/web/security-headers.conf /etc/nginx/qsvc-security-headers.conf
