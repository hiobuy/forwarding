/** Per-isolate window. Enough to slow a public calculator without a new store. */
const hits = new Map<string, number[]>();

export function allowQuoteAttempt(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const recent = (hits.get(key) ?? []).filter((stamp) => now - stamp < windowMs);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  return true;
}
