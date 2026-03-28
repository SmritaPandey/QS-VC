/**
 * LanguageSelector — Dropdown to select speaker/listener language.
 *
 * Features:
 * - Grouped by region (Indian, East Asian, European, Middle Eastern, African)
 * - Search/filter
 * - Native script display
 * - Flags/icons per region
 */
import React, { useState, useMemo } from 'react';
import { LANGUAGES, getLanguagesByRegion, type LanguageInfo } from '../lib/realtime-translation';

interface LanguageSelectorProps {
    value: string;
    onChange: (langCode: string) => void;
    label: string;                  // "I speak" or "Translate to"
    compact?: boolean;              // Compact mode for toolbar
    showNativeNames?: boolean;      // Show native script names
}

const REGION_LABELS: Record<string, { label: string; icon: string }> = {
    'indian':         { label: 'Indian Languages',       icon: '🇮🇳' },
    'east-asian':     { label: 'East Asian',             icon: '🌏' },
    'european':       { label: 'European',               icon: '🌍' },
    'middle-eastern': { label: 'Middle Eastern',         icon: '🌙' },
    'african':        { label: 'African',                icon: '🌍' },
    'other':          { label: 'Other',                  icon: '🌐' },
};

const LanguageSelector: React.FC<LanguageSelectorProps> = ({
    value,
    onChange,
    label,
    compact = false,
    showNativeNames = true,
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [search, setSearch] = useState('');

    const grouped = useMemo(() => getLanguagesByRegion(), []);

    const selectedLang = useMemo(
        () => LANGUAGES.find(l => l.code === value),
        [value]
    );

    const filteredGrouped = useMemo(() => {
        if (!search.trim()) return grouped;
        const q = search.toLowerCase();
        const result: Record<string, LanguageInfo[]> = {};
        for (const [region, langs] of Object.entries(grouped)) {
            const filtered = langs.filter(
                l => l.name.toLowerCase().includes(q) ||
                     l.nativeName.toLowerCase().includes(q) ||
                     l.code.toLowerCase().includes(q)
            );
            if (filtered.length > 0) result[region] = filtered;
        }
        return result;
    }, [grouped, search]);

    const totalResults = Object.values(filteredGrouped).reduce((s, a) => s + a.length, 0);

    if (compact) {
        return (
            <div style={{ position: 'relative', display: 'inline-block' }}>
                <button
                    onClick={() => setIsOpen(!isOpen)}
                    style={{
                        background: 'rgba(255,255,255,0.08)',
                        border: '1px solid rgba(255,255,255,0.15)',
                        borderRadius: '8px',
                        color: '#fff',
                        padding: '6px 12px',
                        cursor: 'pointer',
                        fontSize: '13px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        transition: 'all 0.2s',
                    }}
                    title={label}
                >
                    <span>🌐</span>
                    <span>{selectedLang?.code.split('-')[0].toUpperCase() || 'EN'}</span>
                    <span style={{ fontSize: '10px', opacity: 0.6 }}>▼</span>
                </button>
                {isOpen && renderDropdown()}
            </div>
        );
    }

    function renderDropdown() {
        return (
            <>
                {/* Backdrop */}
                <div
                    style={{ position: 'fixed', inset: 0, zIndex: 999 }}
                    onClick={() => { setIsOpen(false); setSearch(''); }}
                />
                <div style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    marginTop: '4px',
                    width: '320px',
                    maxHeight: '420px',
                    background: '#1a1a2e',
                    border: '1px solid rgba(255,255,255,0.15)',
                    borderRadius: '12px',
                    boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
                    overflow: 'hidden',
                    zIndex: 1000,
                    display: 'flex',
                    flexDirection: 'column',
                }}>
                    {/* Search */}
                    <div style={{ padding: '12px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                        <input
                            type="text"
                            placeholder="Search languages..."
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            autoFocus
                            style={{
                                width: '100%',
                                background: 'rgba(255,255,255,0.06)',
                                border: '1px solid rgba(255,255,255,0.1)',
                                borderRadius: '8px',
                                color: '#fff',
                                padding: '8px 12px',
                                fontSize: '13px',
                                outline: 'none',
                                boxSizing: 'border-box',
                            }}
                        />
                        <div style={{ fontSize: '11px', opacity: 0.5, marginTop: '4px', color: '#aaa' }}>
                            {totalResults} languages available
                        </div>
                    </div>

                    {/* Language groups */}
                    <div style={{ overflowY: 'auto', flex: 1 }}>
                        {Object.entries(filteredGrouped).map(([region, langs]) => (
                            <div key={region}>
                                <div style={{
                                    padding: '8px 16px',
                                    fontSize: '11px',
                                    fontWeight: 700,
                                    textTransform: 'uppercase',
                                    letterSpacing: '1px',
                                    color: '#8b5cf6',
                                    background: 'rgba(139,92,246,0.05)',
                                    borderBottom: '1px solid rgba(255,255,255,0.05)',
                                    position: 'sticky',
                                    top: 0,
                                }}>
                                    {REGION_LABELS[region]?.icon || '🌐'} {REGION_LABELS[region]?.label || region}
                                </div>
                                {langs.map(lang => (
                                    <button
                                        key={lang.code}
                                        onClick={() => {
                                            onChange(lang.code);
                                            setIsOpen(false);
                                            setSearch('');
                                        }}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'space-between',
                                            width: '100%',
                                            padding: '10px 16px',
                                            background: lang.code === value ? 'rgba(139,92,246,0.15)' : 'transparent',
                                            border: 'none',
                                            borderBottom: '1px solid rgba(255,255,255,0.03)',
                                            color: '#fff',
                                            cursor: 'pointer',
                                            fontSize: '13px',
                                            textAlign: 'left',
                                            transition: 'background 0.15s',
                                        }}
                                        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
                                        onMouseLeave={e => (e.currentTarget.style.background = lang.code === value ? 'rgba(139,92,246,0.15)' : 'transparent')}
                                    >
                                        <div>
                                            <div style={{ fontWeight: lang.code === value ? 700 : 400 }}>
                                                {lang.name}
                                                {showNativeNames && lang.nativeName !== lang.name && (
                                                    <span style={{ opacity: 0.6, marginLeft: '8px', fontSize: '12px' }}>
                                                        {lang.nativeName}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                            {lang.ttsSupported && (
                                                <span title="Voice available" style={{ fontSize: '12px' }}>🔊</span>
                                            )}
                                            {lang.code === value && (
                                                <span style={{ color: '#8b5cf6', fontSize: '16px' }}>✓</span>
                                            )}
                                        </div>
                                    </button>
                                ))}
                            </div>
                        ))}
                    </div>
                </div>
            </>
        );
    }

    return (
        <div style={{ position: 'relative' }}>
            <label style={{
                display: 'block',
                fontSize: '12px',
                fontWeight: 600,
                marginBottom: '4px',
                color: '#aaa',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
            }}>
                {label}
            </label>
            <button
                onClick={() => setIsOpen(!isOpen)}
                style={{
                    width: '100%',
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    borderRadius: '10px',
                    color: '#fff',
                    padding: '10px 14px',
                    cursor: 'pointer',
                    fontSize: '14px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    transition: 'all 0.2s',
                }}
            >
                <span>
                    {selectedLang ? (
                        <>
                            {selectedLang.name}
                            {showNativeNames && selectedLang.nativeName !== selectedLang.name && (
                                <span style={{ opacity: 0.5, marginLeft: '8px' }}>{selectedLang.nativeName}</span>
                            )}
                        </>
                    ) : (
                        'Select language'
                    )}
                </span>
                <span style={{ fontSize: '12px', opacity: 0.5 }}>▼</span>
            </button>
            {isOpen && renderDropdown()}
        </div>
    );
};

export default LanguageSelector;
