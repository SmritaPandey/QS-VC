FROM golang:1.27.3-alpine@sha256:fa3d596898d9f126af7c01d14ee7597bab3f39cccf392ef36b69fe77cd681f18 AS builder
RUN CGO_ENABLED=0 GOBIN=/out go install github.com/tianon/gosu@6456aaa0f3c854d199d0f037f068eb97515b7513

FROM postgres:16-alpine@sha256:f377d590e5474681d4d7838635031a2b50647923b7abfa803ce9b5ff35d5c663
RUN apk upgrade --no-cache
COPY --from=builder /out/gosu /usr/local/bin/gosu
