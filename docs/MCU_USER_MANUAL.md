# QS-VC Enterprise MCU and Room-System Integration

## Current implementation status

The intranet web meetings use the QS-VC mediasoup SFU. The optional enterprise
room-system path is the Poly bridge in [`deploy/poly-bridge/README.md`](../deploy/poly-bridge/README.md):
it connects the live SFU media routers to a separately operated FreeSWITCH
conference server. FreeSWITCH performs the conference mixing/composition; the
QS-VC bridge carries browser media to and from it and relays room-device lobby
and roster events.

The older `services/mcu` package is **not a media MCU**. It has in-memory room
state only. Its health response reports `mediaReady: false`, gateway status is
unavailable, and the intranet launcher does not start it. It must not be used
to claim video composition, audio mixing, SIP/H.323, RTMP, or server-side
recording. The old placeholder dial-in numbers have been removed.

## What the intranet launcher does

`node start-intranet.js` starts the normal QS-VC services. To require the
enterprise MCU bridge, build `deploy/poly-bridge` and set either
`POLY_BRIDGE_ENABLED=true` or the legacy alias `MCU_ENABLED=true` in the root
`.env`, or launch the explicit MCU-required profile with `npm run intranet:mcu`.
The launcher then:

1. Requires the built bridge module and strong matching `SFU_CONTROL_TOKEN` and
   `BRIDGE_API_TOKEN` secrets.
2. Requires non-default FreeSWITCH ESL and drachtio credentials and checks that
   those configured services are reachable before starting the app.
3. Mounts the bridge inside the SFU process and enables the signed-in host
   signaling/UI controls.

The launcher does not install, configure, or start FreeSWITCH, drachtio, or an
H.323 gateway. If those services are missing, MCU-required startup fails with a
dependency error. Do not enable the flag until the operator has configured the
private network, firewall, TLS/SRTP policy, FreeSWITCH conference profile, SIP
routes, and the required H.323 module or an external H.323-to-SIP gateway.

See [`deploy/poly-bridge/.env.example`](../deploy/poly-bridge/.env.example) for
bridge variables and the bridge README for its supported setup procedure.

## Capabilities and current limits

| Capability | Current code status |
| --- | --- |
| Browser-only QS-VC meetings | Run on the SFU; independent of the MCU bridge |
| SFU-to-FreeSWITCH bridge | Implemented and opt-in; must be built and configured |
| SIP Poly room devices | Bridge path is implemented; a live endpoint call is not verified in this environment |
| H.323 Poly room devices | Requires a working FreeSWITCH H.323 module or external H.323 gateway; not verified |
| Audio/video mixing and composite | Performed by the configured FreeSWITCH MCU, not `services/mcu`; live media is unverified |
| Host lobby, mute, remove, and roster | UI/API path is integrated; requires a live bridge and endpoint test |
| RTMP ingest/output and MCU-side recording | Not provided by this QS-VC integration |
| H.239/BFCP content sharing | Not supported by this bridge path |
| Device/protocol encryption and interoperability | Must be validated against the deployed endpoint, firmware, FreeSWITCH profile, and network policy |
| AT-01 (H.323 Poly + SIP Poly + QS-VC browser in one call) | Not run; do not claim interoperability until the acceptance test passes |

Enabling the bridge proves configuration and mount selection only. It does not
prove that media flows or that a room device renders it. The bridge room health
check is a transport counter check; acceptance requires human verification of
two-way audio and video on each endpoint and saved evidence in the interop
tracker.

## Host workflow

1. Start a normal QS-VC regular meeting and join as its signed-in host.
2. Choose **Host controls → Enable room devices**. This creates the room bridge
   and its SFU-to-MCU media legs.
3. Have a SIP or H.323 endpoint dial the room alias through the operator's
   configured gateway route. There are no QS-VC-provided public dial-in numbers.
4. Admit the endpoint from the waiting list. Verify that it appears in the room
   roster and test two-way audio/video in person.
5. Run the health check and AT-01 collector from the authorized media network;
   record endpoint model, firmware, codecs, encryption, observations, and
   evidence in `QSVC_Poly_Interop_Tracker.xlsx`.

If the bridge is not built, secrets are missing, FreeSWITCH/drachtio cannot be
reached, or an endpoint cannot join, treat MCU mode as unavailable and use the
standard browser meeting path. Never display a synthetic dial-in number or
report a successful call based only on service startup.
