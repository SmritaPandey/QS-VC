/**
 * SecurityDashboard — Quantum-Safe Security Status Panel for QS-VC.
 *
 * Displays real-time PQC security indicators:
 * - Active encryption algorithms (ML-KEM-1024 / ML-DSA-87)
 * - NIST algorithm compliance (FIPS 203 / FIPS 204)
 * - Key rotation status
 * - Cipher suite details
 * - Standards badges
 */
import React, { useState, useEffect } from 'react';

interface SecurityStatusData {
    kemAlgorithm: string;
    sigAlgorithm: string;
    kemLevel: string;
    sigLevel: string;
    nistCompliant: boolean;
    hybridMode: boolean;
    wasmAvailable: boolean;
    keyRotationEpoch: number;
    lastKeyRotation: number;
    sharedSecretBits: number;
    cipherSuite: string;
    standards: string[];
}

interface SecurityDashboardProps {
    status: SecurityStatusData;
    e2eeActive: boolean;
    onClose: () => void;
    isOpen: boolean;
}

const SecurityDashboard: React.FC<SecurityDashboardProps> = ({
    status,
    e2eeActive,
    onClose,
    isOpen,
}) => {
    const [pulseClass, setPulseClass] = useState(false);

    useEffect(() => {
        const interval = setInterval(() => setPulseClass(p => !p), 2000);
        return () => clearInterval(interval);
    }, []);

    if (!isOpen) return null;

    const securityLevel = e2eeActive ? 'Maximum (PQC end-to-end)' : 'Transport (DTLS-SRTP)';
    const securityColor = e2eeActive ? '#22c55e' : '#94a3b8';

    return (
        <div style={{
            position: 'absolute',
            left: '16px',
            top: '60px',
            width: '380px',
            maxHeight: 'calc(100vh - 160px)',
            background: 'linear-gradient(135deg, #0a0a1a 0%, #0d1b2a 100%)',
            borderRadius: '16px',
            border: '1px solid rgba(34,197,94,0.2)',
            boxShadow: '0 20px 60px rgba(0,0,0,0.5), 0 0 40px rgba(34,197,94,0.08)',
            zIndex: 100,
            overflow: 'hidden',
            animation: 'slideInLeft 0.3s ease-out',
        }}>
            {/* Header */}
            <div style={{
                padding: '16px',
                borderBottom: '1px solid rgba(255,255,255,0.06)',
                background: 'rgba(34,197,94,0.06)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{
                        width: '36px', height: '36px',
                        borderRadius: '10px',
                        background: `linear-gradient(135deg, ${securityColor}22, ${securityColor}44)`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '18px',
                        border: `1px solid ${securityColor}44`,
                    }}>
                        🔐
                    </div>
                    <div>
                        <div style={{ fontWeight: 700, color: '#fff', fontSize: '14px' }}>
                            Media security status
                        </div>
                        <div style={{ fontSize: '11px', color: securityColor, fontWeight: 600 }}>
                            {securityLevel}
                        </div>
                    </div>
                </div>
                <button onClick={onClose} style={{
                    background: 'rgba(255,255,255,0.06)',
                    border: 'none', borderRadius: '8px',
                    color: '#fff', padding: '6px 8px', cursor: 'pointer',
                }}>✕</button>
            </div>

            <div style={{ padding: '16px', overflowY: 'auto', maxHeight: '500px' }}>
                {/* E2EE Status */}
                <div style={{
                    padding: '12px 14px',
                    borderRadius: '10px',
                    background: e2eeActive ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)',
                    border: `1px solid ${e2eeActive ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}`,
                    marginBottom: '14px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                }}>
                    <span style={{
                        fontSize: '14px',
                        color: e2eeActive ? '#22c55e' : '#ef4444',
                        animation: pulseClass ? 'none' : 'none',
                    }}>
                        {e2eeActive ? '🟢' : '🔴'}
                    </span>
                    <div>
                        <div style={{ fontWeight: 600, color: '#fff', fontSize: '13px' }}>
                            End-to-End Encryption: {e2eeActive ? 'ACTIVE' : 'OFF FOR THIS MEETING'}
                        </div>
                        <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)' }}>
                            {e2eeActive
                                ? 'The media server forwards encrypted frames it cannot read. Compare the security code to confirm nobody intercepted the keys.'
                                : 'The organiser turned off end-to-end encryption. Media is protected in transit with DTLS-SRTP.'}
                        </div>
                    </div>
                </div>

                {/* Crypto Algorithms */}
                <div style={{ marginBottom: '14px' }}>
                    <div style={{ fontSize: '11px', fontWeight: 700, color: '#8b5cf6', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>
                        Algorithm suite
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                        <AlgoCard
                            label="Key Exchange"
                            algo={status.kemAlgorithm}
                            level={status.kemLevel}
                            icon="🔑"
                            standard="NIST FIPS 203"
                        />
                        <AlgoCard
                            label="Signatures"
                            algo={status.sigAlgorithm}
                            level={status.sigLevel}
                            icon="✍️"
                            standard="NIST FIPS 204"
                        />
                        <AlgoCard
                            label="Symmetric"
                            algo="AES-256-GCM"
                            level="256-bit"
                            icon="🔒"
                            standard="AES standard: FIPS 197"
                        />
                        <AlgoCard
                            label="Key Derivation"
                            algo="SP 800-108 Counter/HMAC-SHA-256"
                            level="256-bit"
                            icon="🗝️"
                            standard="KDF construction: SP 800-108 Rev. 1"
                        />
                    </div>
                </div>

                {/* Key Rotation */}
                <div style={{
                    padding: '12px 14px',
                    borderRadius: '10px',
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.06)',
                    marginBottom: '14px',
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)' }}>Key Rotation Epoch</div>
                        <div style={{ fontSize: '14px', fontWeight: 700, color: '#fff', fontFamily: 'monospace' }}>
                            #{status.keyRotationEpoch}
                        </div>
                    </div>
                    <div style={{
                        height: '4px', background: 'rgba(255,255,255,0.06)',
                        borderRadius: '2px', marginTop: '8px', overflow: 'hidden',
                    }}>
                        <div style={{
                            height: '100%',
                            width: `${((Date.now() - status.lastKeyRotation) / 60000) * 100}%`,
                            background: 'linear-gradient(90deg, #22c55e, #eab308)',
                            borderRadius: '2px',
                            transition: 'width 1s linear',
                            maxWidth: '100%',
                        }} />
                    </div>
                    <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)', marginTop: '4px' }}>
                        Media frame keys use 60-second epochs. This is not a forward-secrecy guarantee.
                    </div>
                </div>

                {/* Cipher Suite */}
                <div style={{
                    padding: '10px 14px',
                    borderRadius: '10px',
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.06)',
                    marginBottom: '14px',
                }}>
                    <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', marginBottom: '4px' }}>Cipher Suite</div>
                    <div style={{ fontSize: '12px', color: '#fff', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                        {status.cipherSuite}
                    </div>
                </div>

                {/* Algorithm references and validation state */}
                <div>
                    <div style={{ fontSize: '11px', fontWeight: 700, color: '#8b5cf6', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>
                        Standards Compliance
                    </div>
                    <p style={{ fontSize: '10px', lineHeight: 1.5, color: 'rgba(255,255,255,0.48)', margin: '8px 0 0' }}>
                        NIST-standardized post-quantum algorithms with their standard parameter sets. FIPS 140-3 (CMVP) module validation is a separate certification.
                    </p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                        {status.standards.map((std, i) => (
                            <span key={i} style={{
                                padding: '4px 8px',
                                borderRadius: '6px',
                                background: 'rgba(148,163,184,0.08)',
                                border: '1px solid rgba(148,163,184,0.18)',
                                color: '#cbd5e1',
                                fontSize: '10px',
                                fontWeight: 600,
                                whiteSpace: 'nowrap',
                            }}>
                                • {std}
                            </span>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

const AlgoCard: React.FC<{
    label: string; algo: string; level: string; icon: string; standard: string;
}> = ({ label, algo, level, icon, standard }) => (
    <div style={{
        padding: '10px',
        borderRadius: '10px',
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.06)',
    }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
            <span style={{ fontSize: '14px' }}>{icon}</span>
            <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)' }}>{label}</span>
        </div>
        <div style={{ fontSize: '12px', color: '#fff', fontWeight: 600 }}>{algo}</div>
        <div style={{ fontSize: '10px', color: '#cbd5e1', marginTop: '2px' }}>{level}</div>
        <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.25)', marginTop: '2px' }}>{standard}</div>
    </div>
);

export default SecurityDashboard;
