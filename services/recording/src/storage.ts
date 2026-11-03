import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export interface StoredObject { body: Uint8Array; type: string; size: number; modified: Date }
export interface RecordingStorage {
    put(key: string, body: Uint8Array, type: string, ifAbsent?: boolean): Promise<void>;
    get(key: string): Promise<StoredObject | null>;
    head(key: string): Promise<Omit<StoredObject, 'body'> | null>;
    remove(key: string): Promise<void>;
    list(prefix: string, cursor?: string): Promise<{ objects: { key: string; size: number; modified: Date }[]; nextCursor?: string }>;
    playback(key: string): Promise<string>;
}

function missing(error: unknown) {
    const value = error as { name?: string; $metadata?: { httpStatusCode?: number } };
    return value.name === 'NoSuchKey' || value.name === 'NotFound' || value.$metadata?.httpStatusCode === 404;
}

export function createS3Storage(bucket: string): RecordingStorage {
    const client = new S3Client({ region: process.env.AWS_REGION || 'ap-south-1', requestHandler: { connectionTimeout: 5000, requestTimeout: 60000 } });
    const params = (Key: string) => ({ Bucket: bucket, Key });
    return {
        async put(key, body, type, ifAbsent = false) {
            await client.send(new PutObjectCommand({ ...params(key), Body: body, ContentType: type, ServerSideEncryption: 'AES256', CacheControl: 'private, no-store', ...(ifAbsent ? { IfNoneMatch: '*' } : {}) }));
        },
        async get(key) {
            try {
                const value = await client.send(new GetObjectCommand(params(key)));
                return { body: await value.Body!.transformToByteArray(), type: value.ContentType || '', size: value.ContentLength || 0, modified: value.LastModified || new Date(0) };
            } catch (error) { if (missing(error)) return null; throw error; }
        },
        async head(key) {
            try {
                const value = await client.send(new HeadObjectCommand(params(key)));
                return { type: value.ContentType || '', size: value.ContentLength || 0, modified: value.LastModified || new Date(0) };
            } catch (error) { if (missing(error)) return null; throw error; }
        },
        async remove(key) { await client.send(new DeleteObjectCommand(params(key))); },
        async list(prefix, cursor) {
            const page = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, MaxKeys: 100, ContinuationToken: cursor }));
            return { objects: (page.Contents || []).map(item => ({ key: item.Key!, size: item.Size || 0, modified: item.LastModified || new Date(0) })), nextCursor: page.NextContinuationToken };
        },
        async playback(key) { return getSignedUrl(client, new GetObjectCommand(params(key)), { expiresIn: 300 }); },
    };
}
