import { z } from 'zod';
import { roomManager } from './room-manager.js';
import { sfuClient } from './sfu-client.js';

export const bharatVcRequest = z.object({
    conferenceId: z.string().regex(/^[0-9]{6,16}$/),
    gateway: z.enum(['sip.bharatvc.nic.in', 'bhvc.nic.in']),
    pin: z.string().regex(/^[0-9]{4,16}$/),
    consent: z.literal(true),
}).strict();
const starting = new WeakSet<object>();
const dialled = new WeakSet<object>();
type Caller = { roomId?: string; peerId?: string; authUser?: { sub: string } };
function authorised(room: NonNullable<ReturnType<typeof roomManager.getRoom>>, state: Caller, operatorTenantId?: string) {
    return operatorTenantId !== undefined
        ? room.ownerTenantId === operatorTenantId && !!room.hostPeerId && !!room.peers.get(room.hostPeerId)?.userId
        : !!state.authUser?.sub && room.hostPeerId === state.peerId;
}
/** Only explicit SIP invitation details are accepted; a web password is not a SIP PIN. */
export async function bharatVcDial(state: Caller, input: unknown, operatorTenantId?: string) {
    const room = state.roomId ? roomManager.getRoom(state.roomId) : undefined;
    if (process.env.POLY_BRIDGE_ENABLED !== 'true' || !room || !authorised(room, state, operatorTenantId) || room.settings.locked || room.settings.webinar || room.settings.e2eeRequired) {
        throw new Error('Only the signed-in host of an unlocked, non-E2EE conference with an enabled media bridge can connect Bharat VC.');
    }
    const parsed = bharatVcRequest.safeParse(input);
    if (!parsed.success) throw new Error('Use the conference ID, SIP gateway and SIP PIN from your authorised Bharat VC invitation, and acknowledge external media sharing.');
    if (starting.has(room) || dialled.has(room)) throw new Error('A Bharat VC connection has already been requested for this meeting.');
    starting.add(room);
    let dialAttempted = false;
    try {
        await sfuClient.startPolyRoom(room.id);
        // Recheck after starting the external media bridge; authority can change during the await.
        if (roomManager.getRoom(room.id) !== room || !authorised(room, state, operatorTenantId) || room.settings.locked || room.settings.webinar || room.settings.e2eeRequired) throw new Error('Meeting permissions changed.');
        room.externalConference = { provider: 'Bharat VC', status: 'connecting' };
        roomManager.broadcast(room.id, 'externalConferenceState', room.externalConference);
        dialAttempted = true;
        const response = await sfuClient.connectBharatVc(room.id, parsed.data);
        if (roomManager.getRoom(room.id) !== room || !authorised(room, state, operatorTenantId) || room.settings.locked || room.settings.webinar || room.settings.e2eeRequired) {
            await sfuClient.disconnectBharatVc(room.id);
            dialAttempted = false;
            throw new Error('Meeting permissions changed.');
        }
        dialled.add(room);
        room.externalConference = { provider: 'Bharat VC', status: 'connected' };
        roomManager.broadcast(room.id, 'externalConferenceState', room.externalConference);
        return { requested: true, callId: response.callId, provider: 'Bharat VC' };
    } catch { room.externalConference = dialAttempted ? { provider: 'Bharat VC', status: 'unknown' } : null; if (dialAttempted) dialled.add(room); roomManager.broadcast(room.id, 'externalConferenceState', room.externalConference); throw new Error('The Bharat VC connection could not be confirmed. Ask your administrator to check the invitation and SIP media bridge before retrying.'); }
    finally { starting.delete(room); }
}

export async function disconnectBharatVc(state: Caller, operatorTenantId?: string) {
    const room = state.roomId ? roomManager.getRoom(state.roomId) : undefined;
    if (!room || !authorised(room, state, operatorTenantId)) throw new Error('Only the signed-in host can disconnect the external conference.');
    if (starting.has(room)) throw new Error('Wait for the dial request to finish before disconnecting.');
    await sfuClient.disconnectBharatVc(room.id);
    dialled.delete(room);
    room.externalConference = null;
    roomManager.broadcast(room.id, 'externalConferenceState', null);
    return { disconnected: true };
}
