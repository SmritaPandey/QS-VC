import { timingSafeEqual } from "node:crypto";
import express, { Router } from "express";
import { config } from "./config";
import { FreeSwitch } from "./esl";
import { RoomBridge } from "./roomBridge";
import type { SfuAdapter } from "./sfuAdapter";

export type { SfuAdapter } from "./sfuAdapter";

/**
 * Runs INSIDE the QSVC SFU process (it needs the live mediasoup Router objects).
 * Mount the returned router in the SFU/MCU service, e.g. app.use("/poly", bridge.http).
 */
export function createPolyBridge(sfu: SfuAdapter) {
  if (!config.apiToken.trim()) throw new Error("BRIDGE_API_TOKEN is required");
  const expectedAuthorization = Buffer.from(`Bearer ${config.apiToken}`);
  const fs = new FreeSwitch();
  const waitingCalls = new Map<string, string>();
  const rooms = new Map<string, RoomBridge>();

  fs.on("member-add", (e) => rooms.get(e.room)?.onMemberAdd(e).catch(console.error));
  fs.on("member-del", (e) => rooms.get(e.room)?.onMemberDel(e).catch(console.error));
  fs.on("member-mute", (e) => rooms.get(e.room)?.onMemberMute(e).catch(console.error));
  fs.on("lobby", (e) => {
    if (!validCallId(e.uuid)) return;
    // Direct dial-in via numeric room number
    const dialedNumber = e.dialedNumber as string | undefined;
    if (dialedNumber) {
      handleDialIn(e.uuid, dialedNumber, e).catch(console.error);
      return;
    }
    // Standard lobby flow: room bridge must already be running (started via /rooms/:room/start)
    if (!rooms.has(e.room)) return;
    waitingCalls.set(e.uuid, e.room);
    sfu.notifyLobby(e.room, { callId: e.uuid, displayName: e.displayName, protocol: e.protocol, remoteAddress: e.remoteAddress, encrypted: e.encrypted }).catch(console.error);
  });
  fs.on("lobby-left", (e) => {
    if (waitingCalls.get(e.uuid) !== e.room) return;
    waitingCalls.delete(e.uuid);
    sfu.notifyLobbyLeft(e.room, e.uuid).catch(console.error);
  });

  const http = Router();
  http.use(express.json());
  http.use((req, res, next) => {
    const supplied = Buffer.from(req.get("authorization") ?? "");
    if (supplied.length !== expectedAuthorization.length || !timingSafeEqual(supplied, expectedAuthorization)) return res.status(401).end();
    next();
  });

  const wrap = (fn: (req: express.Request, res: express.Response) => Promise<unknown>) => (req: express.Request, res: express.Response) =>
    fn(req, res).catch((e) => res.status(500).json({ error: String(e?.message ?? e) }));
  const room = (req: express.Request) => {
    const r = rooms.get(req.params.room);
    if (!r) throw new Error(`bridge not running for room ${req.params.room}`);
    return r;
  };

  http.param("room", (req, res, next, value) => {
    if (!/^[a-zA-Z0-9-]{1,80}$/.test(value)) return res.status(400).json({ error: "Invalid room" });
    next();
  });
  function validCallId(value: string) {
    return /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
  }

  /** Ensure the bridge is running for a room, starting it if necessary. */
  async function ensureRoom(roomId: string): Promise<void> {
    if (rooms.has(roomId)) return;
    await sfu.ensureBridge(roomId);
    const rb = new RoomBridge(roomId, sfu, fs);
    rooms.set(roomId, rb);
    try { await rb.start(); } catch (e) { rooms.delete(roomId); await rb.stop(); throw e; }
  }

  /** Handle a dial-in call that arrived via a numeric room number. */
  async function handleDialIn(uuid: string, dialedNumber: string, ev: any): Promise<void> {
    const resolved = await sfu.resolveDialedNumber(dialedNumber);
    if (!resolved) {
      // Number not in service: play error tone and hang up
      await fs.api(`uuid_broadcast ${uuid} ivr/ivr-invalid_number.wav both`);
      // Give it a moment to play, then kill
      setTimeout(() => fs.api(`uuid_kill ${uuid} UNALLOCATED_NUMBER`).catch(() => undefined), 3000);
      return;
    }
    const { roomId, autoAdmit } = resolved;
    try {
      await ensureRoom(roomId);
    } catch (e) {
      console.error(`[dial-in] failed to start bridge for room ${roomId}:`, e);
      await fs.api(`uuid_kill ${uuid} NORMAL_TEMPORARY_FAILURE`);
      return;
    }
    if (autoAdmit) {
      // Immediately admit into the conference (skip lobby)
      const result = await fs.admit(uuid, roomId);
      if (result.startsWith("-ERR")) {
        console.error(`[dial-in] admit failed for ${uuid} to ${roomId}: ${result}`);
      }
    } else {
      // Park in lobby, notify host
      waitingCalls.set(uuid, roomId);
      await sfu.notifyLobby(roomId, {
        callId: uuid,
        displayName: ev.displayName,
        protocol: ev.protocol,
        remoteAddress: ev.remoteAddress,
        encrypted: ev.encrypted,
      });
    }
  }

  http.post("/rooms/:room/start", wrap(async (req, res) => {
    if (!rooms.has(req.params.room)) {
      const rb = new RoomBridge(req.params.room, sfu, fs);
      rooms.set(req.params.room, rb);
      try { await rb.start(); } catch (e) { rooms.delete(req.params.room); await rb.stop(); throw e; }
    }
    res.json({ started: true, room: req.params.room });
  }));
  async function stopRoom(roomId: string) {
    const bridge = rooms.get(roomId);
    rooms.delete(roomId);
    for (const [callId, waitingRoomId] of waitingCalls) {
      if (waitingRoomId !== roomId) continue;
      waitingCalls.delete(callId);
      await sfu.notifyLobbyLeft(roomId, callId);
    }
    await bridge?.stop();
  }

  http.post("/rooms/:room/stop", wrap(async (req, res) => {
    await stopRoom(req.params.room);
    res.json({ stopped: true });
  }));

  /** Replaces the old gateway status: 200 + ok:true ONLY when RTP is flowing both ways. */
  http.get("/rooms/:room/health", wrap(async (req, res) => {
    const h = await room(req).health();
    res.status(h.ok ? 200 : 503).json(h);
  }));

  // Lobby / host admission
  for (const action of ["admit", "deny"] as const) {
    http.post(`/rooms/:room/lobby/:callId/${action}`, wrap(async (req, res) => {
      const { room: roomId, callId } = req.params;
      if (!rooms.has(roomId) || waitingCalls.get(callId) !== roomId) return res.status(404).end();
      waitingCalls.delete(callId);
      const result = action === "admit" ? await fs.admit(callId, roomId) : await fs.deny(callId);
      if (result.startsWith("-ERR")) return res.status(502).json({ error: "MCU rejected the lobby action" });
      await sfu.notifyLobbyLeft(roomId, callId);
      res.json({ result });
    }));
  }

  // Host removal / mute (act on the MCU member, i.e. on media)
  http.post("/rooms/:room/participants/:id/remove", wrap(async (req, res) => {
    const m = room(req).findMember(req.params.id);
    if (!m) return res.status(404).end();
    res.json({ result: await fs.kick(req.params.room, m.memberId) });
  }));
  http.post("/rooms/:room/participants/:id/mute", wrap(async (req, res) => {
    const m = room(req).findMember(req.params.id);
    if (!m) return res.status(404).end();
    res.json({ result: await fs.mute(req.params.room, m.memberId, req.body?.muted !== false) });
  }));

  // Dial-out to a Poly endpoint (SIP URI or H.323 IP/alias)
  http.post("/rooms/:room/dial", wrap(async (req, res) => {
    const { target, protocol = "sip", encryption = "required" } = req.body ?? {};
    if (!target || !/^[\w.@:+#-]+$/.test(target)) return res.status(400).json({ error: "invalid target" });
    room(req);
    res.json({ result: await fs.dialOut(req.params.room, target, protocol, encryption) });
  }));

  return { http, rooms, freeswitch: fs, stopRoom };
}
