'use client';

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { debtShare, leverageAtTrackPosition, leverageTrackPosition, leverageTicksOnTrack, splitPercents, stepLeverage, type LeverageSide } from '@/lib/leverageShare';
import { haptic } from '@/lib/telegram';
import styles from './LeverageSplit.module.css';

/**
 * Leverage as a split of collateral (see debtShare): the debt beside the
 * trader's share. Both directions show the same 2× and 3× rows, so comparing
 * them never changes the layout; the pool's live range is Trade's Leverage
 * stat. These are educational examples, not position valuations or SDK
 * inputs. The bars fill once on screen.
 */
const EXAMPLE_LEVERAGES = [2, 3] as const;

export function LeverageSplit({ side }: { side: LeverageSide }) {
  const ref = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    if (typeof IntersectionObserver === 'undefined') { node.toggleAttribute('data-shown', true); return undefined; }
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      node.toggleAttribute('data-shown', true);
      observer.disconnect();
    }, { threshold: 0.3 });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return <ol ref={ref} className={styles.rows} aria-label="Debt and equity share of a position by leverage, before fees">
    {EXAMPLE_LEVERAGES.map((leverage) => {
      const { debt, yours } = splitPercents(side, leverage);
      return <li key={leverage} className={styles.row} style={{ '--borrowed': debtShare(side, leverage) } as CSSProperties}>
        <span className={styles.leverage}>{leverage}×</span>
        <span className={styles.bar} aria-hidden="true"><i className={styles.borrowed} /><i className={styles.share} /></span>
        <span className={styles.figures}><b>{debt}%</b> debt · <b>{yours}%</b> equity</span>
      </li>;
    })}
  </ol>;
}

/** A press this close to the thumb holds it where it is instead of jumping it. */
const THUMB_GRAB_SLOP_PX = 6;
/** A touch becomes a drag once it travels this far along the track; until then it may still be a scroll or a tap. */
const TOUCH_DRAG_SLOP_PX = 4;
/** A touch that ends within this distance of where it began is a tap. */
const TAP_SLOP_PX = 10;
/** The release tick is skipped right after a whole-leverage tick, so a drag never clicks twice. */
const DETENT_QUIET_MS = 120;

type SliderGesture = {
  pointerId: number;
  touch: boolean;
  startX: number;
  startY: number;
  /** Offset from the thumb's centre when the press began on it; null makes the thumb jump to the pointer. */
  grab: number | null;
  dragging: boolean;
  lastDetentAt: number;
};

/** Moving from `from` to `to` lands on or passes a whole leverage: the drag's detents. */
function crossesWholeLeverage(from: number, to: number): boolean {
  return to > from ? Math.floor(to) > Math.floor(from) : to < from && Math.ceil(to) < Math.ceil(from);
}

/** The full track spans the live leverage minimum and maximum linearly.
 * The native input, pointer, thumb and ticks share that leverage scale.
 * The debt/equity explanation stays in the expanded details below the ticket.
 * Touch gestures preserve vertical scrolling; keys use leverage units. */
