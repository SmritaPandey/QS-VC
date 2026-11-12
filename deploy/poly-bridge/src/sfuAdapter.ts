import type { types as ms } from "mediasoup";

/**
 * The ONLY contract between the bridge and the existing QSVC SFU.
 * Implement this inside QSVC (next to services/mcu/src/index.ts) using the
 * room/router objects the SFU already has. The bridge never touches QSVC
 * internals directly, so the SFU stays as-is.
 */
export interface SfuAdapter {
  /** mediasoup Router that hosts the QSVC meeting. */
  getRouter(roomId: string): Promise<ms.Router>;

  /** Producers currently published by browser participants (not by the bridge). */
  listBrowserProducers(roomId: string): Promise<BrowserProducer[]>;

  /** Subscribe to browser producer add/remove so legs can follow. Returns unsubscribe. */
  onBrowserProducers(
    roomId: string,
    handlers: {
      added: (p: BrowserProducer) => void;
      removed: (producerId: string) => void;
    }
  ): () => void;

  /**
   * Announce bridge-originated producers (the MCU composite) to browsers,
   * exactly as if a peer called "Poly room" published them.
   */
  announceBridgeProducer(roomId: string, peer: { id: string; displayName: string }, producer: ms.Producer): Promise<void>;
  withdrawBridgeProducer(roomId: string, producerId: string): Promise<void>;

  /** Lobby: ask QSVC host UI to admit/deny a waiting Poly endpoint. */
  notifyLobby(roomId: string, waiting: LobbyEntry): Promise<void>;
  notifyLobbyLeft(roomId: string, callId: string): Promise<void>;

  /** Roster: show/hide Poly endpoints as participants in QSVC. */
  rosterUpsert(roomId: string, entry: PolyParticipant): Promise<void>;
  rosterRemove(roomId: string, callId: string): Promise<void>;

  /**
   * Resolve a dialed room number to meeting details via the signaling service.
   * Returns null when the number is not assigned to any room.
   */
  resolveDialedNumber(number: string, pin?: string): Promise<DialedNumberResult | null>;

  /**
   * Ensure a bridge is running for the given room (idempotent).
   * Starts SFU-side resources so the bridge can attach.
   */
  ensureBridge(roomId: string): Promise<void>;
}

export interface BrowserProducer {
  producerId: string;
  peerId: string;
  displayName: string;
  kind: "audio" | "video";
  /** "cam" | "mic" | "screen" — screen goes to the content channel. */
  source: "mic" | "cam" | "screen";
}

export interface LobbyEntry {
  callId: string; // FreeSWITCH channel uuid
  displayName: string;
  protocol: "sip" | "h323";
  remoteAddress: string;
  encrypted: boolean;
}

export interface PolyParticipant extends LobbyEntry {
  memberId: number; // FreeSWITCH conference member id
  muted: boolean;
}

export interface DialedNumberResult {
  roomId: string;
  meetingCode: string;
  autoAdmit: boolean;
  pinRequired: boolean;
  pinVerified: boolean;
  encryption: string;
}
