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
    sharedSecret: Uint8Array;
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

async function deriveWrappingKey(sharedSecret: Uint8Array): Promise<Uint8Array> {
    const material = await crypto.subtle.importKey('raw', sharedSecret.slice().buffer as ArrayBuffer, 'HKDF', false, ['deriveBits']);
    return new Uint8Array(await crypto.subtle.deriveBits({
        name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: KEM_LABEL,
    }, material, 256));
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

    async encapsulate(recipientPublicKey: Uint8Array): Promise<PQCEncapsulationResult> {
        if (recipientPublicKey.length !== ml_kem1024.lengths.publicKey) throw new Error('Invalid ML-KEM-1024 public key');
        const { cipherText, sharedSecret } = ml_kem1024.encapsulate(recipientPublicKey);
        const combinedSecret = await deriveWrappingKey(sharedSecret);
        return { ciphertext: cipherText, sharedSecret, combinedSecret };
    }

    async decapsulate(ciphertext: Uint8Array, secretKey: Uint8Array): Promise<Uint8Array> {
        if (ciphertext.length !== ml_kem1024.lengths.cipherText) throw new Error('Invalid ML-KEM-1024 ciphertext');
        if (secretKey.length !== ml_kem1024.lengths.secretKey) throw new Error('Invalid ML-KEM-1024 secret key');
        return deriveWrappingKey(ml_kem1024.decapsulate(ciphertext, secretKey));
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
    validatedCryptoModule: false;
    hybridMode: false;
    wasmAvailable: boolean;
    keyRotationEpoch: number;
    lastKeyRotation: number;
    sharedSecretBits: number;
    cipherSuite: string;
    standards: string[];
}

/** Reports the actual bundled algorithm path; it does not claim FIPS 140 validation. */
export function getPQCSecurityStatus(_kemAlgo?: string, _sigAlgo?: string, _wasmAvailable = true, epoch = 0): PQCSecurityStatus {
    return {
        kemAlgorithm: PQC_ALGORITHMS.KEM_ML_KEM_1024,
        sigAlgorithm: PQC_ALGORITHMS.SIG_ML_DSA_87,
        kemLevel: 'NIST security category 5',
        sigLevel: 'NIST security category 5',
        nistCompliant: true,
        validatedCryptoModule: false,
        hybridMode: false,
        wasmAvailable: true,
        keyRotationEpoch: epoch,
        lastKeyRotation: Date.now(),
        sharedSecretBits: 256,
        cipherSuite: 'ML-KEM-1024 + ML-DSA-87 + AES-256-GCM',
        standards: ['NIST FIPS 203 (ML-KEM-1024)', 'NIST FIPS 204 (ML-DSA-87)'],
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

    async encapsulateForPeer(peerPublicKey: Uint8Array): Promise<PQCEncapsulationResult> {
        return this.kem.encapsulate(peerPublicKey);
    }

    async decapsulate(ciphertext: Uint8Array): Promise<Uint8Array> {
        if (!this.keyPair) throw new Error('PQC not initialized');
        return this.kem.decapsulate(ciphertext, this.keyPair.secretKey);
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

    getSecurityStatus(epoch = 0): PQCSecurityStatus { return getPQCSecurityStatus(undefined, undefined, true, epoch); }
    isInitialized(): boolean { return !!this.keyPair && !!this.sigKeyPair; }
}

export const pqcManager = new PQCManager();
