/** Display-only abbreviation; the original text remains the view/copy payload. */
export function evidencePreview(value: string): string {
  return value.length > 20 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}

/** Decimal strings and bigint values never pass through floating point. */
export function exactEvidenceJson(value: unknown): string {
  return JSON.stringify(value, (_key, entry) => typeof entry === 'bigint' ? entry.toString() : entry, 2);
}

/** Short values need no empty scroll box; longer exact data remains bounded. */
export function evidenceTextRows(value: string): number {
  const lines = value.split('\n').reduce((count, line) => count + Math.max(1, Math.ceil(line.length / 32)), 0);
  return Math.max(2, Math.min(12, lines));
}
