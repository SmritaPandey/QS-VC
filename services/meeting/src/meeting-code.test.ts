import { describe, expect, it } from 'vitest';
import { generateMeetingCode, insertWithUniqueMeetingCodes } from './meeting-code.js';

describe('meeting code generation', () => {
    it('uses the QS code format and a cryptographic random source', () => {
        expect(generateMeetingCode()).toMatch(/^QS-[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){2}$/);
    });

    it('retries database collisions and prevents duplicates within a scheduled batch', async () => {
        const generated = ['QS-AAAA-AAAA-AAAA', 'QS-AAAA-AAAA-AAAA', 'QS-BBBB-BBBB-BBBB', 'QS-CCCC-CCCC-CCCC', 'QS-DDDD-DDDD-DDDD', 'QS-EEEE-EEEE-EEEE'];
        let databaseAttempts = 0;
        const insert = async (codes: string[]) => {
            if (databaseAttempts++ === 0) throw Object.assign(new Error('duplicate'), { code: '23505', constraint: 'meetings_meeting_code_key' });
            return codes.length;
        };
        const { codes, result } = await insertWithUniqueMeetingCodes(2, insert, () => generated.shift()!);
        expect(codes).toEqual(['QS-DDDD-DDDD-DDDD', 'QS-EEEE-EEEE-EEEE']);
        expect(result).toBe(2);
    });
});
