import { useEffect, useState } from 'react';
import '../styles/animated-number.css';

type AnimatedNumberProps = {
    value: number;
    className?: string;
    locale?: string;
};

/** Animates changing totals while keeping the final value stable for assistive technology. */
export default function AnimatedNumber({ value, className, locale }: AnimatedNumberProps) {
    const [display, setDisplay] = useState(0);
    const classes = ['animated-number', className].filter(Boolean).join(' ');
    const format = (number: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(number);

    useEffect(() => {
        const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
        if (motion?.matches || !Number.isFinite(value)) { setDisplay(value); return; }

        let frame = 0;
        const startValue = display;
        const startedAt = performance.now();
        const tick = (now: number) => {
            const progress = Math.min((now - startedAt) / 520, 1);
            const eased = 1 - (1 - progress) ** 3;
            setDisplay(Math.round(startValue + (value - startValue) * eased));
            if (progress < 1) frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        const finish = () => { cancelAnimationFrame(frame); setDisplay(value); };
        motion?.addEventListener('change', finish);
        return () => {
            cancelAnimationFrame(frame);
            motion?.removeEventListener('change', finish);
        };
        // Start the animation only when its target changes, not on each animation frame.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value]);

    return <span className={classes}>
        <span className="animated-number-sr">{format(value)}</span>
        <span aria-hidden="true">{format(display)}</span>
    </span>;
}
