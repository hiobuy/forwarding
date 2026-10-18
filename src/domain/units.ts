export function formatKg(grams: number): string {
  const negative = grams < 0;
  const abs = Math.abs(grams);
  const whole = Math.trunc(abs / 1000);
  const frac = Math.trunc((abs % 1000) / 10);
  return `${negative ? "-" : ""}${whole}.${frac.toString().padStart(2, "0")} kg`;
}

export function formatDimensions(lengthMm: number, widthMm: number, heightMm: number): string {
  return `${formatCm(lengthMm)} × ${formatCm(widthMm)} × ${formatCm(heightMm)} cm`;
}

export function formatCm(mm: number): string {
  const negative = mm < 0;
  const abs = Math.abs(mm);
  const whole = Math.trunc(abs / 10);
  const tenth = abs % 10;
  const body = tenth === 0 ? String(whole) : `${whole}.${tenth}`;
  return negative ? `-${body}` : body;
}

/** Volumetric weight in grams. (cm³ / 5000) × 1000 = mm³ / 5000. */
export function volumetricGrams(lengthMm: number, widthMm: number, heightMm: number): number {
  return Math.round((lengthMm * widthMm * heightMm) / 5000);
}

export function kgToGrams(kg: number): number {
  if (!Number.isFinite(kg) || kg <= 0) return 0;
  return Math.round(kg * 1000);
}

export function cmToMm(cm: number): number {
  if (!Number.isFinite(cm) || cm <= 0) return 0;
  return Math.round(cm * 10);
}
