import { describe, expect, it } from 'vitest';
import { authenticatedMeetingRequest, meetingsEndpoint } from './meeting-creation';

describe('signed-in meeting creation contract', () => {
    it('normalizes both service-root and meeting-endpoint API bases', () => {
        expect(meetingsEndpoint('https://qs-vc.example')).toBe('https://qs-vc.example/api/meetings');
        expect(meetingsEndpoint('https://qs-vc.example/api/meetings/')).toBe('https://qs-vc.example/api/meetings');
        expect(meetingsEndpoint('')).toBe('/api/meetings');
    });

    it('sends an authenticated owner-bound meeting kind with the waiting room required', () => {
        const request = authenticatedMeetingRequest('session-token', {
            title: 'Planning session', meetingKind: 'town_hall', startNow: true,
        });
        expect(request.method).toBe('POST');
        expect(request.headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer session-token' });
        expect(JSON.parse(String(request.body))).toEqual({
            title: 'Planning session',
            type: 'instant',
            settings: { meetingKind: 'town_hall', webinar: true, waitingRoom: true },
        });
    });
});
