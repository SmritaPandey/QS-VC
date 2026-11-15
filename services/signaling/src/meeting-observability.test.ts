import { expect, it, vi } from 'vitest';
import { MeetingObservability } from './meeting-observability.js';

const quality = { rttMs: 60, jitterMs: 5, packetLossPercent: 0, audioActive: true };
const owner = { id: 'owner-peer', displayName: 'Owner', userId: 'owner' };
const room = { id: 'main', meetingCode: 'REPORT', ownerUserId: 'owner', createdAt: new Date(0) };

it('accumulates repeated room visits without counting absence or sound activity across visits', async () => {
    let at = 0;
    const persist = vi.fn(async () => true);
    const observed = new MeetingObservability(persist, () => at);
    observed.joined(room, owner);
    observed.sample(room.id, owner.id, quality);
    at = 3000;
    observed.sample(room.id, owner.id, quality);
    at = 4000;
    observed.left(room.id, owner.id);
    expect(() => observed.sample(room.id, owner.id, quality)).toThrow('Not joined');
    at = 14000;
    observed.joined(room, owner);
    const resumed = observed.report(room.id, owner.id, owner.userId).participants[0];
    expect(resumed).toMatchObject({ durationMs: 4000, leftAt: null, estimatedSpeakingMs: 3000, lastSampleAt: null, latest: null, version: 5 });
    expect(persist).toHaveBeenLastCalledWith('REPORT', expect.objectContaining({ participant: expect.objectContaining({ version: 5, leftAt: null, durationMs: 4000 }) }));
    observed.sample(room.id, owner.id, quality);
    at = 17000;
    observed.sample(room.id, owner.id, quality);
    expect(observed.report(room.id, owner.id, owner.userId).participants[0]).toMatchObject({ durationMs: 7000, estimatedSpeakingMs: 6000 });
    at = 18000;
    observed.left(room.id, owner.id);
    observed.left(room.id, owner.id);
    at = 30000;
    observed.joined(room, owner);
    at = 32000;
    observed.joined(room, owner); // An already-active join cannot reset attendance.
    expect(observed.report(room.id, owner.id, owner.userId).participants[0]).toMatchObject({ durationMs: 10000 });
    at = 33000;
    observed.ended(room.id);
    await observed.flush();
    expect(persist).toHaveBeenLastCalledWith('REPORT', expect.objectContaining({ participant: expect.objectContaining({ durationMs: 11000, estimatedSpeakingMs: 6000, leftAt: new Date(at).toISOString() }) }));
});

it('limits samples even at epoch zero and resets the sample clock on a short visit away', () => {
    let at = 0;
    const observed = new MeetingObservability(async () => true, () => at);
    observed.joined(room, owner);
    observed.sample(room.id, owner.id, quality);
    at = 1;
    expect(() => observed.sample(room.id, owner.id, quality)).toThrow('one every 3 seconds');
    observed.left(room.id, owner.id);
    at = 2;
    observed.joined(room, owner);
    expect(observed.sample(room.id, owner.id, quality)).toMatchObject({ accepted: true });
    expect(observed.report(room.id, owner.id, owner.userId).participants[0]).toMatchObject({ estimatedSpeakingMs: 0, durationMs: 1 });
});

it('requires the bound signed-in owner or administrator and reports failed persistence', async () => {
    const observed = new MeetingObservability(async () => false, () => 1000);
    observed.joined(room, owner);
    const member = { id: 'member', displayName: 'Member', userId: 'member-user' };
    observed.joined(room, member);
    for (const [peerId, sub] of [[owner.id, undefined], [owner.id, 'impostor'], [member.id, member.userId]]) {
        expect(() => observed.report(room.id, peerId!, sub)).toThrow('Only the signed-in');
    }
    observed.joined(room, { id: 'admin', displayName: 'Admin', userId: 'admin-user', platformAdmin: true });
    expect(observed.report(room.id, 'admin', 'admin-user').participants).toHaveLength(3);
    await observed.flush();
    expect(observed.report(room.id, owner.id, owner.userId).persistence).toBe('some-records-unsaved');
});
