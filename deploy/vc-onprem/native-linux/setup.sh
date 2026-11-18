#!/usr/bin/env bash
# Trusted operator entry point. Verify the signed staged release BEFORE executing this script.
set -euo pipefail
umask 077
fail() { echo "QS-VC native setup: $*" >&2; exit 1; }
[[ $(id -u) == 0 && $# == 2 ]] || fail 'Usage: sudo setup.sh VERIFIED_RELEASE ROOT_ONLY_ANSWERS'
release=$(realpath "$1"); answers=$(realpath "$2")
[[ $(stat -c %a "$answers") == 600 && $(stat -c %u "$answers") == 0 ]] || fail 'Answers must be root-owned mode 600'
# The supplied answers are trusted operator shell configuration, never a web upload.
set -a; . "$answers"; set +a
. /etc/os-release
[[ $ID == ubuntu && $VERSION_ID == 24.04 && $(uname -m) == x86_64 ]] || fail 'Supported native target: Ubuntu 24.04 x86_64'
[[ $(node -p 'process.versions.node.split(".")[0]' 2>/dev/null) == 22 ]] || fail 'Install native Node.js 22 from your approved package repository first'
command -v systemctl >/dev/null || fail 'systemd is required'
[[ -f "$release/VERSION" && -d "$release/services/auth/dist" && -d "$release/node_modules" ]] || fail 'Use a complete native release built for this target'
version=$(cat "$release/VERSION"); [[ $version =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail 'Invalid version'
[[ ${QSVC_DOMAIN:-} =~ ^[A-Za-z0-9][A-Za-z0-9.-]*$ && -n ${SFU_ANNOUNCED_IP:-} ]] || fail 'Set domain and reachable SFU_ANNOUNCED_IP'
[[ -f ${QSVC_TLS_CERT:-/missing} && -f ${QSVC_TLS_KEY:-/missing} ]] || fail 'Provide organization TLS certificate/key files'
mode=${QSVC_DATABASE_MODE:-}
if [[ -z $mode && -t 0 ]]; then read -r -p 'Database mode (existing/local): ' mode; fi
[[ $mode == local || $mode == existing ]] || fail 'Choose QSVC_DATABASE_MODE=existing or local'
[[ ! -e /etc/qsvc/runtime ]] || fail 'Existing container installation detected. Use a separate host or reviewed data migration; no automatic conversion.'
if [[ ${QSVC_INSTALL_PACKAGES:-no} == yes ]]; then
 packages=(caddy postgresql-client)
 [[ $mode != local ]] || packages+=(postgresql redis-server)
 apt-get update
 apt-get install -y "${packages[@]}"
fi
for cmd in caddy psql openssl runuser; do command -v "$cmd" >/dev/null || fail "Native prerequisite missing: $cmd. Install approved packages or set QSVC_INSTALL_PACKAGES=yes."; done
mkdir -p /etc/qsvc/native /opt/qsvc-native/releases /var/lib/qsvc-native
[[ ! -f /etc/qsvc/native/service.env ]] || fail 'Existing native installation found; use reviewed upgrade/rollback procedure rather than rotating credentials'
id qsvc-native >/dev/null 2>&1 || useradd --system --user-group --home /var/lib/qsvc-native --shell /usr/sbin/nologin qsvc-native
chmod 0755 /opt/qsvc-native /opt/qsvc-native/releases
chown root:qsvc-native /etc/qsvc
chmod 0750 /etc/qsvc
target="/opt/qsvc-native/releases/$version"
[[ ! -e $target ]] || fail 'Release directory exists; use reviewed upgrade procedure'
cp -R "$release" "$target"
chmod -R go+rX "$target"
release=$target
if [[ $mode == local ]]; then
 [[ ${QSVC_APPLY_MIGRATIONS:-no} == yes ]] || fail 'New local database requires QSVC_APPLY_MIGRATIONS=yes; no database changes made'
 command -v pg_isready >/dev/null && command -v redis-server >/dev/null || fail 'Local mode requires native PostgreSQL and Redis packages'
 systemctl enable --now postgresql redis-server
 # Never claim or overwrite an existing database or login.
 exists=$(runuser -u postgres -- psql -Atqc "SELECT EXISTS(SELECT FROM pg_database WHERE datname='qsvc_native') OR EXISTS(SELECT FROM pg_roles WHERE rolname IN ('qsvc_native_auth','qsvc_native_meeting'))")
 [[ $exists == f ]] || fail 'Dedicated local database/roles already exist; nothing will be overwritten'
 auth_pw=$(openssl rand -hex 32); meeting_pw=$(openssl rand -hex 32)
 runuser -u postgres -- createdb qsvc_native
 # Existing migration runner needs role-provisioning privileges; run locally as postgres only during explicit setup.
 export MIGRATION_DATABASE_URL=postgresql:///qsvc_native?host=/var/run/postgresql
 export POSTGRES_SSL=disable
 # Root-owned release is readable to postgres; no passwords or answers passed through shell interpolation.
 runuser -u postgres -- env MIGRATION_DATABASE_URL="$MIGRATION_DATABASE_URL" POSTGRES_SSL=disable node "$release/db/migrate.js"
 runuser -u postgres -- psql -d qsvc_native -v ON_ERROR_STOP=1 -v auth_pw="$auth_pw" -v meeting_pw="$meeting_pw" <<'SQL'
CREATE ROLE qsvc_native_auth LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD :'auth_pw';
CREATE ROLE qsvc_native_meeting LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD :'meeting_pw';
GRANT qsvc_auth_service TO qsvc_native_auth;
GRANT qsvc_meeting_service TO qsvc_native_meeting;
SQL
 AUTH_DATABASE_URL="postgresql://qsvc_native_auth:$auth_pw@127.0.0.1:5432/qsvc_native"
 MEETING_DATABASE_URL="postgresql://qsvc_native_meeting:$meeting_pw@127.0.0.1:5432/qsvc_native"
 REDIS_URL=redis://127.0.0.1:6379; REDIS_HOST=127.0.0.1; REDIS_PORT=6379
else
 [[ -n ${AUTH_DATABASE_URL:-} && -n ${MEETING_DATABASE_URL:-} && -n ${REDIS_URL:-} && -n ${REDIS_HOST:-} ]] || fail 'Existing mode requires auth/meeting PostgreSQL URLs and Redis URL/host'
 if [[ ${QSVC_APPLY_MIGRATIONS:-no} == yes ]]; then
  [[ -n ${MIGRATION_DATABASE_URL:-} ]] || fail 'Supply a separate migration-owner URL after backing up the database'
  node "$release/db/migrate.js"
 fi
fi
export AUTH_DATABASE_URL MEETING_DATABASE_URL REDIS_URL
# Reuse the app TLS database configuration and verify both independent service logins.
NODE_PATH="$release/node_modules" node - "$release" <<'JS'
const root=process.argv[2],{Pool}=require(root+'/node_modules/pg'),{databaseConfig}=require(root+'/shared/database.cjs');
(async()=>{for(const key of ['AUTH_DATABASE_URL','MEETING_DATABASE_URL']){const p=new Pool(databaseConfig({...process.env,DATABASE_URL:process.env[key]}));try{const r=await p.query('SELECT rolsuper,rolbypassrls,rolcreaterole FROM pg_roles WHERE rolname=current_user');if(!r.rows.length||Object.values(r.rows[0]).some(Boolean))throw Error('Runtime DB role has elevated privileges');await p.query('SELECT 1 FROM public.users LIMIT 0');}finally{await p.end();}}})().catch(e=>{console.error('Database preflight failed:',e.message);process.exit(1)});
JS
NODE_PATH="$release/node_modules" node - "$release" <<'JSREDIS'
const Redis=require(process.argv[2]+'/node_modules/ioredis');const r=new Redis(process.env.REDIS_URL,{lazyConnect:true,connectTimeout:5000,maxRetriesPerRequest:0,retryStrategy:()=>null});r.on('error',()=>{});(async()=>{try{await r.connect();await r.ping();}finally{r.disconnect();}})().catch(()=>{console.error('Redis preflight failed; check endpoint and credentials');process.exit(1)});
JSREDIS
# Store only runtime values, never migration-owner credentials.
install -d -m 0750 -o root -g qsvc-native /etc/qsvc/native
install -m 0640 -o root -g qsvc-native "$QSVC_TLS_CERT" /etc/qsvc/native/fullchain.pem
install -m 0640 -o root -g qsvc-native "$QSVC_TLS_KEY" /etc/qsvc/native/key.pem
if [[ -n ${POSTGRES_CA_FILE:-} ]]; then
 install -m 0640 -o root -g qsvc-native "$POSTGRES_CA_FILE" /etc/qsvc/native/database-ca.pem
 POSTGRES_CA_FILE=/etc/qsvc/native/database-ca.pem
fi
export QSVC_DOMAIN SFU_ANNOUNCED_IP REDIS_HOST REDIS_PORT POSTGRES_CA_FILE
python3 - <<'PY'
import os,secrets
from pathlib import Path
keys=['AUTH_DATABASE_URL','MEETING_DATABASE_URL','REDIS_URL','REDIS_HOST','REDIS_PORT','POSTGRES_SSL','POSTGRES_CA_FILE','SFU_ANNOUNCED_IP','TURN_SERVERS','TURN_USERNAME','TURN_PASSWORD','RECORDING_BUCKET','AWS_REGION','AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY']
env={k:os.environ[k] for k in keys if os.environ.get(k)}
env.update(NODE_ENV='production',HOST='127.0.0.1',SFU_CONTROL_HOST='127.0.0.1',CORS_ORIGINS='https://'+os.environ['QSVC_DOMAIN'],WEB_URL='https://'+os.environ['QSVC_DOMAIN'],SFU_INTERNAL_URL='http://127.0.0.1:4000',AUTH_INTERNAL_URL='http://127.0.0.1:4002',MEETING_INTERNAL_URL='http://127.0.0.1:4003')
for k in ['JWT_SECRET','SFU_CONTROL_TOKEN','INTERNAL_AUTH_SECRET','MEETING_POLICY_SECRET','INVITATION_SECRET','TURN_ACCESS_SECRET']:env[k]=secrets.token_hex(48)
# systemd EnvironmentFile uses quoted values, not shell evaluation.
def quote(v):
 if '\n' in v or '\r' in v or '\x00' in v:raise ValueError('Multiline environment value')
 return '"'+v.replace('\\','\\\\').replace('"','\\"')+'"'
Path('/etc/qsvc/native/service.env').write_text(''.join(k+'='+quote(v)+'\n' for k,v in env.items()))
PY
chown root:qsvc-native /etc/qsvc/native/service.env; chmod 0640 /etc/qsvc/native/service.env
chown qsvc-native:qsvc-native /var/lib/qsvc-native
install -d -m 0755 /var/lib/qsvc/onprem-trial
python3 - <<'PYTRIAL'
import os,time,uuid
from pathlib import Path
p=Path('/var/lib/qsvc/onprem-trial')
if p.is_symlink() or p.stat().st_uid!=0 or p.stat().st_mode & 0o022:raise SystemExit('Unsafe trial state directory')
for name,value in [('installed-at',str(time.time_ns()//1000000)),('installation-id',str(uuid.uuid4()))]:
 f=p/name
 if f.exists():
  if f.is_symlink() or not f.is_file():raise SystemExit('Invalid trial state file')
  continue
 fd=os.open(f,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o644)
 with os.fdopen(fd,'w') as stream:stream.write(value+'\n')
PYTRIAL
ln -s "$release" /opt/qsvc-native/current
node_bin=$(command -v node)
for service in sfu signaling auth meeting recording; do
 cat >"/etc/systemd/system/qsvc-native-$service.service" <<UNIT
[Unit]
Description=QS-VC native $service
After=network-online.target
Wants=network-online.target
[Service]
User=qsvc-native
Group=qsvc-native
WorkingDirectory=/opt/qsvc-native/current/services/$service
EnvironmentFile=/etc/qsvc/native/service.env
Environment=QSVC_TRIAL_DIR=/var/lib/qsvc/onprem-trial
$( [[ $service == sfu || $service == signaling ]] && echo 'Environment=NODE_OPTIONS=--require=/opt/qsvc-native/current/trial/stop-at-expiry.cjs' )
ExecStart=$node_bin /opt/qsvc-native/current/services/$service/dist/index.js
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/qsvc-native
UMask=0027
[Install]
WantedBy=multi-user.target
UNIT
done
cat > /etc/qsvc/native/Caddyfile <<CADDY
https://$QSVC_DOMAIN {
 tls /etc/qsvc/native/fullchain.pem /etc/qsvc/native/key.pem
 forward_auth 127.0.0.1:4010 {
  uri /check
 }
 handle /api/onprem/trial {
  header Cache-Control no-store
  respond 204
 }
 encode gzip zstd
 handle /api/auth/* {
  reverse_proxy 127.0.0.1:4002
 }
 @meetings path /api/notifications /api/notifications/* /api/meetings /api/meetings/* /api/users/* /api/admin/*
 handle @meetings {
  reverse_proxy 127.0.0.1:4003
 }
 @recording path /api/recordings /api/recordings/*
 handle @recording {
  reverse_proxy 127.0.0.1:4004
 }
 @signal path /ws /api/ice-servers /api/signaling-ticket
 handle @signal {
  reverse_proxy 127.0.0.1:4001 {
   header_up X-QSVC-Client-IP {http.request.remote.host}
  }
 }
 handle {
  root * /opt/qsvc-native/current/frontend/web/dist
  try_files {path} /index.html
  file_server
 }
}
CADDY
# Dedicated Caddy service avoids overwriting an operator's existing Caddy configuration.
cat > /etc/systemd/system/qsvc-native-web.service <<'UNIT'
[Unit]
Description=QS-VC native HTTPS gateway
After=network-online.target
[Service]
User=qsvc-native
Group=qsvc-native
ExecStart=/usr/bin/caddy run --config /etc/qsvc/native/Caddyfile --adapter caddyfile
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/qsvc-native
Environment=HOME=/var/lib/qsvc-native
Restart=on-failure
[Install]
WantedBy=multi-user.target
UNIT
caddy fmt --overwrite /etc/qsvc/native/Caddyfile
caddy validate --config /etc/qsvc/native/Caddyfile --adapter caddyfile
install -m 0755 "$release/native-linux/qsvc-native" /usr/local/sbin/qsvc-native
cat > /etc/systemd/system/qsvc-native-trial.service <<UNIT
[Unit]
Description=QS-VC native license gate
After=network-online.target
[Service]
User=qsvc-native
Group=qsvc-native
Environment=HOST=127.0.0.1
Environment=QSVC_TRIAL_DIR=/var/lib/qsvc/onprem-trial
ExecStart=$node_bin /opt/qsvc-native/current/trial/gateway.cjs
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
Restart=on-failure
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now qsvc-native-{trial,sfu,signaling,auth,meeting,recording,web}.service
echo "Native services installed. Run sudo qsvc-native status and health. URL: https://$QSVC_DOMAIN"
echo 'Configure firewall/DNS/TURN, verify TLS trust and create the administrator using the approved enrollment procedure before handover.'
