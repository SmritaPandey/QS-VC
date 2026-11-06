import { beforeEach, describe, expect, it } from 'vitest';
import { consumeWebSocketTicket, createWebSocketTicket } from './ws-tickets.js';

describe('one-time signaling tickets', () => {
    beforeEach(() => { process.env.NODE_ENV = 'test'; });

    it('binds a short-lived ticket to its user, session and meeting, then allows one redemption', async () => {
        const payload = { token: 'session-secret', userId: 'user-123', meetingCode: 'QS-ABCD-EFGH-JKLM' };
        const ticket = await createWebSocketTicket(payload);
        expect(ticket).toMatch(/^[A-Za-z0-9_-]{43}$/);
        await expect(consumeWebSocketTicket(ticket)).resolves.toEqual(payload);
        await expect(consumeWebSocketTicket(ticket)).resolves.toBeNull();
    });

    it('rejects malformed ticket values without querying the store', async () => {
        await expect(consumeWebSocketTicket('not-a-ticket')).resolves.toBeNull();
    });
});
