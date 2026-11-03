import { useId } from 'react';
import '../styles/meeting-brand.css';

/** Vector recreation of the supplied circular Q/play mark. */
export default function BrandLogo({ meeting = false, iconOnly = false }: { meeting?: boolean; iconOnly?: boolean }) {
    const id = useId();
    return <span className={`qsvc-logo${meeting ? ' qsvc-logo--meeting' : ''}`}>
        <svg className="qsvc-logo-symbol" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
            <defs>
                <linearGradient id={`${id}-ring`} x1="12" y1="5" x2="52" y2="60" gradientUnits="userSpaceOnUse"><stop stopColor="#5141BE"/><stop offset="1" stopColor="#6323AA"/></linearGradient>
                <linearGradient id={`${id}-play`} x1="22" y1="32" x2="44" y2="32" gradientUnits="userSpaceOnUse"><stop stopColor="#20528A"/><stop offset=".55" stopColor="#079C9A"/><stop offset="1" stopColor="#20528A"/></linearGradient>
            </defs>
            <path className="qsvc-logo-ring" d="M47 50 A25 25 0 1 1 53 43" fill="none" stroke={`url(#${id}-ring)`} strokeWidth="6"/>
            <path className="qsvc-logo-play" d="M23 21 Q22 20 22 23 L22 42 Q22 44 24 43 L44 34 Q47 32.5 44 31 Z" fill={`url(#${id}-play)`}/>
            <path className="qsvc-logo-tail" d="M44 47 Q42 45 41 48 L49 61 Q50 63 52 61 L61 55 Q63 54 60 52 L46 46 Z" fill={`url(#${id}-ring)`} stroke="white" strokeWidth="1.5"/>
        </svg>
        <span className={iconOnly ? 'sr-only' : 'qsvc-logo-name'}>QS-VC</span>
    </span>;
}
