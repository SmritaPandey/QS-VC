import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../meeting-policy.js', () => ({ loadMeetingPolicy: vi.fn().mockResolvedValue(null), reportMeetingStatus: vi.fn().mockResolvedValue(undefined), verifySignalingAccess: vi.fn().mockResolvedValue({ allowed: true, isGuest: false }) }));
vi.mock('../sfu-client.js', () => ({ sfuClient: { getRtpCapabilities: vi.fn().mockResolvedValue({ rtpCapabilities: {} }), createTransport: vi.fn().mockResolvedValue({ id: 'transport' }), removePeer: vi.fn().mockResolvedValue({}) } }));
import { handlePeerDisconnect, handleRpcMessage } from './handler.js';
import { roomManager } from '../room-manager.js';
const states: any[] = [];
const rpc = (ws: any, state: any, method: string, params: any = {}) => handleRpcMessage(ws, { jsonrpc: '2.0', id: 1, method, params }, state);
async function joined(required = true) {
    const ws = { readyState: 1, send: vi.fn(), close: vi.fn() }, state: any = { authUser: { sub: 'owner', tenantId: 'tenant' } };
    const result = await rpc(ws, state, 'joinRoom', { meetingCode: `data-${crypto.randomUUID().slice(0,10)}`, displayName: 'Owner', supportsE2EE: true });
    expect(result?.result.peerId).toBeDefined(); states.push(state);
    const room = roomManager.getRoom(state.roomId)!; room.settings.e2eeRequired = required;
    return { ws, state, room };
}
const envelope = (room: any, state: any) => ({ version: 1, room: room.id, keyId: 1, epoch: Buffer.alloc(32,1).toString('base64'), senderPeerId: state.peerId, messageId: crypto.randomUUID(), type: 'chat', createdAt: Date.now(), nonce: Buffer.alloc(12,2).toString('base64'), ciphertext: Buffer.alloc(32,3).toString('base64'), signature: Buffer.alloc(4627,4).toString('base64') });
afterEach(async () => { for (const state of states.splice(0)) await handlePeerDisconnect(state); });
describe('ciphertext-only encrypted meeting data protocol', () => {
    it('blocks legacy plaintext and every plaintext collaboration read or action in encrypted rooms', async () => {
        const {ws,state}=await joined();
        expect((await rpc(ws,state,'chatMessage',{content:'secret',type:'text'}))?.error?.code).toBe(-32602);
        for(const method of ['getCollaborationState','getCollaborationFile','collaborationAction']) expect((await rpc(ws,state,method,{type:'notes:set',text:'secret'}))?.error?.code).toBe(-32005);
        expect(ws.send.mock.calls.map(([raw])=>raw).join('')).not.toContain('secret');
    });
    it('requires registered sender identity and relays ciphertext without content', async () => {
        const {ws,state,room}=await joined(); const encrypted=envelope(room,state);
        expect((await rpc(ws,state,'chatMessage',{encrypted}))?.error?.code).toBe(-32005);
        room.peers.get(state.peerId)!.e2eeKeyBundle={peerId:state.peerId,kemPublicKey:'kem',signingPublicKey:'sign',signature:'sig'};
        expect((await rpc(ws,state,'chatMessage',{encrypted}))?.result.sent).toBe(true);
        const sent=ws.send.mock.calls.map(([raw])=>JSON.parse(raw)).find(value=>value.method==='chatMessage');
        expect(sent.params.encrypted).toEqual(encrypted); expect(sent.params).not.toHaveProperty('content'); expect(sent.params.type).toBe('encrypted');
    });
    it('rejects spoofed senders, wrong rooms, mixed plaintext, expired and oversized envelopes', async () => {
        const {ws,state,room}=await joined();
        room.peers.get(state.peerId)!.e2eeKeyBundle={peerId:state.peerId,kemPublicKey:'kem',signingPublicKey:'sign',signature:'sig'};
        const encrypted=envelope(room,state);
        for(const params of [
            {encrypted:{...encrypted,senderPeerId:crypto.randomUUID()}}, {encrypted:{...encrypted,room:crypto.randomUUID()}},
            {encrypted,content:'secret'}, {encrypted:{...encrypted,createdAt:Date.now()-180000}},
            {encrypted:{...encrypted,ciphertext:'A'.repeat(22004)}}, {encrypted:{...encrypted,nonce:'bad'}},
        ]) expect((await rpc(ws,state,'chatMessage',params))?.error?.code).toBe(-32602);
        expect(ws.send.mock.calls.map(([raw])=>JSON.parse(raw)).filter(value=>value.method==='chatMessage')).toHaveLength(0);
    });
    it('preserves explicitly unencrypted chat while validating its bounds', async () => {
        const {ws,state}=await joined(false);
        expect((await rpc(ws,state,'chatMessage',{content:'hello',type:'text'}))?.result.sent).toBe(true);
        expect((await rpc(ws,state,'chatMessage',{content:'A'.repeat(4001),type:'text'}))?.error?.code).toBe(-32602);
    });
});
