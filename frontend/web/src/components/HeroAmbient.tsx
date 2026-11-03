import { useEffect, useRef, useState } from 'react';
import ambientMp4 from '../styles/qsvc-hero-ambient.mp4';
import ambientWebm from '../styles/qsvc-hero-ambient.webm';
import ambientPoster from '../styles/qsvc-hero-ambient-poster.webp';

/**
 * Decorative ambient background for the website hero: a slowly turning dotted globe
 * with meeting links between cities (20 s seamless loop, no audio).
 * Static poster on small screens, reduced motion, reduced data or Save-Data.
 */
export default function HeroAmbient() {
    const ref = useRef<HTMLVideoElement>(null);
    const [motion, setMotion] = useState(false);

    useEffect(() => {
        const query = window.matchMedia('(min-width: 768px) and (min-height: 521px) and (prefers-reduced-motion: no-preference)');
        const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
        const sync = () => setMotion(query.matches && !saveData);
        sync();
        query.addEventListener('change', sync);
        return () => query.removeEventListener('change', sync);
    }, []);

    useEffect(() => {
        const video = ref.current;
        if (!motion || !video) return;
        // Play only while the hero is on screen and the tab is visible.
        let visible = true;
        const apply = () => {
            if (!visible || document.hidden) video.pause();
            else video.play().catch(() => undefined);
        };
        const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; apply(); });
        observer.observe(video);
        document.addEventListener('visibilitychange', apply);
        apply();
        return () => { observer.disconnect(); document.removeEventListener('visibilitychange', apply); };
    }, [motion]);

    return <div className="home-hero-ambient" aria-hidden="true">
        {motion
            ? <video ref={ref} className="home-hero-ambient-media" muted loop playsInline preload="metadata" poster={ambientPoster} tabIndex={-1}>
                <source src={ambientWebm} type="video/webm" />
                <source src={ambientMp4} type="video/mp4" />
            </video>
            : <img className="home-hero-ambient-media" src={ambientPoster} alt="" />}
    </div>;
}
