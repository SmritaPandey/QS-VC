# Native Linux server (source implementation; host qualification pending)

This path runs the five Node services, HTTPS gateway and license gate directly under systemd. It uses no VM, Docker, Podman or container engine. Initial supported target: Ubuntu 24.04 x86_64 with native Node.js 22 and systemd. Windows native installation is a separate unsupported target; the existing Windows setup remains a Hyper-V appliance.

## Build and trusted delivery

On a clean matching Ubuntu release builder with Node22, Python3, OpenSSL and mediasoup build prerequisites installed:

```
QSVC_ONPREM_LICENSE_PUBLIC_KEY=/trusted/license-public.pem bash deploy/vc-onprem/native-linux/build.sh 1.0.0 /new/native-release
```

The script installs locked dependencies, builds existing services/web with onprem settings, stages runtime dependencies and the trial gate, and creates the existing release manifest. No private key is embedded. Sign that manifest using `deploy/vc-onprem/release/sign.sh`. The trusted operator must run the independently delivered `release/verify.sh` against the stage and independently pinned public release keys BEFORE executing its setup script. Verification requires OpenSSL with both signing algorithms, as in the existing release workflow. Never execute a downloaded installer to decide whether that installer is trustworthy.

No compiled release, signed payload or `.run` wrapper is supplied by these source scripts alone. Artifacts are OS/CPU-specific because mediasoup contains native binaries. Build requires network access unless every locked dependency is already supplied in an approved local registry/cache.

## Install

Copy `answers.example.env`, fill it, and protect it with `chown root:root` and `chmod 600`. It is a trusted root shell configuration. Provide the organization certificate/full chain and private key. Install native Node22 beforehand from an approved source; optionally set `QSVC_INSTALL_PACKAGES=yes` to install Caddy/PostgreSQL client and, in local mode, PostgreSQL/Redis through the configured apt repositories. This option changes host packages and starts local dependencies. Default `no` requires preinstalled packages and supports prepared offline hosts.

Choose `QSVC_DATABASE_MODE`:

- `existing`: supply separate restricted auth/meeting PostgreSQL URLs, verified TLS/CA for remote DB, Redis URL and matching host/port. Existing database contents are not replaced. Migrations run only with explicit `QSVC_APPLY_MIGRATIONS=yes` and a separate migration-owner URL. Back up first. Legacy schemas without a migration ledger are rejected by the existing runner. Provision service roles using the reviewed `db/create-application-accounts.sql`; do not use the DB administrator as a runtime account.
- `local`: provisions native PostgreSQL/Redis packages only when package installation is opted in; creates a new dedicated `qsvc_native` database and two restricted service logins. Refuses existing names, never drops/replaces them. Requires explicit migration opt-in, runs migrations locally as postgres, then grants the existing application permission roles. A failed partial setup needs operator inspection; do not drop data to retry automatically.

```
sudo bash /verified/native-release/native-linux/setup.sh /verified/native-release /root/native-answers.env
sudo qsvc-native status
sudo qsvc-native health
```

Migration-owner credentials are omitted from the generated service environment. Each service runs as the dedicated unprivileged account. Runtime secrets are generated per purpose. The gateway uses the existing 14-day/license gate and persistent installation ID; signaling/SFU enforce expiry too. No existing container deployment is converted or overwritten.

## Network and optional dependencies

Supply private DNS resolving the configured domain to the reachable server; distribute the organization CA trust; keep clocks synchronized. Bind service control APIs to loopback and permit external HTTPS443 plus configured SFU UDP40000–40100. Review firewall policy before exposure. Existing TURN must be reachable for restricted networks; set its URL/credentials. Recordings default to /var/lib/qsvc-native/recordings on the customer host. Place /var/lib/qsvc-native on encrypted storage and include recordings in the site backup and restore procedure. A configured AWS S3 bucket takes precedence for installations that already use it.

## Operations, rollback and remaining checks

`qsvc-native start|stop|restart|logs|status|health` manages native units without touching PostgreSQL/Redis data. Root configuration lives under `/etc/qsvc/native`, app data under `/var/lib/qsvc-native`, signed releases under `/opt/qsvc-native/releases`, and trial/license state under `/var/lib/qsvc/onprem-trial` (never reset).

This first installer refuses existing native installations. Before a reviewed upgrade, back up PostgreSQL with your DBA tooling, runtime config/certificates, trial state and recording objects. Restoration must use a schema-compatible release; reverting the `current` symlink alone cannot undo database migrations. Keep the old release/config and an independently verified database backup. No automatic rollback or backup/restore execution is claimed.

Unverified: actual Ubuntu installation, apt repository package availability, systemd sandbox behavior, Caddy certificate validation, live PostgreSQL role/migration behavior, Redis connectivity, license activation, multi-participant media/TURN, firewall policy, backup/restore and offline host qualification. Source syntax checks are not release acceptance.
