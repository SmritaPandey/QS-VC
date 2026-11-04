// eslint-disable-next-line @typescript-eslint/no-var-requires
const esl = require("modesl");
import { EventEmitter } from "events";
import { config } from "./config";

/**
 * Thin FreeSWITCH Event Socket client: API commands + conference/lobby events.
 * Emits:
 *   "lobby"        { uuid, room, displayName, protocol, remoteAddress, encrypted }
 *   "lobby-left"   { uuid, room }
 *   "member-add"   { room, memberId, uuid, displayName, protocol, ... }
 *   "member-del"   { room, memberId, uuid }
 */
export class FreeSwitch extends EventEmitter {
  private conn: any;
  private ready: Promise<void>;

  constructor() {
    super();
    this.ready = this.connect();
  }

  private connect(): Promise<void> {
    const { eslHost, eslPort, eslPassword } = config.freeswitch;
    return new Promise((resolve, reject) => {
      const conn = new esl.Connection(eslHost, eslPort, eslPassword, () => {
        this.conn = conn;
        conn.events("json", "CHANNEL_PARK CHANNEL_HANGUP_COMPLETE CUSTOM conference::maintenance");
        conn.on("esl::event::**", (e: any) => this.onEvent(e));
        resolve();
      });
      conn.on("error", (err: Error) => reject(err));
      conn.on("esl::end", () => {
        console.error("[esl] connection lost, reconnecting in 2s");
        setTimeout(() => (this.ready = this.connect()), 2000);
      });
    });
  }

  async api(cmd: string): Promise<string> {
    await this.ready;
    return new Promise((resolve) => this.conn.api(cmd, (res: any) => resolve(res.getBody() as string)));
  }

  private onEvent(e: any) {
    const h = (k: string) => e.getHeader(k);
    const name = h("Event-Name");
    const room = h("variable_qsvc_room") ?? h("Conference-Name");
    if (name === "CHANNEL_PARK" && h("variable_qsvc_lobby") === "true") {
      this.emit("lobby", {
        uuid: h("Unique-ID"),
        room: h("variable_qsvc_room"),
        displayName: h("Caller-Caller-ID-Name") || h("Caller-Caller-ID-Number"),
        protocol: (h("Channel-Name") || "").startsWith("h323") ? "h323" : "sip",
        remoteAddress: h("Caller-Network-Addr") ?? "",
        encrypted: h("variable_rtp_secure_media_confirmed_audio") === "true" || h("variable_h235_enabled") === "true",
      });
    } else if (name === "CHANNEL_HANGUP_COMPLETE" && h("variable_qsvc_lobby") === "true") {
      this.emit("lobby-left", { uuid: h("Unique-ID"), room: h("variable_qsvc_room") });
    } else if (name === "CUSTOM" && h("Event-Subclass") === "conference::maintenance") {
      const action = h("Action");
      const base = { room, memberId: Number(h("Member-ID")), uuid: h("Unique-ID"), isBridgeLeg: h("variable_qsvc_bridge_leg") === "true", legId: h("variable_sip_h_X-Qsvc-Leg-Id") };
      if (action === "add-member") {
        this.emit("member-add", {
          ...base,
          displayName: h("Caller-Caller-ID-Name") || h("Caller-Caller-ID-Number"),
          protocol: (h("Channel-Name") || "").startsWith("h323") ? "h323" : "sip",
          remoteAddress: h("Caller-Network-Addr") ?? "",
          encrypted: h("variable_rtp_secure_media_confirmed_audio") === "true",
        });
      } else if (action === "del-member") {
        this.emit("member-del", base);
      } else if (action === "mute-member" || action === "unmute-member") {
        this.emit("member-mute", { ...base, muted: action === "mute-member" });
      }
    }
  }

  // ---- host controls (all act on media, not just status) ----
  admit(uuid: string, room: string) {
    return this.api(`uuid_transfer ${uuid} qsvc-join-${room} XML qsvc-rooms`);
  }
  deny(uuid: string) {
    return this.api(`uuid_kill ${uuid} CALL_REJECTED`);
  }
  kick(room: string, memberId: number) {
    return this.api(`conference ${room} hup ${memberId}`);
  }
  mute(room: string, memberId: number, on: boolean) {
    return this.api(`conference ${room} ${on ? "mute" : "unmute"} ${memberId}`);
  }
  /** Bridge downlink must not hear browser uplinks (they already hear each other via SFU). */
  relateNoHear(room: string, listenerMember: number, otherMember: number) {
    return this.api(`conference ${room} relate ${listenerMember} ${otherMember} nohear`);
  }
  memberIdForUuid(room: string, uuid: string): Promise<number | undefined> {
    return this.api(`conference ${room} json_list`).then((body) => {
      try {
        const confs = JSON.parse(body);
        const m = confs?.[0]?.members?.find((x: any) => x.uuid === uuid);
        return m ? Number(m.id) : undefined;
      } catch {
        return undefined;
      }
    });
  }
  dialOut(room: string, target: string, protocol: "sip" | "h323", encryption: "required" | "optional" | "off") {
    const vars = [
      `qsvc_room=${room}`,
      encryption === "required" ? "rtp_secure_media=mandatory" : encryption === "optional" ? "rtp_secure_media=optional" : "rtp_secure_media=forbidden",
      "absolute_codec_string='G722,PCMU,PCMA,H264'",
    ].join(",");
    const dest = protocol === "h323" ? `h323/${target}` : `sofia/qsvc-poly/${target}`;
    return this.api(`originate {${vars}}${dest} qsvc-join-${room} XML qsvc-rooms`);
  }
  listRoom(room: string) {
    return this.api(`conference ${room} json_list`);
  }
}
