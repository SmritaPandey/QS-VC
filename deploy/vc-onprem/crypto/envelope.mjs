import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { open, link, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const magic = Buffer.from('QSVCBAK1');
const wrappingIv = Buffer.alloc(8, 0xa6);
const headerLength = magic.length + 12 + 40;
const tagLength = 16;
const [operation, keyPath, input, output] = process.argv.slice(2);
if (!['seal', 'open'].includes(operation) || !keyPath || !input || !output) {
    throw new Error('Usage: node envelope.mjs seal|open PRIVATE_KEK INPUT NEW_OUTPUT');
}
const keyInfo = await stat(keyPath);
if (!keyInfo.isFile() || (keyInfo.mode & 0o077) !== 0 || keyInfo.size !== 32) {
    throw new Error('KEK must be a private file with exactly 32 bytes');
}
const kek = await readFile(keyPath);
const stage = await mkdtemp(join(dirname(output), '.qsvc-envelope-'));
const payload = join(stage, 'payload');
try {
    if (operation === 'seal') {
        const dek = randomBytes(32);
        const nonce = randomBytes(12);
        const wrap = createCipheriv('id-aes256-wrap', kek, wrappingIv);
        const header = Buffer.concat([magic, nonce, wrap.update(dek), wrap.final()]);
        const cipher = createCipheriv('aes-256-gcm', dek, nonce);
        dek.fill(0);
        cipher.setAAD(header);
        const staged = await open(payload, 'wx', 0o600);
        try {
            await staged.writeFile(header);
        } finally {
            await staged.close();
        }
        await pipeline(createReadStream(input), cipher, createWriteStream(payload, { flags: 'a' }));
        const append = await open(payload, 'a');
        try {
            await append.writeFile(cipher.getAuthTag());
        } finally {
            await append.close();
        }
    } else {
        const source = await open(input, 'r');
        try {
            const { size } = await source.stat();
            if (size < headerLength + tagLength) throw new Error('Truncated envelope');
            const header = Buffer.alloc(headerLength);
            const tag = Buffer.alloc(tagLength);
            const first = await source.read(header, 0, header.length, 0);
            const last = await source.read(tag, 0, tag.length, size - tagLength);
            if (first.bytesRead !== header.length || last.bytesRead !== tag.length || !header.subarray(0, magic.length).equals(magic)) {
                throw new Error('Invalid envelope header');
            }
            const unwrap = createDecipheriv('id-aes256-wrap', kek, wrappingIv);
            const dek = Buffer.concat([unwrap.update(header.subarray(20)), unwrap.final()]);
            const cipher = createDecipheriv('aes-256-gcm', dek, header.subarray(8, 20));
            dek.fill(0);
            cipher.setAAD(header);
            cipher.setAuthTag(tag);
            const plaintext = createWriteStream(payload, { flags: 'wx', mode: 0o600 });
            if (size === headerLength + tagLength) {
                await pipeline(Readable.from([]), cipher, plaintext);
            } else {
                await pipeline(source.createReadStream({ start: headerLength, end: size - tagLength - 1, autoClose: false }), cipher, plaintext);
            }
        } finally {
            await source.close();
        }
    }
    await link(payload, output);
} finally {
    kek.fill(0);
    await rm(stage, { recursive: true, force: true });
}
