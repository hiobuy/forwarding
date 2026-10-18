/** Public business numbers. Internal ids and HioBuy remote ids are separate. */

export const NUMBER_KINDS = ["member", "package", "shipment"] as const;
export type NumberKind = (typeof NUMBER_KINDS)[number];

export type NumberRule = { prefix: string; length: number; nextValue: number };

/** Matches the numbers the app already issued before numbering was configurable. */
export const DEFAULT_NUMBER_RULES: Record<NumberKind, NumberRule> = {
  member: { prefix: "HX", length: 5, nextValue: 10238 },
  package: { prefix: "PKG-", length: 5, nextValue: 10001 },
  shipment: { prefix: "SHP-", length: 5, nextValue: 20001 },
};

export function isNumberKind(value: string): value is NumberKind {
  return (NUMBER_KINDS as readonly string[]).includes(value);
}

export function normalizeNumberPrefix(prefix: string) {
  return prefix.toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 8);
}

export function numberRuleProblem(input: { prefix: string; length: number; start: number }): string | null {
  if (input.prefix !== normalizeNumberPrefix(input.prefix)) return "Prefix can use letters, numbers, and hyphens.";
  if (input.prefix.length > 8) return "Prefix must be 8 characters or fewer.";
  if (!Number.isInteger(input.length) || input.length < 4 || input.length > 10) return "Number length must be from 4 to 10.";
  if (!Number.isInteger(input.start) || input.start < 1) return "Starting number must be at least 1.";
  if (String(input.start).length > input.length) return "Starting number does not fit the digit length.";
  return null;
}

export function formatPublicNumber(prefix: string, value: number, length: number) {
  return `${prefix}${String(value).padStart(length, "0")}`;
}

export function sequenceFromPublicId(publicId: string, prefix: string): number | null {
  if (prefix && !publicId.startsWith(prefix)) return null;
  const rest = publicId.slice(prefix.length);
  if (!/^\d+$/.test(rest) || rest.length > 12) return null;
  const value = Number(rest);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/**
 * The next issued number is the later of the requested start, the counter already stored
 * for this prefix, and one past every matching number already on file.
 */
export function safeNextValue(input: { requestedStart: number; currentNext: number; prefixChanged: boolean; used: number[] }) {
  const highest = input.used.reduce((max, value) => Math.max(max, value), 0);
  const floor = input.prefixChanged ? input.requestedStart : Math.max(input.requestedStart, input.currentNext);
  const next = Math.max(floor, highest + 1);
  return { next, adjusted: next !== input.requestedStart };
}
