import { expect, it } from 'vitest';
import { authorizedControlRequest } from './control-auth';

it('accepts only the matching bearer credential', () => {
    expect(authorizedControlRequest('Bearer sample', 'sample')).toBe(true);
    for (const value of [undefined, 'Bearer tamper', 'Bearer sample ', 'Basic sample', 'Bearer 样本']) {
        expect(authorizedControlRequest(value, 'sample')).toBe(false);
    }
});
