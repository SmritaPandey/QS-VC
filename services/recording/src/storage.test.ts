import { GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { afterEach, expect, it, vi } from 'vitest';
import { createS3Storage } from './storage.js';

afterEach(() => vi.restoreAllMocks());

it.each(['head', 'get'] as const)('checks the allowed S3 prefix when %s returns a forbidden response', async method => {
    const key = 'recordings/account/meeting/recording.mp4';
    const forbidden = Object.assign(new Error('Forbidden'), { $metadata: { httpStatusCode: 403 } });
    let exists = false;
    const send = vi.spyOn(S3Client.prototype, 'send').mockImplementation(async command => {
        if (command instanceof HeadObjectCommand || command instanceof GetObjectCommand) throw forbidden;
        expect(command).toBeInstanceOf(ListObjectsV2Command);
        expect(command.input).toMatchObject({ Bucket: 'recordings-test', Prefix: key, MaxKeys: 1 });
        return { Contents: [{ Key: exists ? key : key + '.other' }] };
    });
    const storage = createS3Storage('recordings-test');
    await expect(storage[method](key)).resolves.toBeNull();
    exists = true;
    await expect(storage[method](key)).rejects.toBe(forbidden);
    expect(send).toHaveBeenCalledTimes(4);
});
