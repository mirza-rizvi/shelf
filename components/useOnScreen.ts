import { useEffect, useRef, useState, type RefObject } from 'react';

/**
 * True while the observed element is within `rootMargin` of the viewport.
 *
 * The manager tab is pinned open for the entire browser session, so the cost
 * that matters is what stays MOUNTED, not what gets painted. `content-
 * visibility: auto` (manager.css) already skips layout/paint for offscreen
 * shelves; this hook lets them skip the DOM nodes and React instances too.
 *
 * Falls back to permanently-on when IntersectionObserver is unavailable
 * (jsdom under vitest), so tests see the full tree.
 */
export function useOnScreen<T extends Element>(rootMargin = '600px'): [RefObject<T>, boolean] {
  const ref = useRef<T>(null);
  const [onScreen, setOnScreen] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setOnScreen(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) setOnScreen(entry.isIntersecting);
      },
      { rootMargin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [rootMargin]);

  return [ref, onScreen];
}
