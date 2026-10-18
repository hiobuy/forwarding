export const MAX_TRACKING_BATCH = 20;
export const MAX_PREALERT_BATCH = 30;

export type NormalizedTrackingInput = {
  numbers: string[];
  invalid: string[];
  overflow: boolean;
};

export function normalizeTrackingInput(raw: string, max = MAX_TRACKING_BATCH): NormalizedTrackingInput {
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
  const seen = new Set<string>();
  const numbers: string[] = [];
  const invalid: string[] = [];
  for (const line of lines) {
    if (!/^[A-Za-z0-9-]{5,40}$/.test(line)) {
      invalid.push(line);
      continue;
    }
    const key = line.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    numbers.push(key);
  }
  return {
    numbers,
    invalid,
    overflow: numbers.length > max,
  };
}
