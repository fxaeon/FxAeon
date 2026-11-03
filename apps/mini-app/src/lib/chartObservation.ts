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

/** Ordered funding rows can share a timestamp. Match the cost integrator:
 * the last row at that time is the held rate. Keep only the effective baseline
 * plus subsequent observations, so each keyboard stop has a unique identity. */
export function chartStepObservations<T extends { timestamp: number }>(points: readonly T[], start: number): T[] {
  const unique: T[] = [];
  for (const point of points) {
    if (unique.at(-1)?.timestamp === point.timestamp) unique[unique.length - 1] = point;
    else unique.push(point);
  }
  return unique.slice(chartObservationIndex(unique, start, 'step') ?? 0);
}

/** Use a different marker identity across missing history; never animate through a gap. */
export function chartObservationSegment(points: readonly { timestamp: number }[], index: number, maxGap: number): number {
  let segment = 0;
  for (let i = 1; i <= index; i++) if (points[i].timestamp - points[i - 1].timestamp > maxGap) segment++;
  return segment;
}
