/**
 * TranslationPanel — Floating panel showing real-time translated captions
 * and translation controls.
 *
 * Features:
 * - Real-time translated captions with original + translation
 * - TTS toggle (listen to translation)
 * - Speaker/Listener language selectors
 * - Translation confidence meter
 * - Scrolling caption history
 */
import React, { useState, useRef, useEffect } from 'react';
import LanguageSelector from './LanguageSelector';
import type { TranslationResult } from '../lib/realtime-translation';

interface TranslationPanelProps {
    speakerLanguage: string;
    listenerLanguage: string;
    onSpeakerLanguageChange: (code: string) => void;
    onListenerLanguageChange: (code: string) => void;
    translations: (TranslationResult & { speakerName?: string })[];
    ttsEnabled: boolean;
    onTTSToggle: (enabled: boolean) => void;
    onClose: () => void;
    isOpen: boolean;
}

const TranslationPanel: React.FC<TranslationPanelProps> = ({
    speakerLanguage,
    listenerLanguage,
    onSpeakerLanguageChange,
    onListenerLanguageChange,
    translations,
    ttsEnabled,
    onTTSToggle,
    onClose,
    isOpen,
}) => {
    const scrollRef = useRef<HTMLDivElement>(null);
    const [showSettings, setShowSettings] = useState(false);

    // Auto-scroll to latest translation
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [translations]);

    if (!isOpen) return null;

    return (
        <div style={{
            position: 'absolute',
            right: '16px',
            top: '60px',
            width: '380px',
            maxHeight: 'calc(100vh - 160px)',
            background: 'linear-gradient(135deg, #0d0d1e 0%, #1a1a35 100%)',
            borderRadius: '16px',
            border: '1px solid rgba(139,92,246,0.2)',
            boxShadow: '0 20px 60px rgba(0,0,0,0.5), 0 0 40px rgba(139,92,246,0.08)',
            display: 'flex',
            flexDirection: 'column',
            zIndex: 100,
            overflow: 'hidden',
            animation: 'slideInRight 0.3s ease-out',
        }}>
            {/* Header */}
            <div style={{
                padding: '14px 16px',
                borderBottom: '1px solid rgba(255,255,255,0.06)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: 'rgba(139,92,246,0.08)',
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontSize: '20px' }}>🌐</span>
                    <div>
                        <div style={{ fontWeight: 700, color: '#fff', fontSize: '14px' }}>
                            AI Translation
                        </div>
                        <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)' }}>
                            Real-time voice translation
                        </div>
                    </div>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                        onClick={() => setShowSettings(!showSettings)}
                        style={{
                            background: showSettings ? 'rgba(139,92,246,0.3)' : 'rgba(255,255,255,0.06)',
                            border: 'none',
                            borderRadius: '8px',
                            color: '#fff',
                            padding: '6px 8px',
                            cursor: 'pointer',
                            fontSize: '14px',
                        }}
                        title="Settings"
                    >
                        ⚙️
                    </button>
                    <button
                        onClick={onClose}
                        style={{
                            background: 'rgba(255,255,255,0.06)',
                            border: 'none',
                            borderRadius: '8px',
                            color: '#fff',
                            padding: '6px 8px',
                            cursor: 'pointer',
                            fontSize: '14px',
                        }}
                        title="Close"
                    >
                        ✕
                    </button>
                </div>
            </div>

            {/* Language Settings (collapsible) */}
            {showSettings && (
                <div style={{
                    padding: '16px',
                    borderBottom: '1px solid rgba(255,255,255,0.06)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px',
                    background: 'rgba(0,0,0,0.2)',
                }}>
                    <LanguageSelector
                        value={speakerLanguage}
                        onChange={onSpeakerLanguageChange}
                        label="🎤 Speaker's Language"
                    />
                    <div style={{
                        display: 'flex',
                        justifyContent: 'center',
                        padding: '4px',
                    }}>
                        <span style={{
                            background: 'rgba(139,92,246,0.2)',
                            borderRadius: '50%',
                            width: '28px',
                            height: '28px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '14px',
                        }}>
                            ↓
                        </span>
                    </div>
                    <LanguageSelector
                        value={listenerLanguage}
                        onChange={onListenerLanguageChange}
                        label="👂 Translate To"
                    />

                    {/* TTS Toggle */}
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '10px 14px',
                        background: 'rgba(255,255,255,0.04)',
                        borderRadius: '10px',
                        marginTop: '4px',
                    }}>
                        <div>
                            <div style={{ color: '#fff', fontSize: '13px', fontWeight: 600 }}>
                                🔊 Voice Translation
                            </div>
                            <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: '11px' }}>
                                Hear translated text spoken aloud
                            </div>
                        </div>
                        <button
                            onClick={() => onTTSToggle(!ttsEnabled)}
                            style={{
                                width: '44px',
                                height: '24px',
                                borderRadius: '12px',
                                border: 'none',
                                background: ttsEnabled ? '#8b5cf6' : 'rgba(255,255,255,0.15)',
                                cursor: 'pointer',
                                position: 'relative',
                                transition: 'background 0.25s',
                            }}
                        >
                            <span style={{
                                position: 'absolute',
                                top: '2px',
                                left: ttsEnabled ? '22px' : '2px',
                                width: '20px',
                                height: '20px',
                                borderRadius: '50%',
                                background: '#fff',
                                transition: 'left 0.25s',
                                boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                            }} />
                        </button>
                    </div>
                </div>
            )}

            {/* Translation Display */}
            <div
                ref={scrollRef}
                style={{
                    flex: 1,
                    overflowY: 'auto',
                    padding: '12px 16px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px',
                    minHeight: '200px',
                }}
            >
                {translations.length === 0 && (
                    <div style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        height: '200px',
                        color: 'rgba(255,255,255,0.3)',
                        textAlign: 'center',
                    }}>
                        <span style={{ fontSize: '40px', marginBottom: '12px' }}>🌍</span>
                        <div style={{ fontSize: '14px', fontWeight: 600 }}>
                            Waiting for speech...
                        </div>
                        <div style={{ fontSize: '12px', marginTop: '4px' }}>
                            Translations will appear here in real-time
                        </div>
                    </div>
                )}

                {translations.map((t, i) => (
                    <div key={i} style={{
                        background: 'rgba(255,255,255,0.03)',
                        borderRadius: '10px',
                        padding: '10px 12px',
                        borderLeft: `3px solid ${t.confidence > 0.8 ? '#22c55e' : t.confidence > 0.5 ? '#eab308' : '#ef4444'}`,
                    }}>
                        {/* Speaker name */}
                        {t.speakerName && (
                            <div style={{
                                fontSize: '11px',
                                color: '#8b5cf6',
                                fontWeight: 600,
                                marginBottom: '4px',
                            }}>
                                {t.speakerName}
                            </div>
                        )}

                        {/* Original text */}
                        <div style={{
                            fontSize: '12px',
                            color: 'rgba(255,255,255,0.4)',
                            marginBottom: '4px',
                            fontStyle: 'italic',
                        }}>
                            {t.originalText}
                        </div>

                        {/* Translated text */}
                        <div style={{
                            fontSize: '14px',
                            color: '#fff',
                            fontWeight: 500,
                            lineHeight: 1.4,
                        }}>
                            {t.translatedText}
                        </div>

                        {/* Metadata */}
                        <div style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            marginTop: '6px',
                            fontSize: '10px',
                            color: 'rgba(255,255,255,0.25)',
                        }}>
                            <span>
                                {t.sourceLanguage.split('-')[0]} → {t.targetLanguage.split('-')[0]}
                            </span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                {/* Confidence bar */}
                                <div style={{
                                    width: '40px',
                                    height: '3px',
                                    background: 'rgba(255,255,255,0.1)',
                                    borderRadius: '2px',
                                    overflow: 'hidden',
                                }}>
                                    <div style={{
                                        width: `${t.confidence * 100}%`,
                                        height: '100%',
                                        background: t.confidence > 0.8 ? '#22c55e' : t.confidence > 0.5 ? '#eab308' : '#ef4444',
                                        borderRadius: '2px',
                                    }} />
                                </div>
                                <span>
                                    {new Date(t.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                </span>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default TranslationPanel;
