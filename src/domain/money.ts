/** USD amounts are integer cents. $180.00 is stored as 18000. */

export function formatFen(fen: number): string {
  const negative = fen < 0;
  const abs = Math.abs(fen);
  const yuan = Math.trunc(abs / 100);
  const cents = abs % 100;
  const grouped = yuan.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}$${grouped}.${cents.toString().padStart(2, "0")}`;
}

export function formatFenRange(minFen: number, maxFen: number): string {
  if (minFen === maxFen) return formatFen(minFen);
  const maxYuan = Math.trunc(Math.abs(maxFen) / 100);
  const maxCents = Math.abs(maxFen) % 100;
  const maxPart =
    maxCents === 0 ? String(maxYuan) : `${maxYuan}.${maxCents.toString().padStart(2, "0")}`;
  return `${formatFen(minFen)}–$${maxPart}`;
}

export function formatSignedFen(fen: number): string {
  if (fen > 0) return `+${formatFen(fen)}`;
  return formatFen(fen);
}

export function percentOf(amountFen: number, percent: number): number {
  return Math.floor((amountFen * percent) / 100);
}
