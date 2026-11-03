import { afterEach, expect, it, vi } from 'vitest';
import { loadMeetingPolicy } from './meeting-policy';
afterEach(() => vi.unstubAllGlobals());
it('loads saved owner and validated restrictions', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok:true, json:async()=>({ hostId:'owner', status:'waiting', settings:{waitingRoomEnabled:true,password:'private'} }) }));
    expect((await loadMeetingPolicy('QS-TEST'))?.hostId).toBe('owner');
});
it('never falls back to guest ownership on service failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok:false,status:503 }));
    await expect(loadMeetingPolicy('QS-TEST')).rejects.toThrow('could not be verified');
});
it('allows missing records as instant guest rooms but rejects ended meetings', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok:false,status:404 }));
    expect(await loadMeetingPolicy('QS-TEST')).toBeNull();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok:true,json:async()=>({hostId:'owner',status:'ended',settings:{}}) }));
    await expect(loadMeetingPolicy('QS-TEST')).rejects.toThrow('ended');
});
it('maps the stored meeting-service setting names to live controls', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ok:true,json:async()=>({hostId:'owner',status:'waiting',settings:{waitingRoom:true,chatEnabled:false,screenShareEnabled:false}})}));
    expect((await loadMeetingPolicy('QS-TEST'))?.settings).toMatchObject({waitingRoomEnabled:true,allowChat:false,allowScreenShare:false,allowRecording:false});
});
