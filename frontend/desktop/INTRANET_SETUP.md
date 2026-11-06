# QS-VC Intranet — install, connect and admin access

Version 1.4.0 · 5 November 2026

This guide covers signing in as a platform admin, testing the website and desktop clients, installing QS-VC on Windows, Mac, or Linux x64, and connecting it to an organisation workspace.

| File | For | SHA-256 |
| --- | --- | --- |
| `QS-VC-Windows-x64.zip` | Windows 10/11, 64-bit (contains the setup app) | ZIP hash is release-specific; setup EXE SHA-256: `807796fb30b062e5fdee1b028b8c51d21dabb72aef7b4f0fe6b6cf8e516c0b45` |
| `QS-VC-macOS-arm64.zip` | Mac with Apple silicon (M1/M2/M3/M4) | Release-specific; shown after download and recorded in the deployment artifact |
| `QS-VC-macOS-x64.zip` | Mac with Intel chip | Release-specific; shown after download and recorded in the deployment artifact |
| `QS-VC-Linux-x64.tar.gz` | Linux desktop, x86-64 | Release-specific; shown after download and recorded in the deployment artifact |

Choose the matching operating system in the signed-in Intranet page. For Mac,
Apple menu → **About This Mac** shows "Chip: Apple M…" (choose Apple silicon)
or "Processor: Intel" (choose Intel). The Windows ZIP contains the `.exe` installer. The Linux archive currently supports x86-64 desktops; Linux ARM is not packaged yet.

> The shared admin password is not stored in this repository. Get it from the operator.

---

## 1. Platform admins

These three accounts have the **admin** role, which gives full access to every feature.

| Email | Role |
| --- | --- |
| services@madylabs.xyz | admin |
| contact@neurqai.com | admin |
| smrita.official@gmail.com | admin |

**Shared first sign-in password:** `<shared admin password from the operator>`

What admin unlocks:

- Sign in on the website or the QS-VC app (Windows, Mac, or supported Linux x64) with the email above and the password supplied privately by the operator.
- Open the **Intranet** page to open the configured test workspace and choose an available desktop build.
- Join **any** meeting as host, even before the organiser arrives. This bypasses meeting passwords, locked rooms, the waiting room and participant limits.
- Mute, remove, lock, record and end any meeting.
- Start or end any meeting in their organisation through the meeting service.

Each admin should change this password after the first sign-in. The password screen is not built yet, so until it is, the operator re-runs step 2.3 with a new password.

### 1.1 Admin test: website, workspace and desktop app

Use this flow to confirm that the signed-in admin experience and the available
Windows, Mac, and Linux downloads work. The default admin destination is the shared online
QS-VC test workspace; it is **not** a private intranet or an isolated tenant.
Use sample names and meeting content there.

1. Get the admin email and current password from the operator. The password is
   intentionally not written in this guide or stored in Git.
