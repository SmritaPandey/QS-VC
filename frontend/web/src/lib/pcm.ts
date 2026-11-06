/** Pure audio helpers for server speech recognition (no browser globals). */
export const TARGET_RATE = 16_000;

/** Linear-interpolation resample of mono float samples to 16 kHz. */
export function resampleTo16k(input: Float32Array, inputRate: number): Float32Array {
    if (inputRate === TARGET_RATE) return input;
    const ratio = inputRate / TARGET_RATE;
    const length = Math.floor(input.length / ratio);
    const output = new Float32Array(length);
    for (let i = 0; i < length; i++) {
        const position = i * ratio;
        const index = Math.floor(position);
        const next = Math.min(index + 1, input.length - 1);
        output[i] = input[index] + (input[next] - input[index]) * (position - index);
    }
    return output;
}

export function floatToPcm16Base64(samples: Float32Array): string {
    const bytes = new Uint8Array(samples.length * 2);
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < samples.length; i++) {
        const clamped = Math.max(-1, Math.min(1, samples[i]));
        view.setInt16(i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    }
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
}

