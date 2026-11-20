import { expect, it } from 'vitest';
import { meetingJoinPath } from './meeting-join-path';

const origin = 'https://qsvc.example';
const code = 'QS-S-0123456789ABCDEF01234567';
it('keeps the signed token when pasting a link or a previously copied invitation', () => {
    const path = `/meeting/${code}/preview?invite=signed.claims`;
    expect(meetingJoinPath(origin + path, origin)).toBe(path);
    expect(meetingJoinPath(`Team call 10:30 ${origin}${path}`, origin)).toBe(path);
    expect(meetingJoinPath(code, origin)).toBeUndefined();
    expect(meetingJoinPath(path.replace('/meeting', 'https://different.example/meeting'), origin)).toBeUndefined();
    expect(meetingJoinPath('qs-abcd-efgh-ijkl', origin)).toBe('/meeting/QS-ABCD-EFGH-IJKL/preview');
});
