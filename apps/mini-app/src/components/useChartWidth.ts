import { useLayoutEffect, useState } from 'react';

/** Match SVG coordinates to CSS pixels so labels and markers keep their shape. */
export function useChartWidth() {
  const [element, ref] = useState<HTMLElement | null>(null);
  const [width, setWidth] = useState(480);
  useLayoutEffect(() => {
    if (!element) return;
    const measure = () => { const next = element.clientWidth; if (next > 0) setWidth(next); };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return { ref, element, width };
}
