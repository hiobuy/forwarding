import { and, asc, eq } from "drizzle-orm";
import type { InvoiceProfileChoice } from "../src/domain/invoicing";
import type { Database } from "./db/client";
import { invoiceProfiles } from "./db/schema";
import { AppError } from "./errors";

export type InvoiceProfileView = InvoiceProfileChoice & { isDefault: boolean };

type ProfileInput = Omit<InvoiceProfileChoice, "id"> & { isDefault?: boolean };

const MAX_PROFILES = 20;

export async function listInvoiceProfiles(db: Database, userId: string): Promise<InvoiceProfileView[]> {
  const rows = await db.select().from(invoiceProfiles).where(eq(invoiceProfiles.userId, userId)).orderBy(asc(invoiceProfiles.createdAt));
  return rows.map(present);
}

export async function saveInvoiceProfile(db: Database, userId: string, input: ProfileInput, id?: string) {
  const now = Date.now();
  const values = {
    label: input.label.trim(),
    kind: input.kind,
    name: input.name.trim(),
    taxId: input.kind === "business" ? input.taxId.trim() : "",
    email: input.email.trim(),
    address: input.address.trim(),
    countryRegion: input.countryRegion.trim(),
    updatedAt: now,
  };
  if (!values.label || !values.name) throw new AppError("VALIDATION_ERROR", "Add a label and the name to print on the document.");
  if (input.kind === "business" && !values.taxId) throw new AppError("VALIDATION_ERROR", "A business profile needs a tax ID.");
  if (id) {
    const current = await owned(db, userId, id);
    await db.update(invoiceProfiles).set(values).where(eq(invoiceProfiles.id, current.id));
    if (input.isDefault) await makeDefault(db, userId, current.id);
    return (await listInvoiceProfiles(db, userId)).find((row) => row.id === current.id)!;
  }
  const existing = await listInvoiceProfiles(db, userId);
  if (existing.length >= MAX_PROFILES) throw new AppError("VALIDATION_ERROR", "You can save up to 20 invoice profiles.");
  const nextId = crypto.randomUUID();
  const isDefault = input.isDefault || existing.length === 0;
  await db.insert(invoiceProfiles).values({ id: nextId, userId, ...values, isDefault, createdAt: now });
  if (isDefault) await makeDefault(db, userId, nextId);
  return (await listInvoiceProfiles(db, userId)).find((row) => row.id === nextId)!;
}

export async function deleteInvoiceProfile(db: Database, userId: string, id: string) {
  const current = await owned(db, userId, id);
  await db.delete(invoiceProfiles).where(eq(invoiceProfiles.id, current.id));
  if (current.isDefault) {
    const rest = await listInvoiceProfiles(db, userId);
    if (rest[0]) await makeDefault(db, userId, rest[0].id);
  }
  return { ok: true as const };
}

export async function makeDefaultInvoiceProfile(db: Database, userId: string, id: string) {
  await owned(db, userId, id);
  await makeDefault(db, userId, id);
  return listInvoiceProfiles(db, userId);
}

export async function defaultInvoiceProfile(db: Database, userId: string) {
  const rows = await listInvoiceProfiles(db, userId);
  return rows.find((row) => row.isDefault) ?? null;
}

export async function invoiceProfileFor(db: Database, userId: string, profileId: string | null) {
  if (!profileId) return null;
  const rows = await listInvoiceProfiles(db, userId);
  const chosen = rows.find((row) => row.id === profileId);
  if (!chosen) throw new AppError("NOT_FOUND", "That invoice profile was not found.", 404);
  return chosen;
}

async function makeDefault(db: Database, userId: string, id: string) {
  await db.update(invoiceProfiles).set({ isDefault: false }).where(eq(invoiceProfiles.userId, userId));
  await db.update(invoiceProfiles).set({ isDefault: true }).where(and(eq(invoiceProfiles.id, id), eq(invoiceProfiles.userId, userId)));
}

async function owned(db: Database, userId: string, id: string) {
  const row = (await db.select().from(invoiceProfiles).where(and(eq(invoiceProfiles.id, id), eq(invoiceProfiles.userId, userId))))[0];
  if (!row) throw new AppError("NOT_FOUND", "That invoice profile was not found.", 404);
  return row;
}

function present(row: typeof invoiceProfiles.$inferSelect): InvoiceProfileView {
  return {
    id: row.id,
    label: row.label,
    kind: row.kind === "business" ? "business" : "individual",
    name: row.name,
    taxId: row.taxId,
    email: row.email,
    address: row.address,
    countryRegion: row.countryRegion,
    isDefault: row.isDefault,
  };
}
