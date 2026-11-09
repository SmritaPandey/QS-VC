import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Writes a new directory only: existing deployment keys must never be overwritten.
const directory = resolve(process.argv[2] || '.secrets');
mkdirSync(directory, { mode: 0o700 });
const keyFile = resolve(directory, 'session-signing.pem');
const { privateKey } = generateKeyPairSync('ed25519');
writeFileSync(keyFile, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600, flag: 'wx' });
const names = ['INTERNAL_AUTH_SECRET', 'TURN_ACCESS_SECRET', 'MEETING_POLICY_SECRET', 'INVITATION_SECRET', 'ORIGIN_AUTH_SECRET', 'TURN_SECRET'];
writeFileSync(resolve(directory, 'security.env'), [
    `SESSION_SIGNING_KEY_FILE=${keyFile}`,
    ...names.map(name => `${name}=${randomBytes(48).toString('base64url')}`), '',
].join('\n'), { mode: 0o600, flag: 'wx' });
console.log(`Created private deployment key files in ${directory}. Load security.env with Compose --env-file; do not commit it.`);
