import { useEffect, type RefObject } from 'react';

const PHOTO_TARGETS = '.feature-visual,.home-expression-visual,.home-security-visual,.home-option-visual,.home-upright-example';

/** Observe the element itself, not a tall section that can arrive before its photo. */
export function watchScrollReveals(root: HTMLElement): () => void {
    if (typeof IntersectionObserver === 'undefined') return () => {};
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const workspace = root.matches('.workspace-shell');
    const targets = [...root.querySelectorAll<HTMLElement>(workspace ? 'h1,h2' : `main h1,main h2,main h3,main p,main .pricing-card,${PHOTO_TARGETS}`)].filter(node =>
        !node.closest('form,[role="status"],[role="alert"],.public-floating-nav') &&
        (!node.closest('.pricing-card') || node.matches('.pricing-card')) &&
        (!node.closest(PHOTO_TARGETS) || node.matches(PHOTO_TARGETS)) &&
        node.getBoundingClientRect().top >= window.innerHeight
    );
    let observer: IntersectionObserver | undefined;
    const clear = () => {
        observer?.disconnect();
        for (const node of targets) { node.classList.remove('public-scroll-arrived', 'public-scroll-photo'); node.style.removeProperty('--qsvc-reveal-delay'); }
    };
    const sync = () => {
        clear();
        if (reduced.matches) return;
        observer = new IntersectionObserver(entries => {
            let order = 0;
            for (const entry of entries) {
                const node = entry.target as HTMLElement;
                if (entry.isIntersecting && entry.intersectionRatio >= .12) {
                    node.style.setProperty('--qsvc-reveal-delay', `${Math.min(order++, 2) * 60}ms`);
                    if (node.matches(PHOTO_TARGETS)) node.classList.add('public-scroll-photo');
                    node.classList.add('public-scroll-arrived');
                } else if (!entry.isIntersecting && (entry.boundingClientRect.bottom <= 0 || entry.boundingClientRect.top >= window.innerHeight)) {
                    node.classList.remove('public-scroll-arrived');
                }
            }
        }, { rootMargin: '0px', threshold: [0, .12] });
        for (const node of targets) observer.observe(node);
    };
    sync();
    reduced.addEventListener('change', sync);
    return () => { clear(); reduced.removeEventListener('change', sync); };
}

export default function useScrollReveal(ref: RefObject<HTMLElement>, route = '') {
    useEffect(() => {
        const root = ref.current?.closest<HTMLElement>('.public-site,.workspace-shell');
        if (root) return watchScrollReveals(root);
    }, [ref, route]);
}
