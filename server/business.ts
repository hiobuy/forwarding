import { desc, eq } from "drizzle-orm";
import {
  appUrlAllowed,
  changedBusinessFields,
  inspectLogo,
  isLogoKind,
  resolveBusiness,
  trustedAppOrigin,
  validateBusinessInput,
  type BusinessEnv,
  type BusinessInput,
  type PublicBrand,
  type StoredBusiness,
} from "../src/domain/business";
import { resolveSiteMode } from "../src/domain/site";
import type { Database } from "./db/client";
import { SINGLETON_ID, singletonRow } from "./db/singleton";
import { auditLogs, businessSettings } from "./db/schema";
import { AppError } from "./errors";
import { recordAudit } from "./staff";


const LOGO_COLUMN = {
  primary: { key: "primaryLogoKey", type: "primaryLogoType" },
  square: { key: "squareLogoKey", type: "squareLogoType" },
  favicon: { key: "faviconKey", type: "faviconType" },
} as const;

export async function publicBrand(db: Database, env: BusinessEnv = {}): Promise<PublicBrand> {
  return resolveBusiness(await storedBusiness(db), env);
}

export async function adminBusinessView(db: Database, env: BusinessEnv & { PUBLIC_SITE_MODE?: string }, requestOrigin: string) {
  const stored = await storedBusiness(db);
  const brand = resolveBusiness(stored, env);
  const audits = await db.select().from(auditLogs).where(eq(auditLogs.action, "business.update")).orderBy(desc(auditLogs.createdAt)).limit(8);
  return {
    stored: inputOf(stored),
    brand,
    appUrlTrusted: stored.appUrl ? stored.appUrlTrusted : Boolean(originOf(env.APP_URL)),
    linkOrigin: trustedAppOrigin(stored, env),
    requestOrigin,
    siteMode: resolveSiteMode(env.PUBLIC_SITE_MODE),
    logos: stored.logos,
    updatedAt: stored.updatedAt,
    audit: audits.map((row) => ({
      id: row.id,
      actor: row.actorEmail,
      summary: auditSummary(row.detail),
      createdAt: new Date(row.createdAt).toISOString(),
    })),
  };
}

export async function saveBusiness(db: Database, env: BusinessEnv, actor: { id: string; email: string }, input: BusinessInput, requestOrigin: string) {
  const parsed = validateBusinessInput(input);
  if ("error" in parsed) throw new AppError("VALIDATION_ERROR", parsed.error);
  const current = await storedBusiness(db);
  const previous = inputOf(current);
  const next = parsed.value;
  const trusted = Boolean(next.appUrl) && appUrlAllowed(next.appUrl, { appUrl: env.APP_URL, trustedOrigins: env.TRUSTED_APP_ORIGINS, requestOrigin });
  await db
    .update(businessSettings)
    .set({
      name: next.name,
      legalName: next.legalName,
      email: next.email,
      supportEmail: next.supportEmail,
      phone: next.phone,
      country: next.country,
      address: next.address,
      description: next.description,
      primaryColor: next.primaryColor,
      accentColor: next.accentColor,
      publicUrl: next.publicUrl,
      appUrl: next.appUrl,
      appUrlTrusted: trusted,
      supportUrl: next.supportUrl,
      privacyUrl: next.privacyUrl,
      termsUrl: next.termsUrl,
      browserTitle: next.browserTitle,
      metaDescription: next.metaDescription,
      updatedAt: Date.now(),
      updatedBy: actor.id,
    })
    .where(eq(businessSettings.id, SINGLETON_ID));
  const fields = changedBusinessFields(previous, next);
  if (fields.length) await recordAudit(db, actor, "business.update", "business", { fields });
  return adminBusinessView(db, env, requestOrigin);
}

export async function saveBrandAsset(db: Database, bucket: R2Bucket | undefined, actor: { id: string; email: string }, kind: string, file: File) {
  if (!isLogoKind(kind)) throw new AppError("VALIDATION_ERROR", "Choose a primary logo, icon, or favicon.");
  if (!bucket) throw new AppError("CONFIG", "File storage is not configured.", 500);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const inspected = inspectLogo(kind, bytes, file.type || "");
  if ("error" in inspected) throw new AppError("VALIDATION_ERROR", inspected.error);
  const key = `branding/${kind}`;
  await bucket.put(key, bytes, { httpMetadata: { contentType: inspected.contentType } });
  const column = LOGO_COLUMN[kind];
  await db
    .update(businessSettings)
    .set({ [column.key]: key, [column.type]: inspected.contentType, updatedAt: Date.now(), updatedBy: actor.id })
    .where(eq(businessSettings.id, SINGLETON_ID));
  await recordAudit(db, actor, "business.update", "business", { fields: [kind === "favicon" ? "Favicon" : kind === "square" ? "Icon" : "Primary logo"] });
  return { kind, contentType: inspected.contentType };
}