export function LeverageSplitRange({ id, label, side, value, min, max, onChange }: {
  id: string;
  label: string;
  side: LeverageSide;
  /** The leverage the slider shows, already inside [min, max]. */
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  const sliderRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLSpanElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const gestureRef = useRef<SliderGesture | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;
  const [dragging, setDragging] = useState(false);
  // Tick spacing and the thumb's clearance are in pixels, so the drawn track
  // is measured (layout sizes, unaffected by any press transform). Until it
  // is, no ticks are drawn.
  const [track, setTrack] = useState<{ width: number; thumbRadius: number } | null>(null);
  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return undefined;
    const measure = () => {
      const width = bar.offsetWidth;
      const thumbRadius = (thumbRef.current?.offsetWidth ?? 0) / 2;
      setTrack((current) => current?.width === width && current.thumbRadius === thumbRadius ? current : { width, thumbRadius });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(bar);
    return () => observer.disconnect();
  }, []);
  const ticks = track ? leverageTicksOnTrack(min, max, value, track.width, track.thumbRadius) : [];
  const { debt } = splitPercents(side, value);
  const shares = {
    '--share': leverageTrackPosition(value, min, max),
  } as CSSProperties;

  const choose = (clientX: number, grab: number) => {
    const bar = barRef.current?.getBoundingClientRect();
    if (!bar || bar.width <= 0) return;
    const previous = valueRef.current;
    const next = leverageAtTrackPosition((clientX - grab - bar.left) / bar.width, min, max);
    if (next === previous) return;
    valueRef.current = next;
    onChange(next);
    const gesture = gestureRef.current;
    if (gesture && crossesWholeLeverage(previous, next)) {
      haptic('selection');
      gesture.lastDetentAt = performance.now();
    }
  };
  // Like a native slider, a press focuses it (closing the amount keyboard).
  // Focus moved by script after typing would still match :focus-visible, so
  // the keyboard ring waits for an actual key.
  const focusFromPointer = () => {
    sliderRef.current?.setAttribute('data-pointer-focus', '');
    if (document.activeElement !== inputRef.current) inputRef.current?.focus({ preventScroll: true });
  };
  const beginDrag = (gesture: SliderGesture) => {
    gesture.dragging = true;
    setDragging(true);
    focusFromPointer();
  };
  const endGesture = () => {
    gestureRef.current = null;
    setDragging(false);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
    const bar = barRef.current?.getBoundingClientRect();
    if (!bar || bar.width <= 0) return;
    const thumbX = bar.left + leverageTrackPosition(valueRef.current, min, max) * bar.width;
    const thumbRadius = (thumbRef.current?.getBoundingClientRect().width ?? 0) / 2;
    const gesture: SliderGesture = {
      pointerId: event.pointerId,
      touch: event.pointerType === 'touch',
      startX: event.clientX,
      startY: event.clientY,
      grab: Math.abs(event.clientX - thumbX) <= thumbRadius + THUMB_GRAB_SLOP_PX ? event.clientX - thumbX : null,
      dragging: false,
      lastDetentAt: 0,
    };
    gestureRef.current = gesture;
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* The pointer has already gone. */ }
    if (gesture.touch) return;
    // A mouse or pen press is already a decision: hold the thumb, or jump it here.
    event.preventDefault();
    beginDrag(gesture);
    choose(event.clientX, gesture.grab ?? 0);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (!gesture.dragging) {
      const travel = event.clientX - gesture.startX;
      if (Math.abs(travel) < TOUCH_DRAG_SLOP_PX || Math.abs(travel) <= Math.abs(event.clientY - gesture.startY)) return;
      beginDrag(gesture);
    }
    choose(event.clientX, gesture.grab ?? 0);
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const tapped = !gesture.dragging
      && Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) < TAP_SLOP_PX;
    // A tap on the track moves the thumb there, as on a native slider; a tap on the thumb leaves it.
    if (tapped && gesture.grab === null) {
      focusFromPointer();
      choose(event.clientX, 0);
    }
    if ((gesture.dragging || tapped) && performance.now() - gesture.lastDetentAt > DETENT_QUIET_MS) haptic('selection');
    endGesture();
  };

  return <>
    <div
      ref={sliderRef}
      className={styles.slider}
      data-dragging={dragging || undefined}
      style={shares}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      // A page scroll took the touch, or the press was interrupted: nothing changes.
      onPointerCancel={endGesture}
      onLostPointerCapture={(event) => { if (gestureRef.current?.pointerId === event.pointerId) endGesture(); }}
    >
      <div ref={barRef} className={styles.sliderBar} aria-hidden="true">
        <i className={styles.sliderSelected} /><i className={styles.sliderRemaining} />
      </div>
      <div className={styles.sliderTicks} aria-hidden="true">
        {ticks.map((tick) => <i key={tick.leverage} className={styles.sliderTick} data-near-thumb={tick.nearThumb || undefined} style={{ '--at': tick.share } as CSSProperties} />)}
      </div>
      <input
        ref={inputRef}
        id={id}
        type="range"
        className={styles.sliderInput}
        min={min}
        max={max}
        step="0.1"
        value={value}
        aria-label={label}
        aria-valuetext={`${value.toFixed(1)}×, ${debt}% debt, ${100 - debt}% equity`}
        onChange={(event) => onChange(Number(event.target.value))}
        onBlur={() => sliderRef.current?.removeAttribute('data-pointer-focus')}
        onKeyDown={(event) => {
          sliderRef.current?.removeAttribute('data-pointer-focus');
          if (event.key !== 'PageUp' && event.key !== 'PageDown') return;
          event.preventDefault();
          const next = stepLeverage(valueRef.current, event.key === 'PageUp' ? 1 : -1, min, max);
          if (next !== valueRef.current) onChange(next);
        }}
      />
      <span ref={thumbRef} className={styles.sliderThumb} aria-hidden="true" />
    </div>
    {/* Keep the verified live limits visible at the ends of the scale. */}
    <div className={styles.bounds} data-leverage-bounds>
      <span aria-hidden="true">{min.toFixed(1)}×</span>
      <span aria-hidden="true">{max.toFixed(1)}×</span>
    </div>
  </>;
}
