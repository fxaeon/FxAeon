/** Select recorded observations only. Time spacing, not array spacing, drives inspection. */
export function chartObservationIndex(points: readonly { timestamp: number }[], time: number, mode: 'nearest' | 'step'): number | null {
  if (!points.length || !Number.isFinite(time)) return null;
  let low = 0, high = points.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (points[middle].timestamp <= time) low = middle + 1;
    else high = middle;
  }
  const before = Math.max(0, low - 1);
  if (mode === 'step' || low === points.length) return before;
  return time - points[before].timestamp <= points[low].timestamp - time ? before : low;
}

/** Use a different marker identity across missing history; never animate through a gap. */
export function chartObservationSegment(points: readonly { timestamp: number }[], index: number, maxGap: number): number {
  let segment = 0;
  for (let i = 1; i <= index; i++) if (points[i].timestamp - points[i - 1].timestamp > maxGap) segment++;
  return segment;
}
