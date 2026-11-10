import { afterEach, expect, it, vi } from 'vitest';
import { loadMeetingPolicy, reportMeetingStatus, endHostedMeetingStatus } from './meeting-policy';
afterEach(() => vi.unstubAllGlobals());
it('loads saved owner and validated restrictions', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok:true, json:async()=>({ hostId:'owner', status:'waiting', settings:{waitingRoomEnabled:true,password:'private'} }) }));
    expect((await loadMeetingPolicy('QS-TEST'))?.hostId).toBe('owner');
});
it('never falls back to guest ownership on service failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok:false,status:503 }));
    await expect(loadMeetingPolicy('QS-TEST')).rejects.toThrow('could not be verified');
});
it('allows missing records as instant guest rooms, lets hosts restart ended meetings, rejects cancelled ones', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok:false,status:404 }));
    expect(await loadMeetingPolicy('QS-TEST')).toBeNull();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok:true,json:async()=>({hostId:'owner',status:'ended',settings:{}}) }));
    expect((await loadMeetingPolicy('QS-TEST'))?.hostId).toBe('owner');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok:true,json:async()=>({hostId:'owner',status:'cancelled',settings:{}}) }));
    await expect(loadMeetingPolicy('QS-TEST')).rejects.toThrow('cancelled');
});
it('maps the stored meeting-service setting names to live controls', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ok:true,json:async()=>({hostId:'owner',status:'waiting',settings:{waitingRoom:true,chatEnabled:false,screenShareEnabled:false}})}));
    expect((await loadMeetingPolicy('QS-TEST'))?.settings).toMatchObject({waitingRoomEnabled:true,allowChat:false,allowScreenShare:false,allowRecording:true});
});
it('preserves the selected meeting kind while requiring the waiting room for every meeting', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ok:true,json:async()=>({hostId:'owner',status:'waiting',settings:{meetingKind:'town_hall',webinar:true,waitingRoomEnabled:false}})}));
    expect((await loadMeetingPolicy('QS-TEST'))?.settings).toMatchObject({meetingKind:'town_hall',webinar:true,waitingRoomEnabled:true});
});
it('preserves explicit recording restrictions in either stored setting form', async () => {
    for (const settings of [{ allowRecording: false }, { recording_allowed: false }]) {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ok:true,json:async()=>({hostId:'owner',status:'waiting',settings})}));
        expect((await loadMeetingPolicy('QS-TEST'))?.settings.allowRecording).toBe(false);
    }
});

it.each([
    () => Promise.resolve(Response.json({ updated: false })),
    () => Promise.resolve(Response.json({ updated: true }, { status: 503 })),
    () => Promise.reject(new Error('network failed')),
])('requires confirmed persistence for dashboard ending, while keeping in-call reporting best effort', async reply => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(reply));
    await expect(endHostedMeetingStatus('ABC-123', 'host', 'tenant')).rejects.toThrow();
    await expect(reportMeetingStatus('ABC-123', 'ended')).resolves.toBeUndefined();
});
it('accepts a confirmed end update', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ updated: true })));
    await expect(endHostedMeetingStatus('ABC-123', 'host', 'tenant')).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/ABC-123/end'), expect.objectContaining({ method: 'POST', body: JSON.stringify({ hostId: 'host', tenantId: 'tenant', action: 'end' }) }));
});

it('only allows cancelled policy reads for an explicitly requested dashboard cancellation retry', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => Response.json({ hostId: 'host', status: 'cancelled', settings: {} })));
    await expect(loadMeetingPolicy('ABC-123')).rejects.toThrow('cancelled');
    expect(await loadMeetingPolicy('ABC-123', true)).toMatchObject({ hostId: 'host', status: 'cancelled' });
});
it('sends an explicit cancellation action through the confirmed dashboard control endpoint', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ updated: true })));
    await endHostedMeetingStatus('ABC-123', 'host', 'tenant', 'cancel');
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/ABC-123/end'), expect.objectContaining({ body: JSON.stringify({ hostId: 'host', tenantId: 'tenant', action: 'cancel' }) }));
});
