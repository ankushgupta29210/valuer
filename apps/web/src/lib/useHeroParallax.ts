import { useEffect, useRef } from 'react';

/**
 * Drives the --hero-* custom properties from pointer position, which the
 * .hero-* utilities in index.css read. Mirrors the parallax on
 * valeurcredit.com: a small translate plus a gentle 3D tilt, both eased.
 *
 * Skipped entirely for coarse pointers and reduced-motion users; the
 * utilities fall back to their untransformed state.
 */
export function useHeroParallax<T extends HTMLElement>(strength = 18) {
  const ref = useRef<T>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (!window.matchMedia('(pointer: fine)').matches) return;

    let frame = 0;
    const onMove = (e: PointerEvent) => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const r = el.getBoundingClientRect();
        // -0.5 … 0.5 relative to the element's centre.
        const dx = (e.clientX - r.left) / r.width - 0.5;
        const dy = (e.clientY - r.top) / r.height - 0.5;
        el.style.setProperty('--hero-x', `${dx * strength}px`);
        el.style.setProperty('--hero-y', `${dy * strength}px`);
        el.style.setProperty('--hero-tilt-x', `${-dy * 4}deg`);
        el.style.setProperty('--hero-tilt-y', `${dx * 4}deg`);
      });
    };
    const reset = () => {
      el.style.setProperty('--hero-x', '0px');
      el.style.setProperty('--hero-y', '0px');
      el.style.setProperty('--hero-tilt-x', '0deg');
      el.style.setProperty('--hero-tilt-y', '0deg');
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    el.addEventListener('pointerleave', reset);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', reset);
    };
  }, [strength]);

  return ref;
}
