import { afterEach, describe, expect, it, vi } from 'vitest';
import { shareMeetingInvite } from './meeting-sharing';

afterEach(() => vi.unstubAllGlobals());

describe('meeting invite sharing', () => {
    it('uses the native share sheet when available', async () => {
        const share = vi.fn().mockResolvedValue(undefined);
        vi.stubGlobal('navigator', { share });

        await expect(shareMeetingInvite('Planning', 'QS-123', 'https://meet.example/join')).resolves.toBe('shared');
        expect(share).toHaveBeenCalledWith({ title: 'Planning', text: 'Join my meeting with code QS-123.', url: 'https://meet.example/join' });
    });

    it('copies the invite link when native sharing is unavailable', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        vi.stubGlobal('navigator', { clipboard: { writeText } });

        await expect(shareMeetingInvite('Planning', 'QS-123', 'https://meet.example/join')).resolves.toBe('copied');
        expect(writeText).toHaveBeenCalledWith('https://meet.example/join');
    });

    it('treats a dismissed native share sheet as cancellation', async () => {
        const share = vi.fn().mockRejectedValue(new DOMException('Dismissed', 'AbortError'));
        vi.stubGlobal('navigator', { share });

        await expect(shareMeetingInvite('Planning', 'QS-123', 'https://meet.example/join')).resolves.toBe('cancelled');
    });
});
