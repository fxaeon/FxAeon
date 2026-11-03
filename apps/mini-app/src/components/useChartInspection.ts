'use client';

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { chartObservationIndex } from '@/lib/chartObservation';

type Gesture = { id: number; node: SVGSVGElement };
/** Exact observation state; visual motion belongs to ChartIndicator, never to the values. */
export function useChartInspection({ points, start, end, width, scope, mode }: {
  points: readonly { timestamp: number }[]; start: number; end: number; width: number;
  scope: string; mode: 'nearest' | 'step';
}) {
  const [selection, setSelection] = useState<{ scope: string; timestamp: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const gesture = useRef<Gesture | null>(null);
  const selectedIndex = selection?.scope === scope ? points.findIndex(point => point.timestamp === selection.timestamp) : -1;
  const index = selectedIndex >= 0 ? selectedIndex : null;
  const release = useCallback(() => {
    const held = gesture.current;
    gesture.current = null;
    if (held?.node.hasPointerCapture(held.id)) held.node.releasePointerCapture(held.id);
  }, []);
  useEffect(() => {
    setSelection(null);
    setDragging(false);
    return release;
  }, [scope, release]);
  const select = (next: number) => {
    const point = points[next];
    if (point) setSelection(value => value?.scope === scope && value.timestamp === point.timestamp ? value : { scope, timestamp: point.timestamp });
  };
  const reset = () => { release(); setDragging(false); setSelection(null); };
  const inspect = (event: PointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (!bounds.width) return;
    const x = (event.clientX - bounds.left) * width / bounds.width;
    const time = start + Math.min(1, Math.max(0, (x - 8) / Math.max(1, width - 16))) * (end - start);
    const next = chartObservationIndex(points, time, mode);
    if (next !== null) select(next);
  };
  const onPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (event.isPrimary === false || event.button !== 0 || gesture.current) return;
    gesture.current = { id: event.pointerId, node: event.currentTarget };
    setDragging(true);
    inspect(event);
    // Do not preventDefault: pan-y lets the browser take over a vertical gesture.
    // Synthetic events in accessibility/testing tools may have no active pointer.
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* no active pointer */ }
  };
  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    if (gesture.current ? event.pointerId === gesture.current.id : event.pointerType === 'mouse') inspect(event);
  };
  const onPointerUp = (event: PointerEvent<SVGSVGElement>) => {
    if (gesture.current?.id !== event.pointerId) return;
    inspect(event);
    release(); setDragging(false);
    // Touch/pen selection remains available after lifting the finger.
    const bounds = event.currentTarget.getBoundingClientRect();
    if (event.pointerType === 'mouse' && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) setSelection(null);
  };
  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); reset(); return; }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key) || !points.length) return;
    event.preventDefault(); release(); setDragging(false);
    select(event.key === 'Home' ? 0 : event.key === 'End' ? points.length - 1
      : Math.max(0, Math.min(points.length - 1, (index ?? points.length - 1) + (event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 1))));
  };
  return { index, dragging, reset, handlers: {
    onPointerDown, onPointerMove, onPointerUp, onKeyDown,
    onPointerCancel: reset,
    onLostPointerCapture: () => { if (gesture.current) { gesture.current = null; setDragging(false); } },
    onPointerLeave: (event: PointerEvent<SVGSVGElement>) => { if (event.pointerType === 'mouse' && !gesture.current) setSelection(null); },
    onFocus: () => { if (index === null) select(points.length - 1); },
    onBlur: reset,
  } };
}
