# QSVC Poly Bridge

Real media path between the existing QSVC **mediasoup SFU** (unchanged) and an
**on-prem FreeSWITCH MCU** that legacy H.323 Polycom and SIP Poly endpoints join.
Replaces "gateway status = OK" with a health check that only passes when RTP
flows in both directions.

```
 Browser ──WebRTC──► QSVC SFU (mediasoup) ──┐
                                             │ per-browser UPLINK leg  (SIP+SRTP, Opus/VP8, sendonly)
                                             │ one DOWNLINK leg/room   (SIP+SRTP, recvonly, composite)
                                             ▼
                              FreeSWITCH MCU (mod_conference, video mux, transcode)
                               ▲                      ▲
            SIP/TLS+SRTP (G.722, H.264)       H.323 (G.722, H.264/H.263)
                   Poly SIP endpoint          Legacy Polycom HDX / Group Series
```

* **Uplink** (one per browser participant): the bridge consumes the browser's mic+cam
  producers on a mediasoup PlainTransport and places a SIP call into the MCU room.
  Poly endpoints see each browser user as a tile.
* **Downlink** (one per room): receives the MCU composite and publishes it into the SFU
  as a peer called "Poly room". `relate … nohear` removes browser audio from it, so
  browsers don't hear themselves.
* **Lobby**: Poly dial-ins are parked; QSVC host admits (`uuid_transfer` into the
  conference) or denies. Remove/mute act on the MCU member, i.e. on media.

The bridge runs **inside the SFU process** because it needs live `Router` objects.

## Integrating into QSVC (`services/mcu/src/index.ts` ~line 296)

```ts
import { createPolyBridge, SfuAdapter } from "@qsvc/poly-bridge";

const adapter: SfuAdapter = {
  getRouter: async (roomId) => rooms.get(roomId)!.router,
  listBrowserProducers: async (roomId) => rooms.get(roomId)!.allProducers()
    .filter((p) => !p.appData.bridge)
    .map((p) => ({ producerId: p.id, peerId: p.appData.peerId, displayName: p.appData.displayName,
                   kind: p.kind, source: p.appData.source })),
  onBrowserProducers: (roomId, h) => {
    const r = rooms.get(roomId)!;
    const add = (p) => !p.appData.bridge && h.added({ /* same mapping */ });
    const rem = (id) => h.removed(id);
    r.on("producer-added", add); r.on("producer-closed", rem);
    return () => { r.off("producer-added", add); r.off("producer-closed", rem); };
  },
  announceBridgeProducer: async (roomId, peer, producer) => rooms.get(roomId)!.addVirtualPeerProducer(peer, producer),
  withdrawBridgeProducer: async (roomId, id) => rooms.get(roomId)!.removeProducer(id),
  notifyLobby: async (roomId, w) => signaling.toHosts(roomId, "poly-lobby", w),
  notifyLobbyLeft: async (roomId, callId) => signaling.toHosts(roomId, "poly-lobby-left", { callId }),
  rosterUpsert: async (roomId, p) => signaling.toRoom(roomId, "poly-participant", p),
  rosterRemove: async (roomId, callId) => signaling.toRoom(roomId, "poly-participant-left", { callId }),
};

const bridge = createPolyBridge(adapter);
app.use("/poly", bridge.http);   // replaces the old gateway status route
```

Requirements on the QSVC router: `mediaCodecs` must contain `audio/opus` and
`video/VP8` (or `video/H264` with `BRIDGE_LEG_VIDEO_CODEC=H264`).

## HTTP API (Bearer `BRIDGE_API_TOKEN`)

| Method | Path | Purpose |
|---|---|---|
| POST | `/rooms/:room/start` | Start bridge legs for a meeting |
| POST | `/rooms/:room/stop` | Tear down |
| GET | `/rooms/:room/health` | **200 only if RTP flows both ways** and ≥1 Poly member present, else 503 |
| POST | `/rooms/:room/lobby/:callId/admit` · `/deny` | Host admission |
| POST | `/rooms/:room/participants/:id/remove` | Host removal (hangs up the MCU member) |
| POST | `/rooms/:room/participants/:id/mute` `{muted}` | Host mute |
| POST | `/rooms/:room/dial` `{target, protocol: sip\|h323, encryption}` | Dial-out to Poly |

## Plan

### Phase 0 — Lab and prerequisites (2–3 days)
1. VM on the intranet for FreeSWITCH (4 vCPU / 8 GB per ~10 HD transcoded streams).
2. Run `scripts/install-freeswitch.sh`; copy `freeswitch/` configs (merge `.snippet` files).
3. Decide H.323 path: `mod_h323` built from source **or** existing Poly RMX/DMA as H.323→SIP front end.
4. Run drachtio on the SFU host (`docker compose up -d`).
5. Firewall: SFU host ↔ MCU UDP RTP ranges; MCU ← endpoints TCP 1720, 5060/5061, UDP 16384–32768.
6. Lab endpoints: 1 × Group Series/HDX (H.323), 1 × G7500/Studio X or Trio C60 (SIP), 1 × browser.

### Phase 1 — First media (AT-01, AT-02, AT-03) (1 week)
1. Implement `SfuAdapter` in QSVC; mount `bridge.http`; delete/redirect the status-only gateway route.
2. Start with `BRIDGE_SRTP=off` (bridge then sends `X-Qsvc-Plain: true`) only if SRTP blocks first light; switch back to `mandatory` immediately after.
3. Dial in from both Poly endpoints, admit both from QSVC, join from browser.
4. Run `scripts/verify-at01.sh`; record in the tracker. Gate: all 6 audio + 6 video directions.

