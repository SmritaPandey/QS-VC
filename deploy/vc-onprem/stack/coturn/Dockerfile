# TURN relay for the on-prem package, built from source WITHOUT any database backend.
#
# QS-VC runs coturn with --use-auth-secret and a static shared secret (deploy/turn/start.sh),
# so it never reads a user database. The upstream coturn image links SQLite, PostgreSQL,
# MariaDB, MongoDB, hiredis and libmicrohttpd and ships bash and bind-tools; the High
# SQLite findings came from those unused libraries. This build links only OpenSSL and
# libevent and the build fails if any database library is linked.
#
# Release builds MUST pin ALPINE_IMAGE by digest (package-intranet-images.sh refuses an
# unpinned FROM). COTURN_COMMIT pins the exact source revision of the tag.

ARG ALPINE_IMAGE=alpine:3.24

FROM ${ALPINE_IMAGE} AS build
ARG COTURN_VERSION=4.19.0
ARG COTURN_COMMIT=c47119ad849b3eef9fffc58e58293e7a61125900
RUN apk add --no-cache build-base linux-headers git pax-utils libevent-dev openssl-dev
WORKDIR /src
RUN git init -q \
 && git remote add origin https://github.com/coturn/coturn.git \
 && git fetch -q --depth 1 origin "refs/tags/${COTURN_VERSION}" \
 && git checkout -q FETCH_HEAD \
 && test "$(git rev-parse HEAD)" = "${COTURN_COMMIT}"
ENV TURN_NO_SQLITE=1 TURN_NO_PQ=1 TURN_NO_MYSQL=1 TURN_NO_MONGO=1 TURN_NO_HIREDIS=1 \
    TURN_NO_PROMETHEUS=1 TURN_NO_SYSTEMD=1
RUN ./configure --prefix=/usr --sysconfdir=/etc/coturn --turndbdir=/var/lib/coturn --disable-rpath \
 && make -j"$(nproc)" bin/turnserver \
 && mkdir -p /out/usr/bin /out/usr/share/licenses/coturn \
 && install -m 0755 bin/turnserver /out/usr/bin/turnserver \
 && install -m 0644 LICENSE /out/usr/share/licenses/coturn/LICENSE \
 && if scanelf --needed --nobanner --format '%n#p' /out/usr/bin/turnserver | tr ',' '\n' \
        | grep -Ei 'sqlite|libpq|mariadb|mysql|mongoc|bson|hiredis|microhttpd|prom'; then \
      echo 'turnserver must not link a database or metrics library' >&2; exit 1; fi \
 && scanelf --needed --nobanner --format '%n#p' /out/usr/bin/turnserver | tr ',' '\n' \
      | sed '/^$/d; s/^/so:/' | sort -u > /out/run-deps

FROM ${ALPINE_IMAGE}
COPY --from=build /out/run-deps /tmp/run-deps
RUN apk upgrade --no-cache \
 && apk add --no-cache ca-certificates $(cat /tmp/run-deps) \
 && rm -f /tmp/run-deps \
 && ! apk info -e sqlite-libs \
 && mkdir -p /etc/coturn /var/lib/coturn \
 && chown nobody:nogroup /var/lib/coturn
COPY --from=build /out/usr/ /usr/
USER nobody:nogroup
EXPOSE 3478 3478/udp
ENTRYPOINT ["turnserver"]
