import { roomManager } from './room-manager.js';

export interface DialedNumberResult {
    roomId: string;
    meetingCode: string;
    autoAdmit: boolean;
    pinRequired: boolean;
    pinHash: string | null;
    encryption: string;
    displayName: string;
}

export interface RegisteredDeviceResult {
    id: string;
    name: string;
    model: string;
    protocol: string;
    allowedCidr: string | null;
    defaultRoomNumber: string | null;
    enabled: boolean;
}

export interface Queryable {
    query: (sql: string, params?: any[]) => Promise<{ rows: any[] }>;
}

const NUMBER_FORMAT = /^[0-9]{3,10}$/;

/**
 * Resolves a dialed room number (3-10 digits) to a persistent meeting room.
 * Ensures the persistent room exists in roomManager.
 */
export async function resolveDialedNumber(
    dialedNumber: string,
    db: Queryable
): Promise<DialedNumberResult | null> {
    if (!dialedNumber || typeof dialedNumber !== 'string' || !NUMBER_FORMAT.test(dialedNumber.trim())) {
        return null;
    }

    const cleanNumber = dialedNumber.trim();
    const { rows } = await db.query(
        `SELECT number, tenant_id, meeting_code, display_name, pin_hash,
                auto_admit, max_participants, encryption, created_by
         FROM room_numbers
         WHERE number = $1`,
        [cleanNumber]
    );

    if (!rows || rows.length === 0) {
        return null;
    }

    const row = rows[0];
    const room = roomManager.getOrCreatePersistentRoom(row.meeting_code, {
        ownerUserId: row.created_by,
        autoAdmit: row.auto_admit,
        maxParticipants: row.max_participants,
        encryption: row.encryption,
        displayName: row.display_name,
    });

    return {
        roomId: room.id,
        meetingCode: row.meeting_code,
        autoAdmit: Boolean(row.auto_admit),
        pinRequired: Boolean(row.pin_hash),
        pinHash: row.pin_hash || null,
        encryption: row.encryption || 'optional',
        displayName: row.display_name,
    };
}

/**
 * Looks up a registered room device (e.g. Polycom endpoint) by its assigned extension.
 */
export async function getRegisteredDevice(
    extension: string,
    db: Queryable
): Promise<RegisteredDeviceResult | null> {
    if (!extension || typeof extension !== 'string' || !NUMBER_FORMAT.test(extension.trim())) {
        return null;
    }

    const cleanExt = extension.trim();
    const { rows } = await db.query(
        `SELECT id, name, model, protocol, allowed_cidr, default_room_number, enabled
         FROM room_devices
         WHERE extension = $1 AND enabled = true`,
        [cleanExt]
    );

    if (!rows || rows.length === 0) {
        return null;
    }

    const row = rows[0];
    return {
        id: row.id,
        name: row.name,
        model: row.model,
        protocol: row.protocol,
        allowedCidr: row.allowed_cidr,
        defaultRoomNumber: row.default_room_number,
        enabled: Boolean(row.enabled),
    };
}