### Phase 2 — Host control + encryption (AT-08…AT-14, AT-17, AT-18) (1 week)
1. Wire QSVC host UI to lobby admit/deny, remove, mute endpoints.
2. TLS certs on `qsvc-poly` profile; set Poly endpoints to TLS + SRTP required.
3. Room encryption policy → `qsvc_room_encryption_<room>` (global var or via ESL `global_setvar`).
4. **H.235 (encrypted H.323) is not provided by mod_h323.** If AT-11 is mandatory, legacy H.323
   endpoints must come in via Poly RMX/DMA (which terminates H.235) and reach this MCU over SIP+SRTP.
5. DMA/gatekeeper registration and DTMF PIN (uncomment `gk-address` in `h323.conf.xml`).

### Phase 3 — Content sharing (AT-05…AT-07)
FreeSWITCH's conference does not relay H.239 or BFCP content channels. Options:
* Use Poly RMX (Collaboration Server) as the MCU for content-heavy rooms, keeping this bridge
  (it speaks SIP+SRTP to any MCU; replace `esl.ts` controls with the RMX API), or
* Interim: content shared into the people stream (endpoint setting), documented as "Partial".

### Phase 4 — Branch-to-branch (AT-15, AT-16) and hardening (AT-19…AT-22)
1. One MCU per branch, or central MCU with WAN QoS (DSCP EF audio / AF41 video).
2. `qsvc_branch_trunk` extension: rooms prefixed `brNN-` are trunked over TLS+SRTP to that branch
   (`qsvc_branch_brNN` global var = branch MCU IP).
3. Impairment tests (5 % loss, 512 kbps), 60-min soak, reconnect handling.
4. Known v1 limitation: the "Poly room" composite browsers receive also contains small tiles of
   browser users. Fix options: per-Poly-endpoint downlinks, or MCU layout reservations.

### Phase 5 — Coverage
Fill `QSVC_Poly_Interop_Tracker.xlsx` per model/firmware/mode/codec/content.
USB peripherals: test only through a host (PC/Mac running the QSVC browser).
Teams/Zoom modes: separate validation, not counted toward Poly Video mode support.

## Things to verify on first run (not testable outside your network)
* `rtp_use_ssrc` / `rtp_use_video_ssrc` honored on your FreeSWITCH build (downlink SSRC match).
  If not, the bridge falls back to the SSRC in FreeSWITCH's answer `a=ssrc` line.
* Downlink member with `mute|ghost` doesn't occupy a visible tile on Poly screens.
* Keyframe recovery on HDX after layout changes (raise `video-auto-floor-msec` if slow).

### QSVC checkout integration and AT-01

The SFU mounts this module only when `POLY_BRIDGE_MODULE` points to the
absolute path of this package's built `dist/index.js`. Keep the SFU HTTP
control listener private. Use the same strong secret for `SFU_CONTROL_TOKEN`
and `BRIDGE_API_TOKEN` on the SFU, and configure `SFU_CONTROL_TOKEN` and
`POLY_BRIDGE_ENABLED=true` on signaling. Configure the FreeSWITCH ESL and SIP
addresses, drachtio credentials, and routable RTP addresses from
`.env.example`. The supplied Compose profile runs drachtio on a Linux host.
FreeSWITCH is a separate MCU host and needs a verified SIP profile,
conference configuration, and a working H.323 module or external H.323
gateway. Configure these before enabling the mount.

From the repository root, build the bridge with
`npm --prefix deploy/poly-bridge ci && npm --prefix deploy/poly-bridge run build`.
Start the configured SFU and signaling using the deployment's normal
commands. Join an isolated regular QSVC test meeting as its host before
starting the bridge. Set `ROOM` to the live SFU room ID from the join response,
not the public meeting code. From the authorized control network:

```bash
export BRIDGE=http://127.0.0.1:4000/api/poly
curl --fail-with-body -X POST -H "Authorization: Bearer ${TOKEN:?}" \
  "$BRIDGE/rooms/${ROOM:?}/start"
```

Dial that room ID using the actual FreeSWITCH SIP/H.323 routes. Admit each
endpoint from the QSVC host's waiting list. Confirm audio and video in every
direction with the browser and both physical endpoints, then run the
collector on the MCU host (or a host with working `fs_cli` access):

```bash
ROOM="$ROOM" BRIDGE="$BRIDGE" TOKEN="$TOKEN" bash deploy/poly-bridge/scripts/verify-at01.sh
```

Use an SFU URL reachable from the collector. Save the three participants,
negotiated codecs, encryption and human media observations in the tracker.
Bridge counters establish traffic on the SFU–MCU legs only. They do not
establish that a physical endpoint rendered media.

### Intranet launcher

Build the bridge first. In the root environment set `POLY_BRIDGE_ENABLED=true`
(or legacy `MCU_ENABLED=true`), matching private `SFU_CONTROL_TOKEN` and
`BRIDGE_API_TOKEN` values, and the
FreeSWITCH and drachtio connection settings listed in this package’s
`.env.example`. Use an RTP address reachable by the FreeSWITCH host. The
`npm run intranet:mcu` command selects this required profile explicitly; it
fails fast when the bridge is not built, secrets are weak/missing, or the
configured FreeSWITCH/drachtio ports cannot be reached.
Run `node start-intranet.js` after stopping any existing SFU and signaling
instances on the development ports. The launcher mounts the built bridge in
the SFU and enables the signaling relay. It does not provision FreeSWITCH,
drachtio, or the H.323 gateway.

In an unlocked regular meeting, the signed-in host can open Host controls
and select **Enable room devices**. Dial the room alias using the approved
gateway route. Keep the `qsvc-admitted` dialplan context internal to ESL
transfers. External SIP and H.323 ingress must use the lobby context.
