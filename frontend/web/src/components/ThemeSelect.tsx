import { useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react';

type Preference = 'system' | 'light' | 'dark';
declare global {
    interface Window {
        qsvcTheme: {
            getPreference: () => Preference;
            setPreference: (preference: Preference) => void;
            subscribe: (listener: () => void) => () => void;
        };
    }
}

const OPTIONS: { value: Preference; label: string; icon: string }[] = [
    { value: 'system', label: 'System', icon: 'computer' },
    { value: 'light', label: 'Light', icon: 'light_mode' },
    { value: 'dark', label: 'Dark', icon: 'dark_mode' },
];

/** Where the spare options land when the switch disperses: an arc below the trigger, bent away from a screen edge. */
const SPREADS = {
    center: [{ x: -34, y: 52 }, { x: 34, y: 52 }],
    left: [{ x: -58, y: 20 }, { x: -24, y: 58 }],
    right: [{ x: 24, y: 58 }, { x: 58, y: 20 }],
};
type Spread = keyof typeof SPREADS;

/** Icon-only appearance switch: the current choice is the trigger; the other two disperse out of it as separate buttons. */
export default function ThemeSelect() {
    const menuId = useId();
    const theme = window.qsvcTheme;
    const preference = useSyncExternalStore(theme.subscribe, theme.getPreference);
    const [open, setOpen] = useState(false);
    const [closing, setClosing] = useState(false);
    const [spread, setSpread] = useState<Spread>('center');
    const wasOpen = useRef(false);
    // Keep the options mounted for a moment after closing so they can gather back into the trigger.
    useEffect(() => {
        if (open) { wasOpen.current = true; setClosing(false); return; }
        if (!wasOpen.current) return;
        wasOpen.current = false;
        setClosing(true);
        const timer = window.setTimeout(() => setClosing(false), 260);
        return () => window.clearTimeout(timer);
    }, [open]);
    const rootRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const current = OPTIONS.find(option => option.value === preference) ?? OPTIONS[0];
    const others = OPTIONS.filter(option => option.value !== current.value);

    useEffect(() => {
        if (!open) return;
        const closeOutside = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
        document.addEventListener('pointerdown', closeOutside);
        rootRef.current?.querySelector<HTMLButtonElement>('.theme-select-option')?.focus();
        return () => document.removeEventListener('pointerdown', closeOutside);
    }, [open]);

    const choose = (value: Preference) => { theme.setPreference(value); setOpen(false); triggerRef.current?.focus(); };
    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'Escape' && open) { event.stopPropagation(); setOpen(false); triggerRef.current?.focus(); return; }
        if (!open || !['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        const items = [...(rootRef.current?.querySelectorAll<HTMLButtonElement>('.theme-select-option') ?? [])];
        if (!items.length) return;
        event.preventDefault();
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        const step = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1;
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + step + items.length) % items.length;
        items[next].focus();
    };

    return <div ref={rootRef} className="theme-select" data-open={open} data-closing={closing || undefined} onKeyDown={onKeyDown}>
        <button ref={triggerRef} type="button" className="theme-select-trigger" aria-label={`Appearance: ${current.label}`} aria-haspopup="menu" aria-expanded={open} aria-controls={menuId} title={`Appearance: ${current.label}`} onClick={() => {
            if (!open) {
                // Keep both options on screen: near the right edge fan out to the left, near the left edge to the right.
                const box = triggerRef.current?.getBoundingClientRect();
                const width = document.documentElement.clientWidth;
                setSpread(!box ? 'center' : box.right + 64 > width ? 'left' : box.left - 64 < 0 ? 'right' : 'center');
            }
            setOpen(value => !value);
        }}>
            <span key={open ? 'close' : current.value} className="mi theme-select-icon" aria-hidden="true">{open ? 'close' : current.icon}</span>
        </button>
        <div id={menuId} className="theme-select-menu" role="menu" aria-label="Appearance" hidden={!open && !closing}>
            {others.map((option, index) => <button key={option.value} type="button" role="menuitemradio" aria-checked="false" className="theme-select-option" tabIndex={open ? 0 : -1} style={{ ['--i' as string]: index, ['--x' as string]: `${SPREADS[spread][index].x}px`, ['--y' as string]: `${SPREADS[spread][index].y}px` }} aria-label={option.label} data-tip={option.label} onClick={() => choose(option.value)}>
                <span className="mi" aria-hidden="true">{option.icon}</span>
            </button>)}
        </div>
    </div>;
}
