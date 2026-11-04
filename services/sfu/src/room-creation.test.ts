import { expect, it, vi } from 'vitest';
import { coalesceRoomCreation } from './room-creation';

it('coalesces simultaneous creation for one room and leaves other rooms independent', async () => {
    const create = vi.fn(async (id: string) => ({ id }));
    const get = coalesceRoomCreation(create);
    const first = get('alpha');
    expect(get('alpha')).toBe(first);
    expect(await get('beta')).toEqual({ id: 'beta' });
    expect(await first).toEqual({ id: 'alpha' });
    expect(create.mock.calls).toEqual([['alpha'], ['beta']]);
});

it('allows retry after router creation fails', async () => {
    const create = vi.fn(async (id: string) => ({ id }));
    create.mockRejectedValueOnce(new Error('worker unavailable'));
    const get = coalesceRoomCreation(create);
    await expect(get('alpha')).rejects.toThrow('worker unavailable');
    await expect(get('alpha')).resolves.toEqual({ id: 'alpha' });
});
