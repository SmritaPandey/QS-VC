import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('./sfu-client.js', () => ({ sfuClient: { startPolyRoom: vi.fn(), connectBharatVc: vi.fn(), disconnectBharatVc: vi.fn() } }));
vi.mock('./room-manager.js', () => ({ roomManager: { getRoom: vi.fn(), broadcast: vi.fn() } }));
import { sfuClient } from './sfu-client.js';
import { roomManager } from './room-manager.js';
import { bharatVcDial, bharatVcRequest, disconnectBharatVc } from './bharat-vc.js';
const invitation = { conferenceId: '1234567890', gateway: 'sip.bharatvc.nic.in', pin: '123456', consent: true };
const state = { roomId: 'room', peerId: 'host', authUser: { sub: 'owner' } };
let room: any;
beforeEach(() => {
    vi.clearAllMocks(); vi.stubEnv('POLY_BRIDGE_ENABLED', 'true');
    room = { id: 'room', hostPeerId: 'host', settings: { locked: false, webinar: false, e2eeRequired: false } };
    vi.mocked(roomManager.getRoom).mockReturnValue(room);
    vi.mocked(sfuClient.startPolyRoom).mockResolvedValue({});
    vi.mocked(sfuClient.connectBharatVc).mockResolvedValue({ callId: 'call' });
});
it('validates invitation fields without allowing arbitrary dial targets or command injection', () => {
    expect(bharatVcRequest.safeParse(invitation).success).toBe(true);
    for (const input of [{ ...invitation, gateway: 'attacker.test' }, { ...invitation, pin: '12,execute=bad' }, { ...invitation, consent: false }, { ...invitation, conferenceId: '../room' }, { ...invitation, target: 'extra' }]) expect(bharatVcRequest.safeParse(input).success).toBe(false);
});
it('requires the authenticated current host, bridge capability and non-E2EE unlocked room', async () => {
    await expect(bharatVcDial({ ...state, peerId: 'member' }, invitation)).rejects.toThrow('Only the signed-in host');
    await expect(bharatVcDial({ ...state, authUser: undefined }, invitation)).rejects.toThrow('Only the signed-in host');
    for (const flag of ['locked', 'webinar', 'e2eeRequired']) {
        room.settings[flag] = true;
        await expect(bharatVcDial(state, invitation)).rejects.toThrow('Only the signed-in host');
        room.settings[flag] = false;
    }
    expect(sfuClient.startPolyRoom).not.toHaveBeenCalled();
});
it('announces external media before dialing, returns no PIN and blocks duplicate connections', async () => {
    const result = await bharatVcDial(state, invitation);
    expect(result).toEqual({ requested: true, callId: 'call', provider: 'Bharat VC' });
    expect(roomManager.broadcast).toHaveBeenNthCalledWith(1, 'room', 'externalConferenceState', { provider: 'Bharat VC', status: 'connecting' });
    expect(room.externalConference.status).toBe('connected');
    await expect(bharatVcDial(state, invitation)).rejects.toThrow('already been requested');
    expect(sfuClient.connectBharatVc).toHaveBeenCalledOnce();
});
it('rechecks authority after bridge startup and fails without leaking downstream errors', async () => {
    vi.mocked(sfuClient.startPolyRoom).mockImplementationOnce(async () => { room.hostPeerId = 'new-host'; return {}; });
    await expect(bharatVcDial(state, invitation)).rejects.toThrow('could not be confirmed');
    expect(sfuClient.connectBharatVc).not.toHaveBeenCalled();
    room.hostPeerId = 'host';
    vi.mocked(sfuClient.connectBharatVc).mockRejectedValueOnce(new Error('provider secret'));
    await expect(bharatVcDial(state, invitation)).rejects.toThrow('could not be confirmed');
    expect(room.externalConference).toEqual({ provider: 'Bharat VC', status: 'unknown' });
});

it('cancels a successful dial if authority changed during the call and permits host disconnection', async () => {
    vi.mocked(sfuClient.disconnectBharatVc).mockResolvedValue({ disconnected: true });
    vi.mocked(sfuClient.connectBharatVc).mockImplementationOnce(async () => { room.settings.webinar = true; return { callId: 'call' }; });
    await expect(bharatVcDial(state, invitation)).rejects.toThrow('could not be confirmed');
    expect(sfuClient.disconnectBharatVc).toHaveBeenCalledWith('room');
    expect(room.externalConference).toBeNull();
    await expect(disconnectBharatVc({ ...state, peerId: 'member' })).rejects.toThrow('Only the signed-in host');
    expect(await disconnectBharatVc(state)).toEqual({ disconnected: true });
});
