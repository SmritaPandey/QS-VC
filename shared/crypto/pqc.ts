import { ml_kem1024 } from '@noble/post-quantum/ml-kem.js';
import { ml_dsa87 } from '@noble/post-quantum/ml-dsa.js';

export const PQC_ALGORITHMS = {
    KEM_ML_KEM_1024: 'ML-KEM-1024',
    SIG_ML_DSA_87: 'ML-DSA-87',
} as const;

export type PQCAlgorithm = typeof PQC_ALGORITHMS[keyof typeof PQC_ALGORITHMS];

export interface PQCKeyPair {
    algorithm: PQCAlgorithm;
    publicKey: Uint8Array;
    secretKey: Uint8Array;
    createdAt: number;
    expiresAt: number;
}

export interface PQCEncapsulationResult {
    ciphertext: Uint8Array;
    combinedSecret: Uint8Array;
}

export interface PQCSignature {
    algorithm: PQCAlgorithm;
    signature: Uint8Array;
    publicKey: Uint8Array;
    timestamp: number;
}

const KEM_LABEL = new TextEncoder().encode('QS-VC ML-KEM-1024 key wrapping v1');
const SIGNATURE_CONTEXT = new TextEncoder().encode('QS-VC ML-DSA-87 v1');

/** One-block SP 800-108 Rev. 1 Counter KDF using HMAC-SHA-256 (L = 256 bits). */
export async function deriveSP800108CounterKey(keyDerivationKey: Uint8Array, label: Uint8Array, context: Uint8Array): Promise<Uint8Array> {
    if (!keyDerivationKey.length || !label.length || label.length > 256 || context.length > 512) {
        throw new Error('Invalid SP 800-108 key derivation input');
    }
    const kdkBytes = keyDerivationKey.slice();
    let hmacKey: CryptoKey;
    try {
        hmacKey = await crypto.subtle.importKey('raw', kdkBytes.buffer as ArrayBuffer, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    } finally { kdkBytes.fill(0); }

    // [i]32 || Label || 0x00 || Context || [L]32, with i = 1 and L = 256.
    const input = new Uint8Array(4 + label.length + 1 + context.length + 4);
    const view = new DataView(input.buffer);
    view.setUint32(0, 1, false);
    input.set(label, 4);
    input[4 + label.length] = 0;
    input.set(context, 5 + label.length);
    view.setUint32(input.length - 4, 256, false);
    return new Uint8Array(await crypto.subtle.sign('HMAC', hmacKey, input));
}

async function deriveWrappingKey(sharedSecret: Uint8Array, context: Uint8Array): Promise<Uint8Array> {
    if (context.length < 1 || context.length > 512) throw new Error('Invalid ML-KEM key derivation context');
    return deriveSP800108CounterKey(sharedSecret, KEM_LABEL, context);
}

/** FIPS 203 ML-KEM-1024. This class never substitutes a classical algorithm. */
export class KyberKEM {
    async init(): Promise<void> {
        // The implementation is bundled with the app; no runtime asset or fallback is used.
    }

    async generateKeyPair(): Promise<PQCKeyPair> {
        const { publicKey, secretKey } = ml_kem1024.keygen();
        const now = Date.now();
        return { algorithm: PQC_ALGORITHMS.KEM_ML_KEM_1024, publicKey, secretKey, createdAt: now, expiresAt: now + 86_400_000 };
    }

    async encapsulate(recipientPublicKey: Uint8Array, context: Uint8Array): Promise<PQCEncapsulationResult> {
        if (recipientPublicKey.length !== ml_kem1024.lengths.publicKey) throw new Error('Invalid ML-KEM-1024 public key');
        const { cipherText, sharedSecret } = ml_kem1024.encapsulate(recipientPublicKey);
        try {
            return { ciphertext: cipherText, combinedSecret: await deriveWrappingKey(sharedSecret, context) };
        } finally { sharedSecret.fill(0); }
    }

    async decapsulate(ciphertext: Uint8Array, secretKey: Uint8Array, context: Uint8Array): Promise<Uint8Array> {
        if (ciphertext.length !== ml_kem1024.lengths.cipherText) throw new Error('Invalid ML-KEM-1024 ciphertext');
        if (secretKey.length !== ml_kem1024.lengths.secretKey) throw new Error('Invalid ML-KEM-1024 secret key');
        const sharedSecret = ml_kem1024.decapsulate(ciphertext, secretKey);
        try { return await deriveWrappingKey(sharedSecret, context); }
        finally { sharedSecret.fill(0); }
    }
}

/** FIPS 204 ML-DSA-87. The public API uses the standardized algorithm name. */
export class DilithiumSigner {
    async init(): Promise<void> {
        // The implementation is bundled with the app; no runtime asset or fallback is used.
    }

    async generateKeyPair(): Promise<PQCKeyPair> {
        const { publicKey, secretKey } = ml_dsa87.keygen();
        const now = Date.now();
        return { algorithm: PQC_ALGORITHMS.SIG_ML_DSA_87, publicKey, secretKey, createdAt: now, expiresAt: now + 86_400_000 };
    }

    async sign(message: Uint8Array, secretKey: Uint8Array): Promise<PQCSignature> {
        if (secretKey.length !== ml_dsa87.lengths.secretKey) throw new Error('Invalid ML-DSA-87 secret key');
        return {
            algorithm: PQC_ALGORITHMS.SIG_ML_DSA_87,
            signature: ml_dsa87.sign(message, secretKey, { context: SIGNATURE_CONTEXT }),
            publicKey: new Uint8Array(0),
            timestamp: Date.now(),
        };
    }

    async verify(message: Uint8Array, signature: PQCSignature, publicKey: Uint8Array): Promise<boolean> {
        if (signature.algorithm !== PQC_ALGORITHMS.SIG_ML_DSA_87 || publicKey.length !== ml_dsa87.lengths.publicKey) return false;
        try {
            return ml_dsa87.verify(signature.signature, message, publicKey, { context: SIGNATURE_CONTEXT });
        } catch {
            return false;
        }
    }
}

export interface PQCSecurityStatus {
    kemAlgorithm: string;
    sigAlgorithm: string;
    kemLevel: string;
    sigLevel: string;
    nistCompliant: boolean;
    nistAlgorithmStandardized: boolean;
    validatedCryptoModule: false;
    complianceScope: string;
    hybridMode: false;
    wasmAvailable: boolean;
    keyRotationEpoch: number;
    lastKeyRotation: number;
    sharedSecretBits: number;
    cipherSuite: string;
    standards: string[];
}

/** Reports the algorithm path actually used for media keys. FIPS 140-3 module validation is separate. */
export function getPQCSecurityStatus(_kemAlgo?: string, _sigAlgo?: string, _wasmAvailable = false, epoch = 0): PQCSecurityStatus {
    return {
        kemAlgorithm: PQC_ALGORITHMS.KEM_ML_KEM_1024,
        sigAlgorithm: PQC_ALGORITHMS.SIG_ML_DSA_87,
        kemLevel: 'Security category 5 parameter set',
        sigLevel: 'Security category 5 parameter set',
        // NIST-compliant algorithms: ML-KEM-1024 (FIPS 203), ML-DSA-87 (FIPS 204) with their
        // standard parameter sets, SP 800-108 Rev. 1 KDF and AES-256-GCM (SP 800-38D), with no
        // classical fallback. Module certification (FIPS 140-3/CMVP) is reported separately.
        nistCompliant: true,
        nistAlgorithmStandardized: true,
        validatedCryptoModule: false,
        complianceScope: 'NIST algorithms FIPS 203, FIPS 204, SP 800-108r1, SP 800-38D; CMVP (FIPS 140-3) module validation pending',
        hybridMode: false,
        wasmAvailable: false,
        keyRotationEpoch: epoch,
        lastKeyRotation: epoch ? epoch * 60_000 : 0,
        sharedSecretBits: 256,
        cipherSuite: 'ML-KEM-1024 + ML-DSA-87 + SP 800-108 Counter/HMAC-SHA-256 + AES-256-GCM',
        standards: ['FIPS 203: ML-KEM-1024', 'FIPS 204: ML-DSA-87', 'SP 800-108 Rev. 1 Counter KDF', 'SP 800-38D: AES-256-GCM'],
    };
}

export class PQCManager {
    private readonly kem = new KyberKEM();
    private readonly signer = new DilithiumSigner();
    private keyPair: PQCKeyPair | null = null;
    private sigKeyPair: PQCKeyPair | null = null;

    async init(): Promise<void> {
        await Promise.all([this.kem.init(), this.signer.init()]);
        [this.keyPair, this.sigKeyPair] = await Promise.all([this.kem.generateKeyPair(), this.signer.generateKeyPair()]);
    }

    getPublicKey(): Uint8Array {
        if (!this.keyPair) throw new Error('PQC not initialized');
        return this.keyPair.publicKey;
    }

    getSigningPublicKey(): Uint8Array {
        if (!this.sigKeyPair) throw new Error('PQC not initialized');
        return this.sigKeyPair.publicKey;
    }

    async encapsulateForPeer(peerPublicKey: Uint8Array, context: Uint8Array): Promise<PQCEncapsulationResult> {
        return this.kem.encapsulate(peerPublicKey, context);
    }

    async decapsulate(ciphertext: Uint8Array, context: Uint8Array): Promise<Uint8Array> {
        if (!this.keyPair) throw new Error('PQC not initialized');
        return this.kem.decapsulate(ciphertext, this.keyPair.secretKey, context);
    }

    async sign(data: Uint8Array): Promise<PQCSignature> {
        if (!this.sigKeyPair) throw new Error('PQC not initialized');
        const signature = await this.signer.sign(data, this.sigKeyPair.secretKey);
        signature.publicKey = this.sigKeyPair.publicKey;
        return signature;
    }

    async verify(data: Uint8Array, signature: PQCSignature, peerPublicKey: Uint8Array): Promise<boolean> {
        return this.signer.verify(data, signature, peerPublicKey);
    }

    destroy(): void {
        this.keyPair?.secretKey.fill(0);
        this.sigKeyPair?.secretKey.fill(0);
        this.keyPair = null;
        this.sigKeyPair = null;
    }

    getSecurityStatus(epoch = 0): PQCSecurityStatus { return getPQCSecurityStatus(undefined, undefined, true, epoch); }
    isInitialized(): boolean { return !!this.keyPair && !!this.sigKeyPair; }
}

export const pqcManager = new PQCManager();
