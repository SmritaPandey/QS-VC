import { useEffect, useRef } from 'react';
import globePoster from '../styles/qsvc-hero-ambient-poster.webp';
type Dot = { x: number; y: number; color: [number, number, number] };

/** Sample the approved artwork itself, preserving the Q and gold ribbon. */
export default function DotGlobe() {
    const host = useRef<HTMLDivElement>(null);
    const canvas = useRef<HTMLCanvasElement>(null);
    useEffect(() => {
        const element = host.current, surface = canvas.current;
        const context = surface?.getContext('2d');
        if (!element || !surface || !context) return;
        const reduced = matchMedia('(prefers-reduced-motion: reduce)');
        const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
        const pointer = { x: -1000, y: -1000 };
        let camera: Dot[] = [], globe: Dot[] = [], frame = 0, disposed = false;
        const sample = (source: string, isGlobe: boolean) => new Promise<Dot[]>((resolve, reject) => {
            const image = new Image();
            image.onload = () => {
                const offscreen = document.createElement('canvas'); offscreen.width = 500; offscreen.height = 340;
                const ctx = offscreen.getContext('2d'); if (!ctx) { reject(); return; }
                const scale = Math.min(460 / image.naturalWidth, 300 / image.naturalHeight);
                const w = image.naturalWidth * scale, h = image.naturalHeight * scale;
                ctx.drawImage(image, (500 - w) / 2, (340 - h) / 2, w, h);
                try {
                    const pixels = ctx.getImageData(0, 0, 500, 340).data, dots: Dot[] = [];
                    for (let y = 4; y < 340; y += 5) for (let x = 4; x < 500; x += 5) {
                        const i = (y * 500 + x) * 4;
                        const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
                        if (pixels[i + 3] > 100 && (!isGlobe || Math.min(r, g, b) < 225)) dots.push({ x, y, color: [r, g, b] });
                    }
                    resolve(dots);
                } catch { reject(); }
            };
            image.onerror = reject; image.src = source;
        });
        const draw = () => {
            frame = 0;
            const rect = element.getBoundingClientRect(); if (rect.bottom < 0 || rect.top > innerHeight || !camera.length || !globe.length) return;
            const stage = element.closest<HTMLElement>('.cipher-hero'), stageRect = stage?.getBoundingClientRect();
            const raw = reduced.matches || saveData ? 0 : Math.max(0, Math.min(1, -(stageRect?.top || 0) / Math.max(1, (stage?.offsetHeight || 1) - innerHeight)));
            const t = raw * raw * (3 - 2 * raw);
            element.style.setProperty('--globe-reveal', String(Math.max(0, (raw - .88) / .12)));
            element.style.setProperty('--morph-progress', String(raw));
            const ratio = Math.min(devicePixelRatio || 1, 2), w = Math.round(rect.width * ratio), h = Math.round(rect.height * ratio);
            if (surface.width !== w || surface.height !== h) { surface.width = w; surface.height = h; }
            context.setTransform(w / 500, 0, 0, h / 340, 0, 0); context.clearRect(0, 0, 500, 340);
            camera.forEach((p, i) => {
                const q = globe[Math.floor(i / camera.length * globe.length)];
                let x = p.x + (q.x - p.x) * t, y = p.y + (q.y - p.y) * t;
                const dx = x - pointer.x, dy = y - pointer.y, d = Math.hypot(dx, dy);
                if (!reduced.matches && !saveData && d < 65 && d > 0) { const push = (1 - d / 65) * 12; x += dx / d * push; y += dy / d * push; }
                context.fillStyle = `rgb(${p.color.map((c, n) => Math.round(c + (q.color[n] - c) * t)).join(',')})`;
                context.beginPath(); context.arc(x, y, 1.8, 0, Math.PI * 2); context.fill();
            });
        };
        const schedule = () => { if (!frame && !document.hidden) frame = requestAnimationFrame(draw); };
        Promise.all([sample('/qsvc-brand-mark.svg', false), sample(globePoster, true)]).then(([a, b]) => { if (disposed || !a.length || !b.length) return; camera = a; globe = b; element.dataset.canvasReady = 'true'; schedule(); }).catch(() => {});
        if (saveData) element.closest('.cipher-hero')?.setAttribute('data-save-data', 'true');
        const move = (event: PointerEvent) => { if (event.pointerType === 'touch') return; const r = element.getBoundingClientRect(); pointer.x = (event.clientX - r.left) / r.width * 500; pointer.y = (event.clientY - r.top) / r.height * 340; schedule(); };
        const leave = () => { pointer.x = pointer.y = -1000; schedule(); };
        const resize = new ResizeObserver(schedule); resize.observe(element);
        addEventListener('scroll', schedule, { passive: true }); element.addEventListener('pointermove', move); element.addEventListener('pointerleave', leave); reduced.addEventListener('change', schedule); document.addEventListener('visibilitychange', schedule);
        return () => { disposed = true; cancelAnimationFrame(frame); resize.disconnect(); removeEventListener('scroll', schedule); element.removeEventListener('pointermove', move); element.removeEventListener('pointerleave', leave); reduced.removeEventListener('change', schedule); document.removeEventListener('visibilitychange', schedule); };
    }, []);
    return <div className="dot-globe" ref={host} aria-hidden="true"><img className="dot-camera-fallback" src="/qsvc-brand-mark.svg" alt="" /><canvas ref={canvas} /><img className="dot-globe-static-end" src={globePoster} alt="" /></div>;
}
