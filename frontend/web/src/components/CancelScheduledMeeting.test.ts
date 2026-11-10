import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0, pending: { current: false } }));
vi.mock('react', async original => ({
    ...await original<typeof import('react')>(),
    useRef: () => hooks.pending,
    useState: (initial: unknown) => {
        const index = hooks.cursor++;
        if (!(index in hooks.values)) hooks.values[index] = initial;
        return [hooks.values[index], (value: unknown) => { hooks.values[index] = value; }];
    },
}));
vi.mock('../lib/session', () => ({ getToken: vi.fn(() => 'session'), clearSession: vi.fn(() => true) }));
const signaling = vi.hoisted(() => ({ connect: vi.fn(), request: vi.fn(), disconnect: vi.fn() }));
vi.mock('../lib/signaling', () => ({ SignalingClient: class {
    connect = signaling.connect;
    request = signaling.request;
    disconnect = signaling.disconnect;
} }));
import CancelScheduledMeeting from './CancelScheduledMeeting';
import { getToken, clearSession } from '../lib/session';

const props = () => ({ id: 'meeting-id', title: 'Team call', meetingCode: 'ABC-123', onCancelled: vi.fn(), onExpired: vi.fn() });
function render(value: Parameters<typeof CancelScheduledMeeting>[0]) {
    hooks.cursor = 0;
    return CancelScheduledMeeting(value).props.children;
}
beforeEach(() => {
    hooks.values = []; hooks.pending.current = false;
    vi.clearAllMocks(); vi.mocked(getToken).mockReturnValue('session');
    signaling.connect.mockResolvedValue(undefined); signaling.request.mockResolvedValue({ ended: true });
    vi.stubGlobal('window', { confirm: vi.fn(() => true) });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('requires confirmation and suppresses duplicate cancellation while pending', async () => {
    const value = { ...props(), instant: true };
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    render(value)[0].props.onClick();
    expect(fetch).not.toHaveBeenCalled();
    let finish!: (value: unknown) => void;
    signaling.request.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const button = render(value)[0];
    button.props.onClick(); button.props.onClick();
    expect(signaling.connect).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(signaling.request).toHaveBeenCalledExactlyOnceWith('endHostedMeeting', { meetingCode: 'ABC-123', action: 'cancel' }));
    expect(fetch).not.toHaveBeenCalled();
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('Anyone waiting to join will be disconnected'));
    expect(render(value)[0].props).toMatchObject({ disabled: true, children: 'Cancelling…' });
    finish({ cancelled: true });
    await vi.waitFor(() => expect(value.onCancelled).toHaveBeenCalledOnce());
    expect(render(value)[0].props.disabled).toBe(false);
});

it('preserves the scheduled cancellation endpoint', async () => {
    const value = props(); render(value)[0].props.onClick();
    await vi.waitFor(() => expect(value.onCancelled).toHaveBeenCalledOnce());
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/meeting-id/schedule'), expect.objectContaining({ body: JSON.stringify({ action: 'cancel' }) }));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('external calendar'));
});

it('ends active meetings through signaling without joining or requesting devices', async () => {
    const value = { ...props(), active: true };
    let finish!: (value: unknown) => void;
    signaling.request.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    render(value)[0].props.onClick();
    await vi.waitFor(() => expect(signaling.request).toHaveBeenCalledWith('endHostedMeeting', { meetingCode: 'ABC-123', action: 'end' }));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('Everyone in the meeting and waiting room will be disconnected'));
    expect(render(value)[0].props).toMatchObject({ disabled: true, children: 'Ending…' });
    expect(value.onCancelled).not.toHaveBeenCalled();
    finish({ ended: true });
    await vi.waitFor(() => expect(value.onCancelled).toHaveBeenCalledOnce());
    expect(signaling.disconnect).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
});

it.each([404, 503])('keeps failed cancellations visible and allows retry (%s)', async status => {
    const value = props();
    vi.mocked(fetch).mockResolvedValue({ ok: false, status } as Response);
    render(value)[0].props.onClick();
    await vi.waitFor(() => expect(render(value)[1]?.props.role).toBe('alert'));
    expect(value.onCancelled).not.toHaveBeenCalled();
    expect(render(value)[0].props.disabled).toBe(false);
    vi.mocked(fetch).mockResolvedValue({ ok: true, status: 200 } as Response);
    render(value)[0].props.onClick();
    await vi.waitFor(() => expect(value.onCancelled).toHaveBeenCalledOnce());
});

it('reports active-end failure and clears a confirmed expired cancellation session', async () => {
    const value = { ...props(), active: true };
    signaling.request.mockRejectedValue(new Error('Storage unavailable'));
    render(value)[0].props.onClick();
    await vi.waitFor(() => expect(render(value)[1]?.props.children).toContain('Could not confirm the meeting ended'));
    expect(value.onCancelled).not.toHaveBeenCalled();
    expect(signaling.disconnect).toHaveBeenCalledOnce();
    const waiting = { ...value, active: false, instant: false };
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 401 } as Response);
    render(waiting)[0].props.onClick();
    await vi.waitFor(() => expect(value.onExpired).toHaveBeenCalledOnce());
    expect(clearSession).toHaveBeenCalledWith('session');
});

it('does not update another signed-in account when the session changes mid-request', async () => {
    const value = { ...props(), instant: true };
    signaling.connect.mockImplementation(async () => { vi.mocked(getToken).mockReturnValue('different-session'); });
    render(value)[0].props.onClick();
    await vi.waitFor(() => expect(hooks.pending.current).toBe(false));
    expect(value.onCancelled).not.toHaveBeenCalled();
    expect(clearSession).not.toHaveBeenCalled();
    expect(signaling.request).not.toHaveBeenCalled();
});

it('times out a stalled end request and never sends it if authentication finishes late', async () => {
    vi.useFakeTimers();
    const value = { ...props(), active: true };
    let connected!: () => void;
    signaling.connect.mockReturnValue(new Promise<void>(resolve => { connected = resolve; }));
    render(value)[0].props.onClick();
    await vi.advanceTimersByTimeAsync(20000);
    expect(render(value)[0].props.disabled).toBe(false);
    expect(render(value)[1]?.props.children).toContain('Could not confirm the meeting ended');
    connected();
    await vi.advanceTimersByTimeAsync(0);
    expect(signaling.request).not.toHaveBeenCalled();
    expect(value.onCancelled).not.toHaveBeenCalled();
});

it('keeps failed instant cancellation visible and retries the confirmed signaling flow', async () => {
    const value = { ...props(), instant: true };
    signaling.request.mockRejectedValueOnce(new Error('Storage unavailable'));
    render(value)[0].props.onClick();
    await vi.waitFor(() => expect(render(value)[1]?.props.children).toContain('Could not confirm cancellation'));
    expect(value.onCancelled).not.toHaveBeenCalled();
    expect(render(value)[0].props.disabled).toBe(false);
    render(value)[0].props.onClick();
    await vi.waitFor(() => expect(value.onCancelled).toHaveBeenCalledOnce());
    expect(signaling.request).toHaveBeenLastCalledWith('endHostedMeeting', { meetingCode: 'ABC-123', action: 'cancel' });
});
