# SFU image: build on Debian, ship on a distroless glibc base.
#
# Why distroless: the Debian slim runtime carried ~58 High findings that Debian marks
# "won't fix" (packages such as perl, apt, bash, util-linux and systemd libraries that
# the SFU never uses). The SFU only needs glibc, libstdc++ and libgcc (for the Node
# binary and the prebuilt mediasoup worker, which requires GLIBC_2.34+) plus CA
# certificates. gcr.io/distroless/cc-debian12 contains exactly those, no shell and no
# package manager.
#
# mediasoup ships a prebuilt worker only for glibc Linux (Alpine/musl would compile
# ~1400 C++ files and fails on its bundled libwebrtc). Keep SFU_BUILD_BASE and
# SFU_RUNTIME_BASE on the SAME Debian release so a worker compiled from source in the
# builder (fallback path) runs on the runtime's glibc.
#
# Release builds MUST pass both bases pinned by digest (see compose.offline.yml and
# docs/onprem/RELEASE_CHECKLIST.md). The package script refuses unpinned bases.

ARG SFU_BUILD_BASE=node:22-bookworm-slim
ARG SFU_RUNTIME_BASE=gcr.io/distroless/cc-debian12:nonroot

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
# Fail the build early if the worker or Node need a library the distroless runtime lacks.
RUN set -e; \
    worker=node_modules/mediasoup/worker/out/Release/mediasoup-worker; \
    test -x "$worker"; \
    for bin in "$worker" /usr/local/bin/node; do \
      ldd "$bin" | awk '/=>/ {print $1}' | while read -r lib; do \
        case "$lib" in libc.so.6|libm.so.6|libdl.so.2|libpthread.so.0|librt.so.1|libstdc++.so.6|libgcc_s.so.1) ;; \
          *) echo "Unexpected runtime library $lib for $bin" >&2; exit 1;; esac; \
      done; \
    done

FROM ${SFU_RUNTIME_BASE}
# Node runtime only (no npm, npx, corepack or yarn).
COPY --from=builder /usr/local/bin/node /usr/local/bin/node
ENV PATH=/usr/local/bin:/usr/bin:/bin \
    NODE_ENV=production
WORKDIR /app
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
# distroless "nonroot" user (uid/gid 65532). No shell exists in this image, so the
# compose health check must keep using the exec form with node.
USER 65532:65532

EXPOSE 4000
EXPOSE 40000-40100/udp

ENTRYPOINT ["/usr/local/bin/node"]
CMD ["dist/index.js"]
