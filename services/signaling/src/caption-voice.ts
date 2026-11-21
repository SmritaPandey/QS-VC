import { execFile } from 'node:child_process';

const voiceAliases: Record<string, string> = { zh: 'cmn', 'zh-CN': 'cmn', 'zh-TW': 'cmn', iw: 'he', gom: 'kok' };

let activeRenders = 0;

/** Only called with a validated language and translated text from this room. */
export function renderCaptionVoice(text: string, target: string): Promise<string> {
    const base = target.split('-')[0];
    const voice = voiceAliases[target] ?? voiceAliases[base] ?? base;
    if (activeRenders >= 4) return Promise.reject(new Error('Meeting voices are busy'));
    activeRenders++;
    return new Promise<string>((resolve, reject) => {
        const child = execFile('espeak-ng', ['--stdout', '--stdin', '-v', voice], {
            encoding: 'buffer', timeout: 5000, maxBuffer: 4 * 1024 * 1024,
        }, (error, wav) => {
            if (error || wav.length <= 44 || wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 36, 40) !== 'data') {
                reject(new Error('Meeting voice unavailable for this caption language'));
                return;
            }
            // A piped WAV header uses placeholder sizes. Browser decoders need actual lengths.
            wav.writeUInt32LE(wav.length - 8, 4);
            wav.writeUInt32LE(wav.length - 44, 40);
            resolve(wav.toString('base64'));
        });
        child.stdin?.on('error', () => {}); // Early process exit is handled by execFile.
        child.stdin?.end(text.replace(/[\u0000-\u001f]/g, ' '));
    }).finally(() => { activeRenders--; });
}
