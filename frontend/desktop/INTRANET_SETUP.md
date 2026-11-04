# QS-VC Intranet — install, connect and admin access

Version 1.2.0 · 4 November 2026

This guide covers three jobs: installing QS-VC on Windows or Mac, connecting it to your organisation, and giving the three platform admins full access.

| File | For | SHA-256 |
| --- | --- | --- |
| `QS-VC-Windows-Setup.exe` | Windows 10/11, 64-bit (about 78 MB) | `807796fb30b062e5fdee1b028b8c51d21dabb72aef7b4f0fe6b6cf8e516c0b45` |
| `QS-VC-macOS-AppleSilicon.zip` | Mac with M1/M2/M3/M4 chip (about 94 MB) | `fdaec4887f0dcd408d803e654823a74ccf8a4cdee6740168e1164989cdc9bc04` |
| `QS-VC-macOS-Intel.zip` | Mac with Intel chip (about 100 MB) | `1004550b95b3d921fc1e3cd44b1d2b2fedc3d9daebcbf75fdc3e2dea3db6d974` |

The `.exe` opens only on Windows; a Mac cannot open it. On a Mac, use one of the macOS zips: Apple menu → **About This Mac** shows "Chip: Apple M…" (use Apple Silicon) or "Processor: Intel" (use Intel).

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

- Sign in on the website or the QS-VC app (Windows or Mac) with the email above and the password.
- Open the **Intranet** page and download QS-VC for Windows without a per-user approval.
- Join **any** meeting as host, even before the organiser arrives. This bypasses meeting passwords, locked rooms, the waiting room and participant limits.
- Mute, remove, lock, record and end any meeting.
- Start or end any meeting in their organisation through the meeting service.

Each admin should change this password after the first sign-in. The password screen is not built yet, so until it is, the operator re-runs step 2.3 with a new password.

---

## 2. Server setup (operator, once)

Run these on the server that hosts QS-VC (for the AWS demo, the EC2 instance in `/opt/qsvc`).

### 2.1 Deploy the latest code

Redeploy **auth**, **meeting**, **signaling** and the **Cloudflare Worker** from the current `QS-VC-private` folder.

### 2.2 Run the database migrations

```bash
node db/migrate.js
```

This applies migration `005_signup_tenant_and_platform_admins.sql`. It fixes the "Account creation is temporarily unavailable" error and promotes any existing admin accounts.

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
ENTERPRISE_WINDOWS_INSTALLER=/opt/qsvc/installers/QS-VC-Windows-Setup.exe
```

For the Windows download option, place the verified installer in the host folder
`/opt/qsvc/deploy/aws/installers/` (the read-only volume mounted by
`deploy/aws/compose.yml`). For the release split into `.part00` through
`.part03`, assemble and check it from the repository root:

```bash
cat deploy/aws/outgoing/QS-VC-Windows-Setup.exe.part00 \
    deploy/aws/outgoing/QS-VC-Windows-Setup.exe.part01 \
    deploy/aws/outgoing/QS-VC-Windows-Setup.exe.part02 \
    deploy/aws/outgoing/QS-VC-Windows-Setup.exe.part03 \
    > deploy/aws/installers/QS-VC-Windows-Setup.exe
shasum -a 256 deploy/aws/installers/QS-VC-Windows-Setup.exe
```

Confirm the result is `807796fb30b062e5fdee1b028b8c51d21dabb72aef7b4f0fe6b6cf8e516c0b45`,
then transfer that file to the same relative folder on the deployment host and
redeploy/restart auth. The Intranet page enables **Download for Windows** only
when auth can read the file.

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

Before enabling the bridge, the operator must configure and verify:

- A built `deploy/poly-bridge` package and an SFU deployment that mounts it.
- A FreeSWITCH host with the QSVC conference and SIP profiles configured.
- A reachable drachtio service, private RTP routes/firewall rules, and strong
  non-default ESL and drachtio secrets.
- Matching private `SFU_CONTROL_TOKEN` and `BRIDGE_API_TOKEN` values.
- A working FreeSWITCH H.323 module or an external H.323-to-SIP gateway for
  legacy H.323 devices. SIP support alone does not provide H.323.

For a self-hosted intranet running this repository's local launcher, build the
bridge and select the required MCU profile:

```bash
npm --prefix deploy/poly-bridge ci
npm --prefix deploy/poly-bridge run build
npm run intranet:mcu
```

The launcher fails instead of silently falling back when its module, secrets,
or configured FreeSWITCH/drachtio services are missing. It does not install or
start those media services. In a separately managed production deployment,
the operator must apply the equivalent bridge module and environment settings
to the deployed SFU and signaling services; running this local launcher does
not change the hosted workspace.

In an unlocked regular meeting, the signed-in host selects **Host controls →
Enable room devices**. The endpoint then calls the room alias through the
organisation's configured gateway route, and the host admits it from the
waiting list. QS-VC does not provide public SIP/PSTN dial-in numbers.

The bridge and host controls are integrated in code, but no SIP Poly ↔ H.323
Polycom ↔ browser end-to-end call has been verified. The operator must complete
AT-01 with real devices and record the media observations before claiming
interoperability. See [the MCU setup and status guide](../../docs/MCU_USER_MANUAL.md)
and [Poly bridge instructions](../../deploy/poly-bridge/README.md).

---

## 3. Install QS-VC on Windows

1. Download the installer: sign in on the website, open **Intranet**, then select **Download for Windows**. The window edge glows while it downloads and shows a SHA-256 checksum when done. You can also use the file you were given directly.
2. Check the file before running it. In PowerShell:
   ```powershell
   Get-FileHash .\QS-VC-Windows-Setup.exe -Algorithm SHA256
   ```
   The result must match the SHA-256 at the top of this guide.
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

To check the download first, run `shasum -a 256 ~/Downloads/QS-VC-macOS-AppleSilicon.zip` in Terminal and compare it with the table.

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
| Screen share shows nothing to pick | Allow QS-VC under Windows Settings → Privacy → Screen capture, then retry |
| Camera or microphone blocked | Windows Settings → Privacy → Camera / Microphone → allow desktop apps |
| Closing the window doesn't quit (Windows) | It keeps running in the tray; right-click the tray icon → **Quit QS-VC** |

---

## 6. Known limits of this build

- The installer is **not code-signed**. Sign it with your organisation's code-signing certificate before wide rollout to remove the SmartScreen warning.
- It was built and checked on Linux and starts under Wine. It has **not been tested on a real Windows PC** yet; please do one install, sign-in and two-person meeting before rolling it out.
- No automatic updates; install the new version over the old one.
- There is no in-app password change yet; reset passwords with step 2.3.
