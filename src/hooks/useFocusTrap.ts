import { useEffect, useRef } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useFocusTrap<T extends HTMLElement>(active: boolean) {
  const containerRef = useRef<T | null>(null);

  useEffect(() => {
    if (!active) return undefined;
    const container = containerRef.current;
    if (!container) return undefined;
    const previousActive = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const initial = container.querySelector<HTMLElement>(FOCUSABLE);
    initial?.focus();

    function handleKey(event: KeyboardEvent) {
      if (event.key !== 'Tab') return;
      const items = Array.from(container!.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const focused = document.activeElement;
      if (event.shiftKey && focused === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && focused === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
      if (previousActive && document.contains(previousActive)) previousActive.focus();
    };
  }, [active]);

  return containerRef;
}
