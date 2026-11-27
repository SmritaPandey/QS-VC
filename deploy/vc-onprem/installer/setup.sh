#!/usr/bin/env bash
# QS-VC Server Setup — guided installer for the on-premises server (hub).
#
# Runs from the self-extracting qsvc-server-setup-<version>.run. Everything it needs is in
# this directory: the signed server package, a bundled OpenSSL 3.5 (to verify the ML-DSA-65
# signature on hosts whose OpenSSL cannot), docker-compose, and the release public keys.
#
#   sudo ./qsvc-server-setup-<version>.run                 # guided wizard
#   sudo ./qsvc-server-setup-<version>.run -- --silent --answers /root/qsvc-answers.env
#   sudo ./qsvc-server-setup-<version>.run -- --help
#
# Nothing here contacts the internet. Secrets are generated on this server and never printed.
set -Eeuo pipefail
umask 077

HERE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
VERSION=$(cat "$HERE/VERSION" 2>/dev/null || echo unknown)
PREFIX=/opt/qsvc
ETC=/etc/qsvc
STATE=/var/lib/qsvc
LOG=/var/log/qsvc-setup.log
PROJECT=qsvc
SILENT=false
ANSWERS=
TOTAL_STEPS=12
STEP=0

# ── Output and logging ───────────────────────────────────────────────────────
mkdir -p "$(dirname "$LOG")"; : >>"$LOG"; chmod 600 "$LOG"
log()  { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*" >>"$LOG"; }
say()  { printf '%s\n' "$*"; log "$*"; }
step() { STEP=$((STEP + 1)); local pct=$((STEP * 100 / TOTAL_STEPS)); printf '\n\033[1m[%2d/%d] %3d%%  %s\033[0m\n' "$STEP" "$TOTAL_STEPS" "$pct" "$*"; log "STEP $STEP/$TOTAL_STEPS $*"; }
ok()   { printf '   \033[32m✔\033[0m %s\n' "$*"; log "OK $*"; }
warn() { printf '   \033[33m▲\033[0m %s\n' "$*"; log "WARN $*"; }
fail() { printf '\n\033[31m✖ Setup stopped: %s\033[0m\n   Details: %s\n' "$*" "$LOG" >&2; log "FAIL $*"; exit 1; }
trap 'fail "unexpected error at line $LINENO (see log)"' ERR

usage() {
  cat <<EOF
QS-VC Server Setup $VERSION

Options (after "--" when running the .run file):
  --silent               No questions; read every answer from --answers
  --answers FILE         KEY=VALUE file (see answers.example.env in this package)
  --help                 Show this help

After installation, manage the server with:  qsvc status | start | stop | logs | support-bundle
EOF
}

while (($#)); do
  case "$1" in
    --silent) SILENT=true ;;
    --answers) ANSWERS=${2:?--answers needs a file}; shift ;;
    --help|-h) usage; exit 0 ;;
    *) fail "unknown option $1 (use --help)" ;;
  esac
  shift
done

# ── Wizard UI: whiptail when available, plain prompts otherwise ──────────────
UI=plain
if ! $SILENT && [[ -t 0 && -t 1 ]] && command -v whiptail >/dev/null 2>&1; then UI=whiptail; fi
TITLE="QS-VC Server Setup $VERSION"

