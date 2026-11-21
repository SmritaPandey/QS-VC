import { afterEach, expect, it, vi } from 'vitest';
import { generateMinutes, minutesConfigured } from './minutes';
import { askOpenRouter } from './openrouter';

vi.mock('./openrouter.js', () => ({ openRouterConfigured: () => true, askOpenRouter: vi.fn() }));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

const transcript = [{ id: 'line', peerId: 'peer', speaker: 'Speaker', language: 'en', text: 'Approved the budget.', timestamp: 0 }];

it('uses the online router for host-requested minutes', async () => {
    vi.stubEnv('QSVC_DEPLOYMENT', 'online');
    vi.mocked(askOpenRouter).mockResolvedValue('Budget approved.');
    expect(minutesConfigured()).toBe(true);
    await expect(generateMinutes(transcript)).resolves.toBe('Budget approved.');
    expect(askOpenRouter).toHaveBeenCalledWith(expect.any(String), expect.stringContaining('Approved the budget.'));
});

it('keeps direct online routing disabled on-prem even when router credentials exist', async () => {
    vi.stubEnv('QSVC_DEPLOYMENT', 'onprem');
    vi.stubEnv('QSVC_AI_GATEWAY_ENABLED', 'false');
    expect(minutesConfigured()).toBe(false);
    await expect(generateMinutes(transcript)).rejects.toThrow('not configured');
    expect(askOpenRouter).not.toHaveBeenCalled();
});

it('answers a greeting-only transcript locally and escalates substantive transcripts', async () => {
    await expect(generateMinutes([{ ...transcript[0], text: 'Hello!' }])).resolves.toContain('only greetings');
    expect(askOpenRouter).not.toHaveBeenCalled();
});
