# SFU image: build on Debian, ship on a minimal glibc runtime that already contains Node.
#
# History: the Debian slim runtime carried ~58 High "won't fix" findings; distroless
# cc-debian12 still carried 13 won't-fix glibc/GCC-runtime findings plus an outdated libssl3.
# The default runtime is now Chainguard's Wolfi-based Node image (glibc, rebuilt quickly
# when fixes land, no shell or package manager). The prebuilt mediasoup worker needs only
# glibc 2.34+, libstdc++ and libgcc, which that image provides because Node itself needs them.
#
# mediasoup ships a prebuilt worker only for glibc Linux (Alpine/musl would compile ~1400
# C++ files and fails on its bundled libwebrtc). The builder's glibc must not be newer than
# the runtime's (bookworm 2.36 <= Wolfi), so a worker compiled from source still runs.
#
# Release builds MUST pass both bases pinned by digest (see compose.offline.yml and
# docs/onprem/RELEASE_CHECKLIST.md). The package script refuses unpinned bases.

ARG SFU_BUILD_BASE=node:22-bookworm-slim
ARG SFU_RUNTIME_BASE=cgr.dev/chainguard/node:latest

FROM ${SFU_BUILD_BASE} AS builder
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build && npm prune --omit=dev
# Fail the build early if the worker needs a library beyond glibc, libstdc++ and libgcc.
RUN set -e; \
    worker=node_modules/mediasoup/worker/out/Release/mediasoup-worker; \
    test -x "$worker"; \
    for bin in "$worker"; do \
      ldd "$bin" | awk '/=>/ {print $1}' | while read -r lib; do \
        case "$lib" in libc.so.6|libm.so.6|libdl.so.2|libpthread.so.0|librt.so.1|libstdc++.so.6|libgcc_s.so.1) ;; \
          *) echo "Unexpected runtime library $lib for $bin" >&2; exit 1;; esac; \
      done; \
    done

FROM ${SFU_RUNTIME_BASE}
# The runtime image provides Node (no npm, shell or package manager is needed or shipped).
ENV PATH=/usr/bin:/usr/local/bin:/bin:/nodejs/bin \
    NODE_ENV=production
WORKDIR /app
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
# Non-root user (uid/gid 65532 in Chainguard and distroless images). No shell exists, so the
# compose health check must keep using the exec form with node.
USER 65532:65532

EXPOSE 4000
EXPOSE 40000-40100/udp

ENTRYPOINT ["node"]
CMD ["dist/index.js"]