2. In a browser, open [qsvcmeet.com](https://qsvcmeet.com), sign in with that
   admin account, then open **Intranet** from the website navigation. You can
   also go directly to `https://qsvcmeet.com/intranet` after signing in.
3. Confirm the signed-in view shows **Open workspace** and **Download QS-VC**.
   The workspace button should open `https://qsvcmeet.com/app` and identify it
   as the online test workspace. The website session is not automatically
   passed into a separately running desktop app, so sign in there too.
4. Under **Your device**, choose the computer you are testing:
   - **Windows 10/11 (64-bit)** for a 64-bit Windows PC.
   - **Mac · Apple silicon (M1–M4)** for an M-series Mac.
   - **Mac · Intel** for an Intel Mac.
   - **Linux · x64** for a 64-bit x86 Linux desktop.
   Select **Download selected app**. An unavailable build appears disabled; it
   means that installer has not been staged by the deployed service.
5. After the download, note the SHA-256 shown by the page. Compare it with the
   value from the matching approved release before installing. The Windows
   release value is in the table above. Mac and Linux checksums are release-specific and
   are stored alongside each archive in the protected deployment artifact;
   ask the operator for that release's value. The page's displayed hash is a
   fingerprint of the received file, not an independent authenticity check.
6. Install the downloaded app using the matching section below. At first
   launch, enter `https://qsvcmeet.com` as the organisation address, then sign
   in with the admin credentials. If the app reports invalid credentials,
   ask the operator to confirm that the same account is provisioned in the
   meeting service; website sign-in alone does not create a desktop workspace
   account.
7. Verify the basics with sample data: create a test meeting, join it from a
   second browser/device, check camera and microphone, then leave and sign out.
   Sign out separately from the website and desktop app because they have
   separate sessions.

If **Intranet** says access is not approved, first confirm the signed-in email
is one of the platform admins above and that its admin account exists in the
auth service. If **Open workspace** is missing or points elsewhere, the
operator must set `QSVC_ADMIN_WORKSPACE_URL=https://qsvcmeet.com` and deploy the
updated auth service. Seeing the correct controls in source code does not
change the live website until that deployment is completed.

---

## 2. Server setup (operator, once)

Run these on the server that hosts QS-VC (for the AWS demo, the EC2 instance in `/opt/qsvc`).

### 2.1 Deploy the latest code

Redeploy **auth**, **meeting**, **signaling** and the **Cloudflare Worker** from the current `QS-VC-private` folder.

### 2.2 Run the database migrations

```bash
node db/migrate.js
```

Run all pending migrations. This includes `013_linux_desktop_support.sql`, which allows Linux x64 installer downloads and activations to be recorded on existing databases.

### 2.3 Create the three admin accounts with the shared password

```bash
DATABASE_URL='postgres://<migration user>:<password>@<host>:5432/qsvc' \
QSVC_ADMIN_PASSWORD='<shared admin password from the operator>' \
node services/auth/scripts/create-platform-admins.cjs
```

- On the AWS demo, run it on the EC2 instance from `/opt/qsvc`, with the same database user and TLS settings (`POSTGRES_CA_FILE`) used for migrations. The private database is not reachable from outside AWS.
- Creates any of the three accounts that don't exist yet. Existing accounts get the new password and the admin role.
- Run it again any time to reset the shared password. Doing so also signs the admins out everywhere.
- The script never prints or stores the password; only a bcrypt hash goes into the database.
- Put a space before the command, or clear your shell history afterwards, so the password does not stay in `~/.bash_history`.

### 2.4 Settings in the server `.env`

```bash
# Who is a platform admin (these are also the built-in defaults)
QSVC_ADMIN_EMAILS=services@madylabs.xyz,contact@neurqai.com,smrita.official@gmail.com

# Temporary admin test workspace. Opens the shared online QS-VC app, not an isolated intranet.
QSVC_ADMIN_WORKSPACE_URL=https://qsvcmeet.com

# Enterprise users who are not admins: one entry per organisation
ENTERPRISE_ACCESS_JSON=[{"tenantId":"<tenant id>","userIds":["<user id>"],"workspaceUrl":"https://<your intranet address>/"}]

# The auth container reads this path; deploy/aws/compose.yml mounts the host installer folder here.
ENTERPRISE_WINDOWS_INSTALLER=/opt/qsvc/installers/QS-VC-Windows-x64.zip
ENTERPRISE_MACOS_ARM64_INSTALLER=/opt/qsvc/installers/QS-VC-macOS-arm64.zip
ENTERPRISE_MACOS_X64_INSTALLER=/opt/qsvc/installers/QS-VC-macOS-x64.zip
ENTERPRISE_LINUX_X64_INSTALLER=/opt/qsvc/installers/QS-VC-Linux-x64.tar.gz
```

The protected production workflow verifies the Windows setup executable,
packages it as a ZIP, builds both Mac zips on a macOS runner, and builds the
Linux x64 tar.gz on an Ubuntu runner. It includes all four archives with
release-specific checksum files in the deployment artifact. Rebuild all four
packages from the same source revision after desktop changes.
The enterprise app-activation metric is reported only by client versions that
include its first-sign-in reporting code; older staged ZIPs do not send that
metric even though they remain downloadable. Replace each ZIP and its checksum
together after the protected platform builds.
For manual Mac builds, use
`npm --prefix frontend/desktop run package:mac:arm64` or
`npm --prefix frontend/desktop run package:mac:x64`. The download screen shows
the checksum for the exact archive downloaded. For a manual/local Windows
staging run, assemble and check it from the repository root:

```bash
cat deploy/aws/outgoing/QS-VC-Windows-Setup.exe.part00 \
    deploy/aws/outgoing/QS-VC-Windows-Setup.exe.part01 \
    deploy/aws/outgoing/QS-VC-Windows-Setup.exe.part02 \
    deploy/aws/outgoing/QS-VC-Windows-Setup.exe.part03 \
    > deploy/aws/installers/QS-VC-Windows-Setup.exe
shasum -a 256 deploy/aws/installers/QS-VC-Windows-Setup.exe
printf '%s  %s\n' '807796fb30b062e5fdee1b028b8c51d21dabb72aef7b4f0fe6b6cf8e516c0b45' 'QS-VC-Windows-Setup.exe' > deploy/aws/installers/QS-VC-Windows-Setup.exe.sha256
(cd deploy/aws/installers && zip -j QS-VC-Windows-x64.zip QS-VC-Windows-Setup.exe QS-VC-Windows-Setup.exe.sha256)
shasum -a 256 deploy/aws/installers/QS-VC-Windows-x64.zip > deploy/aws/installers/QS-VC-Windows-x64.zip.sha256
```

Confirm the setup EXE hash is
`807796fb30b062e5fdee1b028b8c51d21dabb72aef7b4f0fe6b6cf8e516c0b45`. The
Windows archive contains the `.exe` and its checksum file. Transfer the archive
and its `.sha256` sidecar into the deployment installer folder. The Intranet
page enables each device choice only when auth can read its archive.

For a Linux x64 staging build, run `npm --prefix frontend/desktop run package:linux:x64`
on Linux, then copy `frontend/desktop/release/QS-VC-Linux-x64.tar.gz` and its
`.sha256` sidecar into the protected installer directory. After extracting the
archive on the target Linux distribution, run the `QS-VC` executable in the
extracted folder. Required system libraries vary by distribution, so validate
the archive on the organisation's managed Linux image before enabling it in
the portal. Linux ARM builds are not included.

The platform admin fallback opens `https://qsvcmeet.com/app` and is labelled as
an online test workspace. For a real organisation deployment, set
`QSVC_ADMIN_WORKSPACE_URL` to the organisation's own HTTPS workspace URL. Restart
auth after changing its environment.

Do **not** set `QSVC_ADMIN_SIGNUP_OPEN`. The script in 2.3 creates the admin accounts directly. Public sign-up keeps refusing these three addresses, so nobody else can claim them.

### 2.5 Optional enterprise MCU and room-system support

QS-VC browser meetings use the SFU by default. SIP/H.323 room devices require a
separately operated FreeSWITCH MCU and the QS-VC Poly bridge; the Windows/Mac
installer does not include or install either service. The old `services/mcu`
package is control-only and must not be presented as the media MCU.

#### Step-by-step setup and test

This is a **server-side Linux deployment**. Windows and Mac QS-VC clients can
join it from the intranet, but neither desktop installer runs FreeSWITCH or
drachtio. Use an approved Debian 12 media host for FreeSWITCH and a Linux
host/container for drachtio. The local Mac/Windows launcher can only connect
to services already running and reachable on the private network.

1. **Plan the private network.** Reserve addresses for the QS-VC SFU/bridge,
   FreeSWITCH and Poly endpoint VLANs. Confirm routes in both directions and
   choose the FreeSWITCH RTP range. Allow only required traffic: SIP/TLS and
   H.323 from approved endpoint networks, bridge SIP/RTP between QS-VC and
   FreeSWITCH, media UDP between endpoints and the MCU, and private control
   access for ESL (8021) and drachtio (9022). Do not expose ESL, drachtio
   control, or the SFU bridge API to the public internet. Firewall values in
   the sample config are examples; replace them with your real addresses.
2. **Install FreeSWITCH on the Debian 12 MCU host.** Review
   [`install-freeswitch.sh`](../../deploy/poly-bridge/scripts/install-freeswitch.sh)
   first. It installs FreeSWITCH and conference/media modules and requires a
   SignalWire token securely provided to the operator. Run it only on the
   dedicated media host with the approved privileged account. It may not find
   `mod_h323` in packages; if so, build that module from source or use an
   existing Poly RMX/DMA or other H.323-to-SIP gateway. Do not assume H.323 is
   available just because FreeSWITCH installed.
3. **Apply the FreeSWITCH configuration.** Use the files under
   [`deploy/poly-bridge/freeswitch`](../../deploy/poly-bridge/freeswitch) as
   templates. Replace all sample IPs and ACL ranges. Merge `vars.xml.snippet`,
   `acl.conf.xml.snippet` and `conference.conf.xml.snippet` into their named
   FreeSWITCH configuration files. Install `qsvc-bridge.xml` and
   `qsvc-poly.xml` in the loaded SIP profiles, and ensure FreeSWITCH loads
   those profiles. Install `dialplan/qsvc.xml` in an included dialplan context.
   Configure a valid TLS certificate for the Poly TLS profile and set the
   event socket password to the same private value as `FS_ESL_PASSWORD` below.
   Restrict the event socket and trusted bridge profile to the QS-VC host only.
   Install `h323.conf.xml` only when `mod_h323` is actually present. Review
   encryption policy and endpoint compatibility before allowing calls.
4. **Start and check FreeSWITCH.** Restart the service after configuration.
   From the MCU host, use `fs_cli` to check that FreeSWITCH responds, the
   `qsvc` conference profile and SIP profiles are loaded, and (if required)
   `mod_h323` is loaded:

   ```bash
   sudo systemctl restart freeswitch
   fs_cli -x "show modules"
   fs_cli -x "sofia status"
   fs_cli -x "conference list"
   ```

   Check service logs for XML parse, TLS certificate, ACL and module errors.
   Do not proceed until the private ESL endpoint is reachable from the QS-VC
   host.
5. **Start drachtio on the Linux QS-VC bridge/SFU host.** Set a unique,
   non-default `DRACHTIO_SECRET` in the root QS-VC `.env` first (keep it for
   the matching value in step 6), then start the supplied container from the
   repository root:

   ```bash
   docker compose --env-file .env -f deploy/poly-bridge/docker-compose.yml up -d
   ```

   Verify the drachtio container is running and its private admin port is
   reachable from the SFU process. This is a separate service; the QS-VC
   launcher does not install or start it.
6. **Configure QS-VC secrets and addresses.** In the root `.env` on the host
   running the SFU/bridge, set the following using real routable private IPs.
   Generate strong random secrets outside source control; set the two bridge
   tokens to the same value. Use the FreeSWITCH event-socket password and
   drachtio secret configured in the previous steps:

   ```dotenv
   POLY_BRIDGE_ENABLED=true
   SFU_CONTROL_TOKEN=REPLACE_WITH_STRONG_RANDOM_SECRET
   BRIDGE_API_TOKEN=REPLACE_WITH_THE_SAME_SECRET
   BRIDGE_RTP_LISTEN_IP=0.0.0.0
   BRIDGE_RTP_ANNOUNCED_IP=REPLACE_WITH_QSVC_PRIVATE_IP
   FS_SIP_HOST=REPLACE_WITH_FREESWITCH_PRIVATE_IP:5090
   FS_ESL_HOST=REPLACE_WITH_FREESWITCH_PRIVATE_IP
   FS_ESL_PORT=8021
   FS_ESL_PASSWORD=REPLACE_WITH_PRIVATE_EVENT_SOCKET_PASSWORD
   FS_CONF_PROFILE=qsvc
   DRACHTIO_HOST=REPLACE_WITH_DRACHTIO_PRIVATE_IP
   DRACHTIO_PORT=9022
   DRACHTIO_SECRET=REPLACE_WITH_PRIVATE_DRACHTIO_SECRET
   BRIDGE_SRTP=mandatory
   BRIDGE_LEG_VIDEO_CODEC=VP8
   ```

   Keep `.env` out of Git and limit file access to the service operator. Set
   `BRIDGE_RTP_ANNOUNCED_IP` to the QS-VC address FreeSWITCH can reach, not
   `127.0.0.1`. Confirm the selected codec is supported by your FreeSWITCH
   build and apply the organisation's approved TLS/SRTP policy.
7. **Build and start the MCU-enabled intranet profile.** From the repository
   root, install/build the bridge dependencies, stop any existing local QS-VC
   processes on the SFU/signaling ports, then start the required profile:

   ```bash
   npm --prefix deploy/poly-bridge ci
   npm --prefix deploy/poly-bridge run build
   npm run intranet:mcu
   ```

   The launcher fails if the bridge build, matching tokens, non-default
   credentials, FreeSWITCH ESL or drachtio are missing or unreachable. A
   separately managed server deployment must configure and mount the bridge
   in the deployed SFU and enable its signaling relay; this local command does
   not change a hosted workspace.
8. **Run a controlled SIP room-device check.** Open the intranet workspace
   from a Windows or Mac client, sign in as an approved host, create a regular
   unlocked test meeting and select **Host controls → Enable room devices**.
   Have an approved SIP Poly endpoint dial the room alias through the configured
   FreeSWITCH route. Admit it from the waiting list. Verify it appears in the
   roster and test two-way audio and video with a QS-VC browser/client. Dial
   strings depend on the endpoint/gateway; the included dialplan accepts a
   room alias and the documented legacy form is `<MCU-IP>##<room-alias>`.
   For H.323, continue only after confirming the H.323 module or gateway is
   installed and reachable.
9. **Run and record AT-01.** Join one H.323 Poly device, one SIP Poly device,
   and one QS-VC browser in the same meeting at the same time. During that call,
   run the collector from the MCU host (or a host with `fs_cli`, `curl` and
   authorized bridge access). Use the live SFU room ID, not the public meeting
   code:

   ```bash
   read -r -p "Live SFU room ID: " ROOM
   read -r -p "Private SFU bridge URL: " BRIDGE
   read -r -s -p "Bridge API token: " TOKEN
   printf '\n'
   export ROOM BRIDGE TOKEN
   bash deploy/poly-bridge/scripts/verify-at01.sh
   unset TOKEN
   ```

   Save the generated evidence with endpoint models, firmware, negotiated
   codecs, encryption and human observations in the lab's
   `QSVC_Poly_Interop_Tracker.xlsx` workbook (the workbook is maintained
   separately from this repository).
   Confirm each audio/video direction by actually hearing and seeing it on
   the browser, SIP endpoint and H.323 endpoint. Collector output and service
   health alone do not prove endpoint media interoperability.

When the MCU services are not configured, use browser-only mode with
`npm run intranet`; room-device MCU functions are unavailable in that mode.
QS-VC does not provide public SIP/PSTN dial-in numbers. No SIP Poly ↔ H.323
Polycom ↔ browser end-to-end call has been verified in this checkout. Complete
AT-01 with real devices and record media observations before claiming
interoperability. For capability limits and reference details, see
[the MCU status guide](../../docs/MCU_USER_MANUAL.md) and
[Poly bridge reference](../../deploy/poly-bridge/README.md).

---

## 3. Install QS-VC on Windows

1. Sign in on the website, open **Intranet**, choose **Windows 10/11 (64-bit)** under **Your device**, then select **Download selected app**.
2. In File Explorer, right-click `QS-VC-Windows-x64.zip` and choose **Extract All**. In PowerShell, check the extracted setup file:
   ```powershell
   Get-FileHash .\QS-VC-Windows-Setup.exe -Algorithm SHA256
   ```
   The result must match the setup EXE SHA-256 at the top of this guide.
3. Run `QS-VC-Windows-Setup.exe`. The installer is not code-signed yet, so Windows SmartScreen may say "Windows protected your PC". Select **More info**, then **Run anyway**. Do this only if the checksum matched.
4. Choose the install folder, then **Install**. A desktop and Start-menu shortcut called **QS-VC** is created. No administrator rights are needed; it installs for the current user.

---

## 3b. Install QS-VC on a Mac

1. Download the zip for your Mac (see the table at the top) and double-click it. **QS-VC.app** appears next to it.
2. Drag **QS-VC.app** into **Applications**.
3. Open it once from Applications. The app is not notarised by Apple yet, so macOS says it "cannot be opened because Apple cannot check it for malicious software". Select **Done** (not Move to Bin).
4. Open **System Settings → Privacy & Security**, scroll down to "QS-VC was blocked", select **Open Anyway**, then confirm with your Mac password.
5. If macOS instead says the app "is damaged", run this once in **Terminal**, then open it again:
   ```bash
   xattr -cr /Applications/QS-VC.app
   ```
6. When asked, allow **Camera** and **Microphone**. For screen sharing, allow QS-VC under **System Settings → Privacy & Security → Screen & System Audio Recording**, then restart the app.

To check the download first, run `shasum -a 256 ~/Downloads/QS-VC-macOS-arm64.zip` (or `QS-VC-macOS-x64.zip`) in Terminal and compare it with the checksum supplied by the operator for the same release.

---

## 4. Connect and use the app

QS-VC has its own interface; it does not show the public website.

1. Connect to the office network, or to the VPN your IT team supplied.
2. Open **QS-VC**. On first start it asks for the **Organisation address** (the workspace address from your administrator). Only `https://` addresses are accepted. Select **Connect**.
3. **Sign in** with your email and password. Admins use the shared password above. Tick **Keep me signed in** to skip this next time; the session is stored encrypted in the Mac Keychain or Windows credential store.
4. You land on **Home**:
   - **New meeting** starts a meeting now and copies the invitation to your clipboard.
   - **Join with a code** opens any meeting by its code (for example `QS-ABCD-EFGH-IJKL`).
   - **Schedule** plans a meeting and gives you a code and invitation to share.
   - **Coming up** lists your next meetings with **Join** and **Copy invitation**.
5. **Meetings** shows last week to three weeks ahead. **Settings** has your account (sign out, keep me signed in), Light / Dark / System appearance, and the organisation address.
6. Joining opens the meeting room: check your camera and microphone, then **Join meeting**. When you leave, you return to Home.

Not signed in? On the sign-in screen, **or join as a guest** lets you enter a meeting code without an account.

**Change the organisation address later:** **Settings → Organisation → Change**.

**IT pre-configuration (optional):** to skip the first-run question on managed PCs, place a `workspace.json` file next to `QS-VC.exe`:

```json
{ "workspaceUrl": "https://meet.your-organisation.example/" }
```

**Meeting links:** `qsvc://join/<MEETING-CODE>` opens the meeting directly in the app.

---

## 5. Troubleshooting

| Problem | Fix |
| --- | --- |
| "Cannot reach that address" when connecting | Use your real workspace address (the examples in this guide are placeholders). To try the app without an intranet, use `https://qsvcmeet.com`. Then check the office network or VPN |
| "Cannot reach your organisation workspace" | Connect to the office network or VPN, then select **Retry** |
| Sign-in says "Invalid email or password" | Check the email; operator can reset with step 2.3 |
| Sign-in says "Too many auth attempts" | Wait 15 minutes; the limit is 10 tries per 15 minutes per network address |
| Sign-up says "This address is reserved" | Expected for the three admin emails; use step 2.3 instead |
| Intranet page says access is not approved | The user needs an entry in `ENTERPRISE_ACCESS_JSON`, or is not an admin |
| Signed-in admin sees no Open workspace option | Confirm the deployed auth service has `QSVC_ADMIN_WORKSPACE_URL=https://qsvcmeet.com` and reload `/intranet` |
| A device option is disabled | That platform's installer is not staged in the deployed auth service. Check the installer folder and redeploy auth |
| Desktop app rejects the website admin credentials | Desktop sign-in is separate from the browser session. Confirm the account exists in the workspace's auth service and use that workspace's credentials |
| Screen share shows nothing to pick | Allow QS-VC under Windows Settings → Privacy → Screen capture, then retry |
| Camera or microphone blocked | Windows Settings → Privacy → Camera / Microphone → allow desktop apps |
| Closing the window doesn't quit (Windows) | It keeps running in the tray; right-click the tray icon → **Quit QS-VC** |

---

## 6. Known limits of this build

- The installer is **not code-signed**. Sign it with your organisation's code-signing certificate before wide rollout to remove the SmartScreen warning.
- It was built and checked on Linux and starts under Wine. It has **not been tested on a real Windows PC** yet; please do one install, sign-in and two-person meeting before rolling it out.
- No automatic updates; install the new version over the old one.
- There is no in-app password change yet; reset passwords with step 2.3.