export async function clearBrandAsset(db: Database, bucket: R2Bucket | undefined, actor: { id: string; email: string }, kind: string) {
  if (!isLogoKind(kind)) throw new AppError("VALIDATION_ERROR", "Choose a primary logo, icon, or favicon.");
  await storedBusiness(db);
  const column = LOGO_COLUMN[kind];
  if (bucket) await bucket.delete(`branding/${kind}`);
  await db
    .update(businessSettings)
    .set({ [column.key]: null, [column.type]: null, updatedAt: Date.now(), updatedBy: actor.id })
    .where(eq(businessSettings.id, SINGLETON_ID));
  await recordAudit(db, actor, "business.update", "business", { fields: [`Removed ${kind === "favicon" ? "favicon" : kind === "square" ? "icon" : "primary logo"}`] });
  return { kind, removed: true };
}

export async function readBrandAsset(db: Database, bucket: R2Bucket | undefined, kind: string) {
  if (!isLogoKind(kind) || !bucket) return null;
  const row = await ensureRow(db);
  const column = LOGO_COLUMN[kind];
  const key = row[column.key];
  if (!key) return null;
  const object = await bucket.get(key);
  if (!object) return null;
  return { bytes: new Uint8Array(await object.arrayBuffer()), contentType: row[column.type] || object.httpMetadata?.contentType || "application/octet-stream" };
}

export async function storedBusiness(db: Database): Promise<StoredBusiness> {
  const row = await ensureRow(db);
  return {
    name: row.name,
    legalName: row.legalName,
    email: row.email,
    supportEmail: row.supportEmail,
    phone: row.phone,
    country: row.country,
    address: row.address,
    description: row.description,
    primaryColor: row.primaryColor,
    accentColor: row.accentColor,
    publicUrl: row.publicUrl,
    appUrl: row.appUrl,
    appUrlTrusted: row.appUrlTrusted,
    supportUrl: row.supportUrl,
    privacyUrl: row.privacyUrl,
    termsUrl: row.termsUrl,
    browserTitle: row.browserTitle,
    metaDescription: row.metaDescription,
    logos: { primary: Boolean(row.primaryLogoKey), square: Boolean(row.squareLogoKey), favicon: Boolean(row.faviconKey) },
    updatedAt: row.updatedAt,
  };
}

export async function emailBrand(db: Database, env: BusinessEnv = {}) {
  const stored = await storedBusiness(db);
  const brand = resolveBusiness(stored, env);
  const origin = trustedAppOrigin(stored, env);
  const logoUrl = stored.logos.primary && origin?.startsWith("https://") ? `${origin}/api/branding/assets/primary?v=${stored.updatedAt}` : null;
  return {
    platformName: brand.name,
    logoUrl,
    appUrl: origin,
    primaryColor: brand.primaryColor,
    supportEmail: brand.supportEmail || brand.email,
    websiteUrl: brand.website.publicUrl || null,
    senderFallback: brand.name,
  };
}

function ensureRow(db: Database) {
  return singletonRow(db, businessSettings);
}

function inputOf(stored: StoredBusiness): BusinessInput {
  return {
    name: stored.name,
    legalName: stored.legalName,
    email: stored.email,
    supportEmail: stored.supportEmail,
    phone: stored.phone,
    country: stored.country,
    address: stored.address,
    description: stored.description,
    primaryColor: stored.primaryColor,
    accentColor: stored.accentColor,
    publicUrl: stored.publicUrl,
    appUrl: stored.appUrl,
    supportUrl: stored.supportUrl,
    privacyUrl: stored.privacyUrl,
    termsUrl: stored.termsUrl,
    browserTitle: stored.browserTitle,
    metaDescription: stored.metaDescription,
  };
}

function originOf(value: string | undefined) {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

function auditSummary(detail: string | null) {
  if (!detail) return "Updated business settings";
  try {
    const parsed = JSON.parse(detail) as { fields?: string[] };
    if (parsed.fields?.length) return parsed.fields.join(", ");
  } catch {
    return "Updated business settings";
  }
  return "Updated business settings";
}
