import { randomUUID, timingSafeEqual } from "node:crypto";
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
  const starting = new Map<string, Promise<void>>();
  const externalCalls = new Map<string, string>();
  const pendingExternalCalls = new Set<string>();
  const externalDialTasks = new Map<string, Promise<string>>();

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
    const roomId = waitingCalls.get(e.uuid);
    if (!roomId) return;
    waitingCalls.delete(e.uuid);
    sfu.notifyLobbyLeft(roomId, e.uuid).catch(console.error);
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
    const pending = starting.get(roomId);
    if (pending) return pending;
    if (rooms.has(roomId)) return;
    const task = (async () => {
      await sfu.ensureBridge(roomId);
      const rb = new RoomBridge(roomId, sfu, fs);
      rooms.set(roomId, rb);
      try { await rb.start(); } catch (e) { rooms.delete(roomId); await rb.stop(); throw e; }
    })();
    starting.set(roomId, task);
    try { await task; } finally { starting.delete(roomId); }
  }

  /** Handle a dial-in call that arrived via a numeric room number. */
  async function handleDialIn(uuid: string, dialedNumber: string, ev: any): Promise<void> {
    let resolved;
    try { resolved = await sfu.resolveDialedNumber(dialedNumber, ev.pin); }
    catch (error) {
      await fs.deny(uuid);
      throw error;
    }
    if (!resolved) {
      // Number not in service: play error tone and hang up
      await fs.api(`uuid_broadcast ${uuid} ivr/ivr-invalid_number.wav both`);
      // Give it a moment to play, then kill
      setTimeout(() => fs.api(`uuid_kill ${uuid} UNALLOCATED_NUMBER`).catch(() => undefined), 3000);
      return;
    }
    // Only the tenant-scoped lookup service can attest PIN verification.
    if ((resolved.pinRequired && !resolved.pinVerified) || (resolved.encryption === "required" && !ev.encrypted)) {
      await fs.deny(uuid);
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
    await ensureRoom(req.params.room);
    res.json({ started: true, room: req.params.room });
  }));
  async function stopRoom(roomId: string) {
    await starting.get(roomId)?.catch(() => undefined);
    const bridge = rooms.get(roomId);
    rooms.delete(roomId);
    for (const [callId, waitingRoomId] of waitingCalls) {
      if (waitingRoomId !== roomId) continue;
      waitingCalls.delete(callId);
      await sfu.notifyLobbyLeft(roomId, callId);
    }
    await externalDialTasks.get(roomId)?.catch(() => undefined);
    const externalCall = externalCalls.get(roomId);
    externalCalls.delete(roomId);
    if (externalCall) await fs.api(`uuid_kill ${externalCall} NORMAL_CLEARING`).catch(() => undefined);
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
      const result = action === "admit" ? await fs.admit(callId, roomId) : await fs.deny(callId);
      if (result.startsWith("-ERR")) return res.status(502).json({ error: "MCU rejected the lobby action" });
      waitingCalls.delete(callId);
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

  http.post("/rooms/:room/bharatvc/disconnect", wrap(async (req, res) => {
    if (pendingExternalCalls.has(req.params.room)) return res.status(409).json({ error: "Wait for the dial request to finish before disconnecting" });
    const callId = externalCalls.get(req.params.room);
    if (!callId) return res.json({ disconnected: true });
    const result = await fs.api(`uuid_kill ${callId} NORMAL_CLEARING`);
    if (!result.startsWith("+OK") && !result.includes("No such channel")) return res.status(502).json({ error: "External call termination could not be confirmed" });
    externalCalls.delete(req.params.room);
    res.json({ disconnected: true });
  }));

  // The internal bridge token authorizes this route; the signaling host gate runs before forwarding.
  http.post("/rooms/:room/bharatvc", wrap(async (req, res) => {
    const { conferenceId, gateway, pin, consent } = req.body ?? {};
    if (consent !== true || typeof conferenceId !== "string" || !/^[0-9]{6,16}$/.test(conferenceId) ||
        !["sip.bharatvc.nic.in", "bhvc.nic.in"].includes(gateway) || typeof pin !== "string" || !/^[0-9]{4,16}$/.test(pin) ||
        Object.keys(req.body).some(key => !["conferenceId", "gateway", "pin", "consent"].includes(key))) return res.status(400).json({ error: "Invalid Bharat VC SIP invitation" });
    room(req);
    if (externalCalls.has(req.params.room)) return res.status(409).json({ error: "An external connection already exists for this room" });
    const callId = randomUUID();
    externalCalls.set(req.params.room, callId);
    pendingExternalCalls.add(req.params.room);
    let result: string;
    const dialTask = fs.dialBharatVc(req.params.room, `${conferenceId}@${gateway}`, pin, callId);
    externalDialTasks.set(req.params.room, dialTask);
    try { result = await dialTask; }
    finally { pendingExternalCalls.delete(req.params.room); externalDialTasks.delete(req.params.room); }
    if (!rooms.has(req.params.room)) { await fs.api(`uuid_kill ${callId} NORMAL_CLEARING`); return res.status(409).json({ error: "Meeting ended while dialing" }); }
    if (!result.startsWith("+OK")) return res.status(502).json({ error: "Bharat VC dial request rejected" });
    res.status(202).json({ requested: true, callId });
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
