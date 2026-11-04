import { FreeSwitch } from "./esl";
import { DownlinkLeg, UplinkLeg } from "./sipLeg";
import type { BrowserProducer, PolyParticipant, SfuAdapter } from "./sfuAdapter";

const POLY_PEER = { id: "poly-room", displayName: "Poly room" };

/** Everything the bridge does for one QSVC meeting. */
export class RoomBridge {
  private downlink?: DownlinkLeg;
  private uplinks = new Map<string, UplinkLeg>(); // peerId -> leg
  private peerProducers = new Map<string, { audio?: string; video?: string; name: string }>();
  private polyMembers = new Map<number, PolyParticipant>();
  private unsub?: () => void;
  private pending = new Map<string, NodeJS.Timeout>();

  constructor(readonly room: string, private sfu: SfuAdapter, private fs: FreeSwitch) {}

  async start() {
    const router = await this.sfu.getRouter(this.room);

    this.downlink = new DownlinkLeg(router, this.room);
    this.downlink.onClose = () => console.warn(`[${this.room}] downlink closed by MCU`);
    await this.downlink.start();
    for (const p of this.downlink.producers) await this.sfu.announceBridgeProducer(this.room, POLY_PEER, p);

    for (const p of await this.sfu.listBrowserProducers(this.room)) this.trackProducer(p);
    this.unsub = this.sfu.onBrowserProducers(this.room, {
      added: (p) => this.trackProducer(p),
      removed: (id) => this.untrackProducer(id),
    });
    for (const peerId of this.peerProducers.keys()) this.scheduleUplink(peerId);
  }

  // ---------- browser -> MCU ----------
  private trackProducer(p: BrowserProducer) {
    if (p.source === "screen") return; // content channel: phase 3 (needs BFCP/H.239-capable MCU)
    const e = this.peerProducers.get(p.peerId) ?? { name: p.displayName };
    e[p.kind] = p.producerId;
    this.peerProducers.set(p.peerId, e);
    this.scheduleUplink(p.peerId);
  }

  private untrackProducer(producerId: string) {
    for (const [peerId, e] of this.peerProducers) {
      let hit = false;
      if (e.audio === producerId) { delete e.audio; hit = true; }
      if (e.video === producerId) { delete e.video; hit = true; }
      if (!hit) continue;
      if (!e.audio && !e.video) this.peerProducers.delete(peerId);
      this.scheduleUplink(peerId);
    }
  }

  /** Debounce: mic and cam usually arrive within ms of each other; rebuild the leg once. */
  private scheduleUplink(peerId: string) {
    clearTimeout(this.pending.get(peerId));
    this.pending.set(peerId, setTimeout(() => this.rebuildUplink(peerId).catch((e) => console.error(`[${this.room}] uplink ${peerId}`, e)), 300));
  }

  private async rebuildUplink(peerId: string) {
    await this.uplinks.get(peerId)?.close();
    this.uplinks.delete(peerId);
    const e = this.peerProducers.get(peerId);
    if (!e || (!e.audio && !e.video)) return;
    const router = await this.sfu.getRouter(this.room);
    const leg = new UplinkLeg(router, this.room, peerId, e.name);
    leg.onClose = () => this.uplinks.get(peerId) === leg && this.uplinks.delete(peerId);
    this.uplinks.set(peerId, leg);
    await leg.start({ audio: e.audio, video: e.video });
  }

  // ---------- MCU events ----------
  async onMemberAdd(ev: any) {
    if (ev.legId) {
      if (this.downlink && this.downlink.legId === ev.legId) this.downlink.memberId = ev.memberId;
      for (const up of this.uplinks.values()) if (up.legId === ev.legId) up.memberId = ev.memberId;
      await this.applyNoHear();
      return; // bridge legs are not shown as Poly participants
    }
    const entry: PolyParticipant = { ...ev, callId: ev.uuid, muted: false };
    this.polyMembers.set(ev.memberId, entry);
    await this.sfu.rosterUpsert(this.room, entry);
  }

  async onMemberDel(ev: any) {
    const m = this.polyMembers.get(ev.memberId);
    if (m) {
      this.polyMembers.delete(ev.memberId);
      await this.sfu.rosterRemove(this.room, m.callId);
    }
  }

  async onMemberMute(ev: any) {
    const m = this.polyMembers.get(ev.memberId);
    if (m) {
      m.muted = ev.muted;
      await this.sfu.rosterUpsert(this.room, m);
    }
  }

  /** Browsers already hear each other through the SFU; strip them from the composite we send back. */
  private async applyNoHear() {
    const down = this.downlink?.memberId;
    if (down === undefined) return;
    for (const up of this.uplinks.values()) if (up.memberId !== undefined) await this.fs.relateNoHear(this.room, down, up.memberId);
  }

  // ---------- host controls ----------
  findMember(callIdOrMember: string) {
    const n = Number(callIdOrMember);
    return this.polyMembers.get(n) ?? [...this.polyMembers.values()].find((m) => m.callId === callIdOrMember);
  }

  // ---------- real media health ----------
  async health() {
    const sample = async () => ({
      downlink: this.downlink ? await this.downlink.mediaStats() : [],
      uplinks: Object.fromEntries(await Promise.all([...this.uplinks].map(async ([id, l]) => [id, await l.mediaStats()] as const))),
    });
    const a = await sample();
    await new Promise((r) => setTimeout(r, 2000));
    const b = await sample();
    type Sample = Awaited<ReturnType<DownlinkLeg["mediaStats"]>>;
    const deltas = (before: Sample, after: Sample, direction: "bytesSent" | "bytesReceived") =>
      after.map(item => {
        const previous = before.find(sample => sample.transportId === item.transportId);
        return { transportId: item.transportId, rtpBytes: previous ? item[direction] - previous[direction] : 0 };
      });
    const uplinkDeltas = Object.fromEntries(Object.entries(b.uplinks).map(([id, stats]) =>
      [id, deltas(a.uplinks[id] ?? [], stats, "bytesSent")]));
    const downlinkDeltas = deltas(a.downlink, b.downlink, "bytesReceived");
    const flowing = (samples: { rtpBytes: number }[]) => samples.length > 0 && samples.every(sample => sample.rtpBytes > 0);
    const uplinkOk = Object.fromEntries(Object.entries(uplinkDeltas).map(([id, samples]) => [id, flowing(samples)]));
    const downlinkOk = flowing(downlinkDeltas);
    return {
      room: this.room,
      rtpDeltas: { downlink: downlinkDeltas, uplinks: uplinkDeltas },
      ok: downlinkOk && Object.keys(uplinkOk).length > 0 && Object.values(uplinkOk).every(Boolean) && this.polyMembers.size > 0,
      polyToBrowserMediaFlowing: downlinkOk,
      browserToPolyMediaFlowing: uplinkOk,
      polyParticipants: [...this.polyMembers.values()].map((m) => ({ name: m.displayName, protocol: m.protocol, encrypted: m.encrypted, muted: m.muted })),
      mcu: await this.fs.listRoom(this.room).then((s) => { try { return JSON.parse(s); } catch { return s; } }),
    };
  }

  async stop() {
    this.unsub?.();
    this.pending.forEach(clearTimeout);
    for (const member of this.polyMembers.values()) await this.sfu.rosterRemove(this.room, member.callId);
    this.polyMembers.clear();
    for (const p of this.downlink?.producers ?? []) await this.sfu.withdrawBridgeProducer(this.room, p.id).catch(() => undefined);
    await this.downlink?.close();
    await Promise.all([...this.uplinks.values()].map((l) => l.close()));
    this.uplinks.clear();
  }
}
