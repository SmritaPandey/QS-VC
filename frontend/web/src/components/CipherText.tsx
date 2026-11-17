import { useEffect, useRef, useState } from 'react';

export default function CipherText({ text }: { text: string }) {
    const [display, setDisplay] = useState(text);
    const host = useRef<HTMLSpanElement>(null);
    useEffect(() => {
        const reduced = matchMedia('(prefers-reduced-motion: reduce)');
        let timer: ReturnType<typeof setTimeout> | undefined;
        let visible = true;
        const letters = [...text];
        const glyphs = '01<>/{}[]';
        const stop = () => { clearTimeout(timer); setDisplay(text); };
        const cycle = () => {
            let step = 0;
            const tick = () => {
                if (document.hidden || !visible || reduced.matches) { stop(); return; }
                step += 1;
                setDisplay(letters.map((char, i) => char === ' ' || i < step * 2 ? char : glyphs[(i + step) % glyphs.length]).join(''));
                timer = setTimeout(step * 2 >= letters.length ? cycle : tick, step * 2 >= letters.length ? 2200 : 55);
            };
            tick();
        };
        const sync = () => {
            stop();
            if (!document.hidden && visible && !reduced.matches) timer = setTimeout(cycle, 500);
        };
        const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync(); });
        if (host.current) observer.observe(host.current);
        reduced.addEventListener('change', sync);
        document.addEventListener('visibilitychange', sync);
        sync();
        return () => { clearTimeout(timer); observer.disconnect(); reduced.removeEventListener('change', sync); document.removeEventListener('visibilitychange', sync); };
    }, [text]);
    return <span ref={host} aria-label={text} className="hero-cipher"><span className="hero-cipher-measure" aria-hidden="true">{text}</span><span className="hero-cipher-display" aria-hidden="true">{display}</span></span>;
}
