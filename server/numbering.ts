import { eq, sql } from "drizzle-orm";
import {
  DEFAULT_NUMBER_RULES,
  NUMBER_KINDS,
  formatPublicNumber,
  isNumberKind,
  normalizeNumberPrefix,
  numberRuleProblem,
  safeNextValue,
  sequenceFromPublicId,
  type NumberKind,
} from "../src/domain/numbering";
import type { Database } from "./db/client";
import { numberSequences, packages, shipments, user } from "./db/schema";
import { AppError } from "./errors";

export async function listNumberRules(db: Database) {
  await ensureSequences(db);
  const rows = await db.select().from(numberSequences);
  const saved = new Map(rows.map((row) => [row.kind, row]));
  return NUMBER_KINDS.map((kind) => {
    const fallback = DEFAULT_NUMBER_RULES[kind];
    const row = saved.get(kind);
    const rule = { prefix: row?.prefix ?? fallback.prefix, length: row?.padLength ?? fallback.length, nextValue: row?.nextValue ?? fallback.nextValue };
    return { kind, ...rule, preview: formatPublicNumber(rule.prefix, rule.nextValue, rule.length) };
  });
}

export async function saveNumberRules(db: Database, input: Record<NumberKind, { prefix: string; length: number; start: number }>) {
  await ensureSequences(db);
  const current = new Map((await db.select().from(numberSequences)).map((row) => [row.kind, row]));
  const adjusted: NumberKind[] = [];
  for (const kind of NUMBER_KINDS) {
    const prefix = normalizeNumberPrefix(input[kind].prefix);
    const length = input[kind].length;
    const start = input[kind].start;
    const problem = numberRuleProblem({ prefix, length, start });
    if (problem) throw new AppError("VALIDATION_ERROR", problem);
    const row = current.get(kind);
    const prefixChanged = row ? row.prefix !== prefix : false;
    const used = await usedSequences(db, kind, prefix);
    const decision = safeNextValue({
      requestedStart: start,
      currentNext: prefixChanged ? start : (row?.nextValue ?? start),
      prefixChanged,
      used,
    });
    if (decision.adjusted) adjusted.push(kind);
    await db.update(numberSequences).set({ prefix, padLength: length, nextValue: decision.next }).where(eq(numberSequences.kind, kind));
  }
  return { rules: await listNumberRules(db), adjusted };
}

export async function allocateNumber(db: Database, kind: NumberKind): Promise<string> {
  await ensureSequences(db);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const rows = await db
      .update(numberSequences)
      .set({ nextValue: sql`${numberSequences.nextValue} + 1` })
      .where(eq(numberSequences.kind, kind))
      .returning({ nextValue: numberSequences.nextValue, prefix: numberSequences.prefix, padLength: numberSequences.padLength });
    const row = rows[0];
    if (!row) throw new AppError("INTERNAL", "Numbering is not ready.", 500);
    const issued = row.nextValue - 1;
    if (issued < 1 || String(issued).length > row.padLength) throw new AppError("INVALID_STATE", "This numbering rule has no unused numbers left.", 409);
    const publicId = formatPublicNumber(row.prefix, issued, row.padLength);
    if (!(await numberTaken(db, kind, publicId))) return publicId;
  }
  throw new AppError("INVALID_STATE", "Could not allocate a unique number.", 409);
}

async function ensureSequences(db: Database) {
  const existing = new Set((await db.select({ kind: numberSequences.kind }).from(numberSequences)).map((row) => row.kind));
  for (const kind of NUMBER_KINDS) {
    if (existing.has(kind)) continue;
    const rule = DEFAULT_NUMBER_RULES[kind];
    const used = await usedSequences(db, kind, rule.prefix);
    const next = safeNextValue({ requestedStart: rule.nextValue, currentNext: rule.nextValue, prefixChanged: false, used }).next;
    try {
      await db.insert(numberSequences).values({ kind, prefix: rule.prefix, padLength: rule.length, nextValue: next });
    } catch (error) {
      if (!String(error).toLowerCase().includes("unique")) throw error;
    }
  }
}

async function usedSequences(db: Database, kind: NumberKind, prefix: string) {
  const values =
    kind === "member"
      ? (await db.select({ id: user.memberCode }).from(user)).map((row) => row.id)
      : kind === "package"
        ? (await db.select({ id: packages.publicId }).from(packages)).map((row) => row.id)
        : (await db.select({ id: shipments.publicId }).from(shipments)).map((row) => row.id);
  return values.map((value) => sequenceFromPublicId(value, prefix)).filter((value): value is number => value != null);
}

async function numberTaken(db: Database, kind: NumberKind, publicId: string) {
  if (kind === "member") return Boolean((await db.select({ id: user.id }).from(user).where(eq(user.memberCode, publicId)).limit(1))[0]);
  if (kind === "package") return Boolean((await db.select({ id: packages.id }).from(packages).where(eq(packages.publicId, publicId)).limit(1))[0]);
  return Boolean((await db.select({ id: shipments.id }).from(shipments).where(eq(shipments.publicId, publicId)).limit(1))[0]);
}

export function parseNumberDraft(value: unknown): Record<NumberKind, { prefix: string; length: number; start: number }> | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  const draft = {} as Record<NumberKind, { prefix: string; length: number; start: number }>;
  for (const kind of NUMBER_KINDS) {
    const row = source[kind];
    if (!row || typeof row !== "object") return null;
    const item = row as Record<string, unknown>;
    if (!isNumberKind(kind)) return null;
    draft[kind] = { prefix: String(item.prefix ?? ""), length: Number(item.length), start: Number(item.start) };
  }
  return draft;
}