ui_msg() {  # title text
  $SILENT && return 0
  if [[ $UI == whiptail ]]; then whiptail --title "$TITLE" --msgbox "$2" 20 76; else printf '\n== %s ==\n%s\n' "$1" "$2"; read -r -p 'Press Enter to continue… ' _ </dev/tty; fi
}
ui_yesno() {  # text -> 0 yes
  if [[ $UI == whiptail ]]; then whiptail --title "$TITLE" --yesno "$1" 20 76; return; fi
  local reply; read -r -p "$1 [y/N] " reply </dev/tty; [[ $reply =~ ^[Yy] ]]
}
ui_input() {  # var prompt default
  local value
  if [[ $UI == whiptail ]]; then value=$(whiptail --title "$TITLE" --inputbox "$2" 12 76 "$3" 3>&1 1>&2 2>&3) || fail "setup cancelled"
  else read -r -p "$2 [$3]: " value </dev/tty; value=${value:-$3}; fi
  printf -v "$1" '%s' "$value"
}
ui_password() {  # var prompt
  local a b
  while true; do
    if [[ $UI == whiptail ]]; then
      a=$(whiptail --title "$TITLE" --passwordbox "$2" 10 76 3>&1 1>&2 2>&3) || fail "setup cancelled"
      b=$(whiptail --title "$TITLE" --passwordbox "Type the password again" 10 76 3>&1 1>&2 2>&3) || fail "setup cancelled"
    else
      read -r -s -p "$2: " a </dev/tty; echo; read -r -s -p 'Type it again: ' b </dev/tty; echo
    fi
    [[ $a == "$b" ]] || { ui_msg "Password" "The two passwords do not match. Try again."; continue; }
    (( ${#a} >= 12 )) || { ui_msg "Password" "Use at least 12 characters."; continue; }
    break
  done
  printf -v "$1" '%s' "$a"
}
ui_menu() {  # var text default tag1 label1 tag2 label2 ...
  local var=$1 text=$2 def=$3; shift 3
  if [[ $UI == whiptail ]]; then
    local choice; choice=$(whiptail --title "$TITLE" --default-item "$def" --menu "$text" 18 76 6 "$@" 3>&1 1>&2 2>&3) || fail "setup cancelled"
    printf -v "$var" '%s' "$choice"; return
  fi
  printf '\n%s\n' "$text"; local tags=() i=1
  while (($#)); do printf '  %d) %s\n' "$i" "$2"; tags+=("$1"); shift 2; i=$((i + 1)); done
  local pick; read -r -p "Choose [default: $def]: " pick </dev/tty
  if [[ -z $pick ]]; then printf -v "$var" '%s' "$def"; else printf -v "$var" '%s' "${tags[$((pick - 1))]:-$def}"; fi
}

# ── Answers (silent mode or pre-filled defaults) ─────────────────────────────
if [[ -n $ANSWERS ]]; then
  [[ -f $ANSWERS && ! -L $ANSWERS ]] || fail "answers file not found: $ANSWERS"
  # Only simple KEY=VALUE lines for known keys are read; nothing is executed.
  while IFS='=' read -r key value; do
    [[ $key =~ ^QSVC_(ACCEPT_EULA|ORG_NAME|DOMAIN|SERVER_IP|ADMIN_EMAIL|ADMIN_PASSWORD_FILE|TLS_MODE|TLS_CERT|TLS_KEY|TLS_CA|TRUST_FINGERPRINTS|OPEN_FIREWALL)$ ]] || continue
    value=${value%$'\r'}; value=${value#\"}; value=${value%\"}
    printf -v "$key" '%s' "$value"
  done < <(grep -E '^[A-Z_]+=' "$ANSWERS")
fi
if $SILENT; then
  [[ ${QSVC_ACCEPT_EULA:-} == yes ]] || fail "silent mode needs QSVC_ACCEPT_EULA=yes in the answers file"
fi

[[ $(id -u) == 0 ]] || fail "run as root (sudo)"
[[ $(uname -m) == x86_64 ]] || fail "this package is for x86-64 servers (found $(uname -m))"

OSSL="$HERE/bin/openssl"
export QSVC_OPENSSL="$OSSL"
COMPOSE_BIN="$HERE/bin/docker-compose"

clear 2>/dev/null || true
cat <<EOF
  ╔══════════════════════════════════════════════════════════════╗
  ║   QS-VC Server Setup  ·  version $VERSION
  ║   Quantum-safe video conferencing for your private network
  ╚══════════════════════════════════════════════════════════════╝
EOF
log "QS-VC Server Setup $VERSION started (ui=$UI silent=$SILENT)"

# ── 1. Licence agreement ─────────────────────────────────────────────────────
step "Licence agreement"
if ! $SILENT; then
  if [[ $UI == whiptail ]]; then whiptail --title "QS-VC End User Licence Agreement" --scrolltext --textbox "$HERE/EULA.txt" 22 78
  else ${PAGER:-more} "$HERE/EULA.txt" </dev/tty; fi
  ui_yesno "Do you accept the QS-VC End User Licence Agreement?" || fail "the licence agreement was not accepted"
fi
ok "Licence accepted"

# ── 2. Package authenticity ──────────────────────────────────────────────────
step "Verifying the signed server package"
"$OSSL" version >/dev/null 2>&1 || fail "bundled verifier cannot run on this system"
ED_FP=$("$OSSL" dgst -sha256 -r "$HERE/keys/Ed25519.pub" | cut -c1-64)
ML_FP=$("$OSSL" dgst -sha256 -r "$HERE/keys/ML-DSA-65.pub" | cut -c1-64)
FP_TEXT="Compare these release key fingerprints with the ones QS-VC sent you separately (email, letter or phone):

  Ed25519    ${ED_FP:0:16}…${ED_FP:48:16}
  ML-DSA-65  ${ML_FP:0:16}…${ML_FP:48:16}

Full values are in $LOG."
log "Ed25519 fingerprint $ED_FP"; log "ML-DSA-65 fingerprint $ML_FP"
if $SILENT; then
  if [[ -n ${QSVC_TRUST_FINGERPRINTS:-} ]]; then
    [[ $QSVC_TRUST_FINGERPRINTS == "$ED_FP,$ML_FP" ]] || fail "release key fingerprints differ from QSVC_TRUST_FINGERPRINTS"
  else warn "QSVC_TRUST_FINGERPRINTS not set; fingerprints not compared (recorded in the log)"; fi
else
  ui_yesno "$FP_TEXT

Do the fingerprints match?" || fail "release key fingerprints not confirmed"
fi
WORK="$HERE/payload"; rm -rf "$WORK"; mkdir -p "$WORK"
python3 - "$HERE/QS-VC-On-prem-Installer.tar.gz" "$WORK" <<'PY' || fail "the server package archive is damaged"
import sys, tarfile
with tarfile.open(sys.argv[1], 'r:gz') as archive:
    members = archive.getmembers()
    if any(not (m.isfile() or m.isdir()) for m in members):
        raise SystemExit('unsupported archive entry')
    archive.extractall(sys.argv[2], members=members, filter='data') if hasattr(tarfile, 'data_filter') else archive.extractall(sys.argv[2], members=members)
PY
bash "$HERE/verify.sh" "$WORK" "$HERE/keys/Ed25519.pub" "$HERE/keys/ML-DSA-65.pub" >>"$LOG" 2>&1 \
  || fail "signature or file check failed: do not install this package; contact QS-VC"
ok "Both signatures (Ed25519 and ML-DSA-65) and all $(python3 -c 'import json,sys;print(len(json.load(open(sys.argv[1]))["sha256"]))' "$WORK/manifest.json") files verified"

# ── 3. System check ──────────────────────────────────────────────────────────
step "Checking this server"
. /etc/os-release 2>/dev/null || true
OS_ID=${ID:-unknown}; OS_VER=${VERSION_ID:-?}
case "$OS_ID:${OS_VER%%.*}" in
  rocky:9|rhel:9|almalinux:9|ol:9) ok "Operating system: ${PRETTY_NAME:-$OS_ID $OS_VER}" ;;
  ubuntu:22|ubuntu:24) ok "Operating system: ${PRETTY_NAME:-$OS_ID $OS_VER} (supported)" ;;
  *) warn "Operating system ${PRETTY_NAME:-$OS_ID $OS_VER} is not certified (supported: Rocky/RHEL 9, Ubuntu 22.04/24.04)" ;;
esac
CPUS=$(nproc); MEM_GB=$(( $(awk '/MemTotal/ {print $2}' /proc/meminfo) / 1024 / 1024 ))
mkdir -p "$PREFIX"; DISK_GB=$(df -Pk "$PREFIX" | awk 'NR==2 {print int($4/1024/1024)}')
(( CPUS >= 4 )) && ok "CPU: $CPUS cores" || warn "CPU: $CPUS cores (8 recommended for 50 users)"
(( MEM_GB >= 7 )) && ok "Memory: ${MEM_GB} GB" || fail "memory ${MEM_GB} GB is below the 8 GB minimum"
MIN_DISK=${QSVC_MIN_DISK_GB:-30}   # lab override only; production needs 30 GB+
(( DISK_GB >= MIN_DISK )) && ok "Free disk for $PREFIX: ${DISK_GB} GB" || fail "only ${DISK_GB} GB free for $PREFIX (30 GB minimum)"
# Keep existing installations on their recorded engine; new hosts use Podman.
RUNTIME=podman
if [[ -f "$ETC/runtime" ]]; then
  recorded_runtime=$(sed -n 's/^RUNTIME=//p' "$ETC/runtime")
  case "$recorded_runtime" in
    docker|podman) RUNTIME=$recorded_runtime ;;
    *) fail "unrecognised installed container runtime; contact support before upgrading" ;;
  esac
fi
for p in 80 443 3478; do
  if ss -Hltn "sport = :$p" 2>/dev/null | grep -q . && ! "$RUNTIME" ps --format '{{.Names}}' 2>/dev/null | grep -q '^qsvc-caddy$'; then
    fail "port $p is already in use by another program"
  fi
done
ok "Ports 80, 443 and 3478 are free"
if command -v timedatectl >/dev/null && [[ $(timedatectl show -p NTPSynchronized --value 2>/dev/null) == yes ]]; then ok "Clock is synchronised (NTP)"
else warn "Clock is not NTP-synchronised; sign-in and the 14-day period depend on correct time"; fi
SELINUX=$(getenforce 2>/dev/null || echo Disabled); ok "SELinux: $SELINUX"

# ── 4. Container runtime ─────────────────────────────────────────────────────
step "Preparing the container runtime"
if [[ $RUNTIME == docker ]]; then
  command -v docker >/dev/null && docker info >/dev/null 2>&1 || fail "this existing installation uses Docker; restore its Docker service before upgrading (automatic runtime migration is not supported)"
elif command -v podman >/dev/null; then :
elif [[ -d $HERE/rpms && $OS_ID =~ ^(rocky|rhel|almalinux|ol)$ ]]; then
  dnf -y --disablerepo='*' install "$HERE"/rpms/*.rpm >>"$LOG" 2>&1 || fail "could not install the bundled Podman packages"
  RUNTIME=podman
elif command -v dnf >/dev/null; then
  dnf -y install podman >>"$LOG" 2>&1 || fail "Podman is not installed and your package repository could not provide it (install podman, then run setup again)"
  RUNTIME=podman
elif command -v apt-get >/dev/null; then
  apt-get install -y podman >>"$LOG" 2>&1 || fail "install Podman, then run setup again"
  RUNTIME=podman
else fail "install Podman 4.9+, then run setup again"; fi
if [[ $RUNTIME == podman ]]; then
  systemctl enable --now podman.socket >>"$LOG" 2>&1 || fail "could not start the Podman API socket"
  export DOCKER_HOST=unix:///run/podman/podman.sock
  ok "Podman $(podman --version | awk '{print $3}') with Docker-compatible API"
else
  ok "Docker $(docker version --format '{{.Server.Version}}' 2>/dev/null)"
fi
install -m 0755 "$COMPOSE_BIN" /usr/local/libexec/qsvc-compose 2>/dev/null || { mkdir -p /usr/local/libexec; install -m 0755 "$COMPOSE_BIN" /usr/local/libexec/qsvc-compose; }
ok "QS-VC Compose client $(/usr/local/libexec/qsvc-compose version --short) (no Docker daemon required with Podman)"

# ── 5. Organisation details ──────────────────────────────────────────────────
step "Organisation details"
DEF_IP=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i=1;i<NF;i++) if ($i=="src") print $(i+1)}' | head -1)
DEF_IP=${DEF_IP:-$(hostname -I 2>/dev/null | awk '{print $1}')}
DEF_FQDN=$(hostname -f 2>/dev/null || hostname)
if ! $SILENT; then
  ui_input QSVC_ORG_NAME "Organisation name" "${QSVC_ORG_NAME:-}"
  ui_input QSVC_DOMAIN "Server name (DNS name staff will open, e.g. vc.example.gov.in)" "${QSVC_DOMAIN:-$DEF_FQDN}"
  ui_input QSVC_SERVER_IP "Server IP address reachable from every branch over MPLS" "${QSVC_SERVER_IP:-$DEF_IP}"
  ui_input QSVC_ADMIN_EMAIL "First administrator email" "${QSVC_ADMIN_EMAIL:-}"
  ui_password ADMIN_PASSWORD "Password for the first administrator (at least 12 characters)"
  ui_menu QSVC_TLS_MODE "Server certificate (HTTPS)" "${QSVC_TLS_MODE:-internal}" \
    organisation "Use our organisation's certificate (recommended)" \
    internal "Create a QS-VC internal certificate authority"
  if [[ $QSVC_TLS_MODE == organisation ]]; then
    ui_input QSVC_TLS_CERT "Path to the certificate file (PEM, full chain)" "${QSVC_TLS_CERT:-}"
    ui_input QSVC_TLS_KEY "Path to the private key file (PEM)" "${QSVC_TLS_KEY:-}"
    ui_input QSVC_TLS_CA "Root CA bundle path for private PKI (leave empty for system trust)" "${QSVC_TLS_CA:-}"
  fi
else
  [[ -n ${QSVC_ADMIN_PASSWORD_FILE:-} && -f $QSVC_ADMIN_PASSWORD_FILE ]] || fail "silent mode needs QSVC_ADMIN_PASSWORD_FILE"
  ADMIN_PASSWORD=$(head -n1 "$QSVC_ADMIN_PASSWORD_FILE"); QSVC_TLS_MODE=${QSVC_TLS_MODE:-internal}
fi
[[ ${QSVC_DOMAIN:-} =~ ^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*$ ]] || fail "invalid server name: ${QSVC_DOMAIN:-}"
[[ ${QSVC_SERVER_IP:-} =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || fail "invalid IPv4 address: ${QSVC_SERVER_IP:-}"
[[ ${QSVC_ADMIN_EMAIL:-} =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]] || fail "invalid administrator email"
(( ${#ADMIN_PASSWORD} >= 12 )) || fail "administrator password must have at least 12 characters"
QSVC_ADMIN_EMAIL=${QSVC_ADMIN_EMAIL,,}
case "$QSVC_TLS_MODE" in
  internal|organisation) ;;
  *) fail "TLS mode must be internal or organisation" ;;
esac
if [[ $QSVC_TLS_MODE == organisation ]]; then
  [[ -z ${QSVC_TLS_CA:-} || -r $QSVC_TLS_CA ]] || fail "organisation CA bundle is unreadable"
  [[ -f ${QSVC_TLS_CERT:-} && -f ${QSVC_TLS_KEY:-} ]] || fail "certificate or key file not found"
  "$OSSL" x509 -in "$QSVC_TLS_CERT" -noout -checkend 604800 >/dev/null || fail "the certificate is invalid or expires within 7 days"
  CERT_PUB=$("$OSSL" x509 -in "$QSVC_TLS_CERT" -noout -pubkey | "$OSSL" dgst -sha256 -r | cut -c1-64)
  KEY_PUB=$("$OSSL" pkey -in "$QSVC_TLS_KEY" -pubout | "$OSSL" dgst -sha256 -r | cut -c1-64)
  [[ $CERT_PUB == "$KEY_PUB" ]] || fail "the private key does not match the certificate"
  "$OSSL" x509 -in "$QSVC_TLS_CERT" -noout -checkhost "$QSVC_DOMAIN" | grep -q 'does match' || fail "the certificate is not issued for $QSVC_DOMAIN"
fi
ok "$QSVC_ORG_NAME · https://$QSVC_DOMAIN · $QSVC_SERVER_IP · admin $QSVC_ADMIN_EMAIL · TLS: $QSVC_TLS_MODE"

# ── 6. Install files and generate secrets ────────────────────────────────────
step "Installing files and generating secrets"
REL="$PREFIX/releases/$VERSION"
if [[ -d $REL ]]; then rm -rf "$REL.previous"; mv "$REL" "$REL.previous"; fi
mkdir -p "$PREFIX/releases" "$ETC/tls" "$STATE" "$PREFIX/downloads"
cp -a "$WORK" "$REL"; chmod -R go-w "$REL"; find "$REL" -type d -exec chmod 755 {} +; find "$REL" -type f -exec chmod a+r {} +
ln -sfn "$REL" "$PREFIX/current"
[[ -d $REL/clients ]] && cp -a "$REL/clients/." "$PREFIX/downloads/"
ENV="$ETC/qsvc.env"
rand() { "$OSSL" rand -hex "$1"; }
load_env() {  # read KEY=VALUE lines without executing anything
  local key value
  while IFS='=' read -r key value; do
    [[ $key =~ ^[A-Z][A-Z0-9_]*$ ]] || continue
    value=${value#\"}; value=${value%\"}; export "$key=$value"
  done <"$ENV"
}
QSVC_ORG_NAME=$(printf '%s' "${QSVC_ORG_NAME:-}" | tr -cd '[:alnum:] .,&()/-' | cut -c1-100)
if [[ -f $ENV ]] && grep -q '^POSTGRES_PASSWORD=.' "$ENV"; then
  ok "Keeping existing secrets from $ENV (repair/upgrade)"
  load_env
else
  [[ -f $ETC/session-signing.pem ]] || "$OSSL" genpkey -algorithm Ed25519 -out "$ETC/session-signing.pem"
  chmod 0644 "$ETC/session-signing.pem"   # read by the auth container user; directory is root-only
  cat >"$ENV" <<EOF
# QS-VC server configuration — generated $(date -u +%FT%TZ) by setup $VERSION. Root-only; never share.
QSVC_VERSION=$VERSION
QSVC_ORG_NAME="$QSVC_ORG_NAME"
DOMAIN=$QSVC_DOMAIN
QSVC_PUBLIC_URL=https://$QSVC_DOMAIN
QSVC_DEPLOYMENT=onprem
QSVC_ADMIN_EMAILS=$QSVC_ADMIN_EMAIL
SFU_ANNOUNCED_IP=$QSVC_SERVER_IP
TURN_ALLOWED_SFU_IP=$QSVC_SERVER_IP
TURN_SERVERS=turn:$QSVC_SERVER_IP:3478
TURN_REALM=qsvc
TURN_SECRET=$(rand 32)
TURN_ACCESS_SECRET=$(rand 32)
SFU_CONTROL_TOKEN=$(rand 32)
INTERNAL_AUTH_SECRET=$(rand 32)
MEETING_POLICY_SECRET=$(rand 32)
INVITATION_SECRET=$(rand 32)
ORIGIN_AUTH_SECRET=$(rand 32)
POSTGRES_DB=qsvc
POSTGRES_USER=qsvc
POSTGRES_PASSWORD=$(rand 24)
AUTH_DB_USER=qs_auth_app
AUTH_DB_PASSWORD=$(rand 24)
MEETING_DB_USER=qs_meeting_app
MEETING_DB_PASSWORD=$(rand 24)
REDIS_PASSWORD=$(rand 24)
MINIO_ACCESS_KEY=qsvc$(rand 6)
MINIO_SECRET_KEY=$(rand 24)
SESSION_SIGNING_KEY_FILE=$ETC/session-signing.pem
JWT_EXPIRY=1h
PAYMENTS_ENABLED=false
QSVC_AI_GATEWAY_ENABLED=false
EOF
  chmod 600 "$ENV"
  load_env
fi
chmod 700 "$ETC"; chmod 755 "$ETC/tls"

# Site-specific Caddy configuration (the signed template stays untouched).
CADDY_SITE="$ETC/Caddyfile"
python3 - "$REL/config/Caddyfile.template" "$CADDY_SITE" "$QSVC_DOMAIN" "$QSVC_TLS_MODE" <<'PY'
import sys
from pathlib import Path
src, dst, domain, mode = sys.argv[1:5]
text = Path(src).read_text()
text = text.replace("{$QSVC_DOMAIN:meet.internal}", domain, 1)
if mode == "organisation":
    if text.count("tls internal {") != 1:
        raise SystemExit("Caddy template changed: cannot apply the organisation certificate")
    text = text.replace("tls internal {", "tls /etc/qsvc-tls/fullchain.pem /etc/qsvc-tls/privkey.pem {", 1)
anchor = "    handle /health {"
if text.count(anchor) != 1:
    raise SystemExit("Caddy template changed: cannot add the downloads page")
downloads = """    # Branch app installers and the root certificate, served on the private network.
    handle_path /downloads/* {
        root * /srv/downloads
        file_server browse
    }
    redir /downloads /downloads/ 308

"""
Path(dst).write_text(text.replace(anchor, downloads + anchor, 1))
PY
chmod 644 "$CADDY_SITE"
if [[ $QSVC_TLS_MODE == organisation ]]; then
  install -m 0644 "$QSVC_TLS_CERT" "$ETC/tls/fullchain.pem"; install -m 0644 "$QSVC_TLS_KEY" "$ETC/tls/privkey.pem"
fi
cat >"$ETC/compose.site.yml" <<EOF
# Site overrides written by QS-VC Server Setup. Re-running setup regenerates this file.
services:
  caddy:
    volumes:
      - $CADDY_SITE:/etc/caddy/Caddyfile:ro
      - $ETC/tls:/etc/qsvc-tls:ro
      - $PREFIX/downloads:/srv/downloads:ro
  auth:
    volumes:
      - $PREFIX/downloads:/opt/qsvc/installers:ro
  meeting:
    environment:
      # Signaling runs as its own service; do not start the copy bundled in the meeting image.
      SIGNALING_DIST: ""
EOF
chmod 644 "$ETC/compose.site.yml"
install -m 0600 "$HERE/compose.organisation.example.yml" "$ETC/compose.organisation.example.yml"
ok "Configuration written to $ETC (root-only)"

# ── 7. 14-day period and installation ID ─────────────────────────────────────
step "Recording the installation"
TRIAL="$STATE/onprem-trial"; mkdir -p "$TRIAL"; chown root:root "$TRIAL"; chmod 755 "$TRIAL"
[[ -f $TRIAL/installed-at ]] || { printf '%s\n' "$(( $(date +%s) * 1000 ))" >"$TRIAL/installed-at"; chmod 644 "$TRIAL/installed-at"; }
[[ -f $TRIAL/installation-id ]] || { python3 -c 'import uuid;print(uuid.uuid4())' >"$TRIAL/installation-id"; chmod 644 "$TRIAL/installation-id"; }
INSTALLATION_ID=$(cat "$TRIAL/installation-id")
ok "Installation ID $INSTALLATION_ID · 14 days of use start $(date -d "@$(( $(cat "$TRIAL/installed-at") / 1000 ))" +%F)"

# ── 8. Load the signed container images ──────────────────────────────────────
step "Loading QS-VC services (this takes a few minutes)"
if [[ $SELINUX == Enforcing ]]; then
  chcon -R -t container_file_t "$PREFIX" "$ETC" "$STATE" >>"$LOG" 2>&1 || warn "could not label files for SELinux"
fi
DOCKER=docker; [[ $RUNTIME == podman ]] && DOCKER=podman
$DOCKER load -i "$REL/qsvc-intranet-images.tar" >>"$LOG" 2>&1 || fail "could not load the container images"
ok "Images loaded"

compose() {
  local files=(-f "$PREFIX/current/docker-compose.prod.yml" -f "$PREFIX/current/compose.offline.yml" -f "$ETC/compose.site.yml")
  if [[ -f $ETC/compose.organisation.yml ]]; then files+=(-f "$ETC/compose.organisation.yml"); fi
  /usr/local/libexec/qsvc-compose -p "$PROJECT" --project-directory "$PREFIX/current" --env-file "$ENV" "${files[@]}" "$@"
}
compose config --quiet >>"$LOG" 2>&1 || fail "service configuration is invalid (see log)"

# ── 9. Database ──────────────────────────────────────────────────────────────
step "Preparing the database"
compose up -d --no-build --pull never postgres >>"$LOG" 2>&1 || fail "the database did not start"
for _ in $(seq 1 120); do
  if compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT to_regclass('public.tenants') IS NOT NULL" 2>/dev/null | grep -q t \
     && $DOCKER logs qsvc-postgres 2>&1 | grep -q 'ready to accept connections'; then break; fi
  sleep 2
done
compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT 1 FROM tenants LIMIT 1" >/dev/null 2>&1 || fail "database schema was not created (see log)"
# Restricted service accounts (create or set password), and record the applied migrations so later upgrades run only new ones.
{
  echo '\set ON_ERROR_STOP on'
  for pair in "qs_auth_app:qsvc_auth_service:$AUTH_DB_PASSWORD" "qs_meeting_app:qsvc_meeting_service:$MEETING_DB_PASSWORD"; do
    IFS=: read -r role group pass <<<"$pair"
    cat <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$role') THEN
    CREATE ROLE $role LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT CONNECTION LIMIT 20 PASSWORD '$pass';
  ELSE
    ALTER ROLE $role LOGIN PASSWORD '$pass';
  END IF;
END \$\$;
GRANT $group TO $role;
SQL
  done
  echo "CREATE TABLE IF NOT EXISTS _migrations (id SERIAL PRIMARY KEY, filename VARCHAR(255) UNIQUE NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW());"
  for f in "$REL"/db/migrations/*.sql; do echo "INSERT INTO _migrations (filename) VALUES ('$(basename "$f")') ON CONFLICT DO NOTHING;"; done
} | compose exec -T postgres psql -q -U "$POSTGRES_USER" -d "$POSTGRES_DB" >>"$LOG" 2>&1 || fail "could not create the database service accounts"
ok "Database ready with restricted service accounts"

# ── 10. Start services ───────────────────────────────────────────────────────
step "Starting QS-VC services"
SERVICES=(redis coturn trial-gateway sfu signaling auth meeting recording web caddy)
compose up -d --no-build --pull never --no-deps "${SERVICES[@]}" >>"$LOG" 2>&1 || fail "services did not start (see log)"
healthy() { [[ $($DOCKER inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$1" 2>/dev/null) =~ ^(healthy|running)$ ]]; }
for svc in qsvc-redis qsvc-sfu qsvc-auth qsvc-meeting qsvc-recording; do
  for _ in $(seq 1 90); do healthy "$svc" && break; sleep 2; done
  healthy "$svc" && ok "$svc" || fail "$svc is not healthy (run: qsvc logs ${svc#qsvc-})"
done
# First administrator (password passed through the environment only, never on a command line).
export QSVC_ADMIN_PASSWORD="$ADMIN_PASSWORD" QSVC_ADMIN_EMAIL QSVC_DB_URL="postgres://$POSTGRES_USER:$POSTGRES_PASSWORD@postgres:5432/$POSTGRES_DB"
compose exec -T -e QSVC_ADMIN_PASSWORD -e QSVC_ADMIN_EMAIL -e QSVC_DB_URL auth node - <"$HERE/create-admin.cjs" >>"$LOG" 2>&1 || fail "could not create the administrator account"
unset QSVC_ADMIN_PASSWORD QSVC_DB_URL ADMIN_PASSWORD
ok "Administrator $QSVC_ADMIN_EMAIL created"

# ── 11. Network access, start on boot, management tool ───────────────────────
step "Opening network ports and enabling start on boot"
PORTS_TCP="80 443 3478"; PORTS_UDP="3478 40000-40100 49152-49200"
if systemctl is-active --quiet firewalld 2>/dev/null; then
  for p in $PORTS_TCP; do firewall-cmd -q --permanent --add-port="$p/tcp"; done
  for p in $PORTS_UDP; do firewall-cmd -q --permanent --add-port="$p/udp"; done
  firewall-cmd -q --reload; ok "firewalld: opened TCP $PORTS_TCP and UDP $PORTS_UDP"
elif command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q 'Status: active'; then
  for p in $PORTS_TCP; do ufw allow "$p/tcp" >/dev/null; done
  for p in $PORTS_UDP; do ufw allow "${p/-/:}/udp" >/dev/null; done
  ok "ufw: opened TCP $PORTS_TCP and UDP $PORTS_UDP"
else
  warn "No active host firewall found; make sure your network firewall allows TCP $PORTS_TCP and UDP $PORTS_UDP from branch subnets"
fi
install -m 0755 "$HERE/qsvc" /usr/local/sbin/qsvc
cat >/etc/systemd/system/qsvc.service <<EOF
[Unit]
Description=QS-VC video conferencing server
After=network-online.target $( [[ $RUNTIME == podman ]] && echo podman.socket || echo docker.service )
Wants=network-online.target
[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/local/sbin/qsvc start
ExecStop=/usr/local/sbin/qsvc stop
TimeoutStartSec=600
[Install]
WantedBy=multi-user.target
EOF
printf 'RUNTIME=%s\nVERSION=%s\n' "$RUNTIME" "$VERSION" >"$ETC/runtime"
systemctl daemon-reload >>"$LOG" 2>&1 && systemctl enable qsvc.service >>"$LOG" 2>&1 && ok "QS-VC starts automatically at boot" \
  || warn "systemd not available; start QS-VC after a reboot with: qsvc start"

# ── 12. Finish ───────────────────────────────────────────────────────────────
step "Final checks"
CA_NOTE=
CA_ARGS=()
if [[ $QSVC_TLS_MODE == internal ]]; then
  for _ in $(seq 1 30); do
    compose exec -T caddy cat /data/caddy/pki/authorities/local/root.crt >"$PREFIX/downloads/QS-VC-Root-CA.crt" 2>/dev/null && [[ -s $PREFIX/downloads/QS-VC-Root-CA.crt ]] && break
    sleep 2
  done
  if [[ -s $PREFIX/downloads/QS-VC-Root-CA.crt ]]; then
    chmod 644 "$PREFIX/downloads/QS-VC-Root-CA.crt"
    CA_ARGS=(--cacert "$PREFIX/downloads/QS-VC-Root-CA.crt")
    CA_NOTE="Distribute $PREFIX/downloads/QS-VC-Root-CA.crt to every PC (Group Policy) so browsers trust the server."
  else fail "internal CA certificate unavailable; check Caddy and retry setup"; fi
elif [[ -n ${QSVC_TLS_CA:-} ]]; then
  CA_ARGS=(--cacert "$QSVC_TLS_CA")
fi
code=$(curl -sS --max-time 10 --retry 5 --retry-connrefused --noproxy '*' "${CA_ARGS[@]}" \
  -o /dev/null -w '%{http_code}' --resolve "$QSVC_DOMAIN:443:127.0.0.1" \
  "https://$QSVC_DOMAIN/health" 2>>"$LOG") || fail "HTTPS certificate or gateway check failed; check $LOG"
[[ $code == 200 ]] || fail "HTTPS gateway health check returned $code; check $LOG"
ok "Verified HTTPS gateway at https://$QSVC_DOMAIN"
rm -rf "$WORK"
SUMMARY="QS-VC is installed and running.

  Open:              https://$QSVC_DOMAIN
  Administrator:     $QSVC_ADMIN_EMAIL
  Branch app setup:  https://$QSVC_DOMAIN/downloads/
  Installation ID:   $INSTALLATION_ID
  14 days of use end on $(date -d "@$(( $(cat "$TRIAL/installed-at") / 1000 + 14 * 86400 ))" +%F).
  Contact QS-VC with the installation ID to activate before then.

$CA_NOTE
Make sure DNS resolves $QSVC_DOMAIN to $QSVC_SERVER_IP for every branch.
Manage the server with: qsvc status | logs | support-bundle
Setup log: $LOG"
log "INSTALL COMPLETE $VERSION $INSTALLATION_ID"
trap - ERR
if [[ $UI == whiptail ]]; then whiptail --title "Congratulations! Setup is complete" --msgbox "$SUMMARY" 24 78; fi
printf '\n\033[1;32mCongratulations! QS-VC Server setup is complete.\033[0m\n\n%s\n' "$SUMMARY"
