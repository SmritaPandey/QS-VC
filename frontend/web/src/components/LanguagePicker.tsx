import { useEffect, useMemo, useRef, useState } from 'react';
import { LANGUAGES } from '../lib/realtime-translation';
import { detectLanguage, findLanguage, type MeetingLanguage } from '../lib/meeting-language';
import { haptic } from '../lib/haptics';

interface Props {
    open: boolean;
    value: MeetingLanguage;
    onChange: (code: string) => void;
    onUseDetected: () => void;
    onClose: () => void;
}

const SOURCE_NOTE: Record<MeetingLanguage['source'], string> = {
    saved: 'Your saved choice on this device',
    location: 'Set from your location',
    browser: 'Set from your browser language',
    default: 'Default language',
};

/** In-meeting control: the language you speak, for multilingual voice-to-text. */
export default function LanguagePicker({ open, value, onChange, onUseDetected, onClose }: Props) {
    const [query, setQuery] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);
    const detected = useMemo(() => detectLanguage(), []);
    const current = findLanguage(value.code);

    const closeRef = useRef(onClose);
    closeRef.current = onClose;
    useEffect(() => {
        if (!open) return;
        setQuery('');
        inputRef.current?.focus();
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current(); };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [open]);

    const results = useMemo(() => {
        const q = query.trim().toLowerCase();
        const list = q
            ? LANGUAGES.filter(l => l.name.toLowerCase().includes(q) || l.nativeName.toLowerCase().includes(q) || l.code.toLowerCase().includes(q))
            : LANGUAGES;
        // Voice-to-text capable languages first, current choice on top.
        return [...list].sort((a, b) =>
            Number(b.code === value.code) - Number(a.code === value.code) ||
            Number(b.sttSupported) - Number(a.sttSupported));
    }, [query, value.code]);

    if (!open) return null;

    return (
        <div className="language-picker" id="language-picker" role="dialog" aria-label="Speaking language">
            <div className="language-picker-head">
                <div>
                    <h3>I speak</h3>
                    <p>{current ? `${current.name} · ${SOURCE_NOTE[value.source]}` : SOURCE_NOTE[value.source]}</p>
                </div>
                <button type="button" className="neu-icon-btn" aria-label="Close language" onClick={() => { haptic('tap'); onClose(); }}>
                    <span className="mi mi-sm" aria-hidden="true">close</span>
                </button>
            </div>
            <label className="language-search">
                <span className="mi mi-sm" aria-hidden="true">search</span>
                <input ref={inputRef} type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search languages" aria-label="Search languages" />
            </label>
            {detected.code !== value.code && findLanguage(detected.code) && (
                <button type="button" className="language-detected" onClick={() => { haptic('toggleOn'); onUseDetected(); }}>
                    <span className="mi mi-sm" aria-hidden="true">my_location</span>
                    Use {findLanguage(detected.code)!.name} ({detected.source === 'location' ? 'your location' : 'your browser'})
                </button>
            )}
            <div className="language-list" role="listbox" aria-label="Languages">
                {results.map(lang => {
                    const selected = lang.code === value.code;
                    return (
                        <button
                            type="button"
                            role="option"
                            aria-selected={selected}
                            key={lang.code}
                            className={`language-option ${selected ? 'is-selected' : ''}`}
                            onClick={() => { haptic('success'); onChange(lang.code); }}
                        >
                            <span className="language-native" lang={lang.code}>{lang.nativeName}</span>
                            <span className="language-name">{lang.name}</span>
                            {!lang.sttSupported && <span className="language-tag">No voice-to-text</span>}
                            {selected && <span className="mi mi-sm" aria-hidden="true">check</span>}
                        </button>
                    );
                })}
                {!results.length && <p className="language-empty">No language matches “{query}”.</p>}
            </div>
        </div>
    );
}
