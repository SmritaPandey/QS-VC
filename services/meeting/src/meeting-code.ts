import { randomInt } from 'node:crypto';

const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateMeetingCode(): string {
    const segment = () => Array.from({ length: 4 }, () => CHARS[randomInt(CHARS.length)]).join('');
    return `QS-${segment()}-${segment()}-${segment()}`;
}

export function isMeetingCodeConflict(error: unknown): boolean {
    const pgError = error as { code?: string; constraint?: string };
    return pgError?.code === '23505' && pgError.constraint === 'meetings_meeting_code_key';
}

/** The unique database constraint is authoritative; retry only a code collision. */
export async function insertWithUniqueMeetingCodes<T>(
    count: number,
    insert: (codes: string[]) => Promise<T>,
    makeCode: () => string = generateMeetingCode,
): Promise<{ codes: string[]; result: T }> {
    for (let attempt = 0; attempt < 5; attempt++) {
        const codes = Array.from({ length: count }, makeCode);
        if (new Set(codes).size !== codes.length) continue;
        try { return { codes, result: await insert(codes) }; }
        catch (error) { if (!isMeetingCodeConflict(error)) throw error; }
    }
    const error = new Error('Could not reserve unique meeting codes after five attempts');
    error.name = 'MeetingCodeCollisionError';
    throw error;
}
