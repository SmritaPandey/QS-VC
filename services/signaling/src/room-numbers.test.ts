import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveDialedNumber, getRegisteredDevice } from './room-numbers.js';
import { roomManager } from './room-manager.js';

/** Minimal mock of pg.Pool for testing. */
function mockPool(rows: any[] = []) {
    return {
        query: vi.fn().mockResolvedValue({ rows }),
    } as any;
}

describe('resolveDialedNumber', () => {
    it('returns null for unknown numbers', async () => {
        const db = mockPool([]);
        const result = await resolveDialedNumber('9999', db);
        expect(result).toBeNull();
        expect(db.query).toHaveBeenCalledWith(
            expect.stringContaining('room_numbers'),
            ['9999'],
        );
    });

    it('resolves a known number and creates a persistent room', async () => {
        const db = mockPool([{
            number: '1001',
            meeting_code: 'conf-room-alpha',
            display_name: 'Alpha Room',
            pin_hash: null,
            auto_admit: true,
            max_participants: 50,
            encryption: 'optional',
            created_by: 'user-owner-1',
        }]);

        const result = await resolveDialedNumber('1001', db);

        expect(result).not.toBeNull();
        expect(result!.meetingCode).toBe('conf-room-alpha');
        expect(result!.autoAdmit).toBe(true);
        expect(result!.pinRequired).toBe(false);
        expect(result!.encryption).toBe('optional');
        expect(result!.displayName).toBe('Alpha Room');
        expect(result!.roomId).toBeTruthy();
    });

    it('returns pinRequired true when pin_hash is set', async () => {
        const db = mockPool([{
            number: '2002',
            meeting_code: 'conf-room-beta',
            display_name: 'Beta Room',
            pin_hash: '$2b$10$abcdef',
            auto_admit: false,
            max_participants: 25,
            encryption: 'required',
            created_by: null,
        }]);

        const result = await resolveDialedNumber('2002', db);

        expect(result).not.toBeNull();
        expect(result!.pinRequired).toBe(true);
        expect(result!.autoAdmit).toBe(false);
        expect(result!.encryption).toBe('required');
    });
});

describe('getOrCreatePersistentRoom', () => {
    it('creates a room with autoAdmit settings', () => {
        const room = roomManager.getOrCreatePersistentRoom('persistent-test-1', {
            ownerUserId: 'owner-1',
            autoAdmit: true,
            maxParticipants: 50,
            encryption: 'optional',
            displayName: 'Test Room 1',
        });

        expect(room.meetingCode).toBe('persistent-test-1');
        expect(room.hostStarted).toBe(true);
        expect(room.ownerUserId).toBe('owner-1');
        expect(room.settings.waitingRoomEnabled).toBe(false);
        expect(room.settings.maxParticipants).toBe(50);
    });

    it('returns existing room on second call', () => {
        const room1 = roomManager.getOrCreatePersistentRoom('persistent-test-2', {
            ownerUserId: 'owner-2',
            autoAdmit: true,
        });
        const room2 = roomManager.getOrCreatePersistentRoom('persistent-test-2', {
            ownerUserId: 'owner-2',
            autoAdmit: true,
        });

        expect(room1.id).toBe(room2.id);
        expect(room1).toBe(room2);
    });

    it('persistent room with autoAdmit has waitingRoomEnabled=false', () => {
        const room = roomManager.getOrCreatePersistentRoom('persistent-auto-admit', {
            autoAdmit: true,
        });
        expect(room.settings.waitingRoomEnabled).toBe(false);
        expect(room.hostStarted).toBe(true);
    });

    it('persistent room without autoAdmit has waitingRoomEnabled=true', () => {
        const room = roomManager.getOrCreatePersistentRoom('persistent-no-auto-admit', {
            autoAdmit: false,
        });
        expect(room.settings.waitingRoomEnabled).toBe(true);
        expect(room.hostStarted).toBe(true);
    });
});

describe('getRegisteredDevice', () => {
    it('returns null for unknown extension', async () => {
        const db = mockPool([]);
        const result = await getRegisteredDevice('9999', db);
        expect(result).toBeNull();
    });

    it('returns device info for a known extension', async () => {
        const db = mockPool([{
            id: 'device-uuid-1',
            name: 'Polycom Trio 8800',
            model: 'Polycom',
            protocol: 'sip',
            allowed_cidr: '10.0.0.0/8',
            default_room_number: '1001',
            enabled: true,
        }]);

        const result = await getRegisteredDevice('5001', db);

        expect(result).not.toBeNull();
        expect(result!.id).toBe('device-uuid-1');
        expect(result!.name).toBe('Polycom Trio 8800');
        expect(result!.model).toBe('Polycom');
        expect(result!.protocol).toBe('sip');
        expect(result!.allowedCidr).toBe('10.0.0.0/8');
        expect(result!.defaultRoomNumber).toBe('1001');
        expect(result!.enabled).toBe(true);
    });
});
