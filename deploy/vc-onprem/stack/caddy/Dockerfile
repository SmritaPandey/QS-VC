FROM caddy:2.11.9-builder-alpine@sha256:646fee578e680989ca5c7fd1ce6f1de574d19fd71ef2221810cc0510a9f40c86 AS builder
# Smallstep switched to go-jose v4 and updated klauspost/compress at this revision.
RUN xcaddy build v2.11.9 \
    --replace github.com/smallstep/certificates=github.com/smallstep/certificates@v0.30.3-0.20261110090643-b0d7b2a0284e \
    --output /usr/bin/caddy

FROM caddy:2.11.9-alpine@sha256:78bd35025c7ba85961dd149ae670315129954e77abe2383ac47c89106b35ade9
RUN apk upgrade --no-cache
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
