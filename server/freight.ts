import { eq, inArray } from "drizzle-orm";
import { countryName, dialFor } from "../src/domain/countries";
import { DEFAULT_SELLING_POLICY, type SellingPolicy, type SyncedDestination } from "../src/domain/freight";
import { TRACKING_EVENT_CODES, resolveTrackingLabels } from "../src/domain/tracking-events";
import { warehouseProfile } from "../src/mocks/warehouse";
import type { Database } from "./db/client";
import { SINGLETON_ID, singletonRow } from "./db/singleton";
import { freightAreas, freightPolicy, warehouseLocations } from "./db/schema";
import { AppError } from "./errors";
import { fetchHioBuyChannelDestinations } from "./services/hiobuy/channels";
import { fetchHioBuyWarehouse } from "./services/hiobuy/locations";


function areaId(countryCode: string, regionCode: string) {
  return `${countryCode}|${regionCode}`;
}

export async function trackingEventLabelView(db: Database) {
  return { labels: resolveTrackingLabels((await freightPolicyRow(db)).trackingEventLabels) };
}

export async function saveTrackingEventLabels(db: Database, input: Record<string, string>) {
  const labels = resolveTrackingLabels(null);
  for (const code of TRACKING_EVENT_CODES) {
    const value = input[code];
    if (typeof value === "string" && value.trim()) labels[code] = value.trim().slice(0, 80);
  }
  await freightPolicyRow(db);
  await db.update(freightPolicy).set({ trackingEventLabels: JSON.stringify(labels), updatedAt: Date.now() }).where(eq(freightPolicy.id, SINGLETON_ID));
  return { labels };
}

/** The one freight policy row: API key, sync state, markup, and exchange rate. */
export function freightPolicyRow(db: Database) {
  return singletonRow(db, freightPolicy, { ...DEFAULT_SELLING_POLICY, syncSource: "catalog", syncedAt: Date.now() });
}

/** Keeps each area's enabled flag across syncs. */
async function mergeAreas(db: Database, incoming: SyncedDestination[]) {
  const now = Date.now();
  const areas = await db.select().from(freightAreas);
  const areaEnabled = new Map(areas.map((row) => [row.id, row.enabled]));
  const nextAreaIds = [...new Set(incoming.map((row) => areaId(row.countryCode, row.regionCode)))];
  const staleAreas = areas.map((row) => row.id).filter((id) => !nextAreaIds.includes(id));
  if (staleAreas.length) await db.delete(freightAreas).where(inArray(freightAreas.id, staleAreas));
  const seenAreas = new Set<string>();
  for (const row of incoming) {
    const id = areaId(row.countryCode, row.regionCode);
    if (seenAreas.has(id)) continue;
    seenAreas.add(id);
    if (areaEnabled.has(id)) {
      await db.update(freightAreas).set({ regionName: row.regionName, updatedAt: now }).where(eq(freightAreas.id, id));
    } else {
      await db.insert(freightAreas).values({
        id,
        countryCode: row.countryCode,
        regionCode: row.regionCode,
        regionName: row.regionName,
        enabled: true,
        updatedAt: now,
      });
    }
  }
  return {
    added: nextAreaIds.filter((id) => !areaEnabled.has(id)).length,
    updated: nextAreaIds.filter((id) => areaEnabled.has(id)).length,
    unavailable: staleAreas.length,
  };
}

export async function resolveHioBuyToken(db: Database, envToken: string | undefined) {
  return (await freightPolicyRow(db)).apiKey?.trim() || envToken?.trim() || undefined;
}

export async function fulfillmentConnected(db: Database) {
  return (await freightPolicyRow(db)).syncSource === "hiobuy";
}

export type OpenDestination = { code: string; name: string; dial: string; regions: { code: string; name: string }[] };

/** Countries and regions the merchant has left open in Settings → Destinations. */
export async function listOpenDestinations(db: Database): Promise<{ countries: OpenDestination[] }> {
  if (!(await fulfillmentConnected(db))) return { countries: [] };
  const areas = await db.select().from(freightAreas).where(eq(freightAreas.enabled, true));
  const byCountry = new Map<string, { code: string; name: string }[]>();
  for (const row of areas) {
    const list = byCountry.get(row.countryCode) ?? [];
    if (!list.some((item) => item.code === row.regionCode)) list.push({ code: row.regionCode, name: row.regionName });
    byCountry.set(row.countryCode, list);
  }
  const countries = [...byCountry.entries()]
    .map(([code, regions]) => {
      const nameCount = new Map<string, number>();
      for (const region of regions) nameCount.set(region.name, (nameCount.get(region.name) ?? 0) + 1);
      return {
        code,
        name: countryName(code),
        dial: dialFor(code),
        regions: regions
          .map((region) => ({ code: region.code, name: (nameCount.get(region.name) ?? 0) > 1 ? `${region.name} (${region.code})` : region.name }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  return { countries };
}

/** One markup rule applies to every channel. */
export async function sellingPolicy(db: Database): Promise<SellingPolicy> {
  const policy = await freightPolicyRow(db);
  return { markupBps: policy.markupBps, markupCnyFen: policy.markupCnyFen, cnyPerUsdE4: policy.cnyPerUsdE4 };
}

function keyHint(apiKey: string | null) {
  if (!apiKey) return null;
  const tail = apiKey.slice(-4);
  return `••••${tail}`;
}

function readDestinations(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string" && /^[A-Z]{2}$/.test(item)) : [];
  } catch {
    return [];
  }
}

export async function settingsView(db: Database) {
  const policy = await freightPolicyRow(db);
  const areas = await db.select().from(freightAreas);
  const warehouse = (await db.select().from(warehouseLocations))[0] ?? null;
  const live = policy.syncSource === "hiobuy";
  const countryCodes = [...new Set(areas.map((row) => row.countryCode))].sort();
  const countries = live
    ? countryCodes.map((code) => ({ code, name: countryName(code), enabled: areas.some((row) => row.countryCode === code && row.enabled) }))
    : [];
  return {
    connection: { configured: Boolean(policy.apiKey), hint: keyHint(policy.apiKey) },
    connected: live,
    sync: { source: policy.syncSource, syncedAt: policy.syncedAt ? new Date(policy.syncedAt).toISOString() : null },
    warehouse: warehouse
      ? {
          name: warehouse.name,
          country: warehouse.country,
          province: warehouse.province,
          city: warehouse.city,
          district: warehouse.district,
          street: warehouse.street,
          postalCode: warehouse.postalCode,
          phone: warehouse.phone,
          recipient: warehouse.recipient,
          hours: warehouse.hours,
          supportedDestinations: readDestinations(warehouse.supportedDestinations),
          notice: warehouse.notice,
          syncedAt: new Date(warehouse.syncedAt).toISOString(),
        }
      : null,
    countries,
    pricing: { markupBps: policy.markupBps, markupCnyFen: policy.markupCnyFen, cnyPerUsdE4: policy.cnyPerUsdE4 },
    autoSyncPackages: policy.autoSyncPackages !== false,
  };
}

export async function saveAutoSyncPackages(db: Database, enabled: boolean) {
  await freightPolicyRow(db);
  await db.update(freightPolicy).set({ autoSyncPackages: enabled, updatedAt: Date.now() }).where(eq(freightPolicy.id, SINGLETON_ID));
  return settingsView(db);
}

export async function saveApiKey(db: Database, apiKey: string | null) {
  await freightPolicyRow(db);
  const trimmed = apiKey?.trim() ?? "";
  if (trimmed && trimmed.length < 8) throw new AppError("VALIDATION_ERROR", "The API key looks too short.");
  await db.update(freightPolicy).set({ apiKey: trimmed || null, updatedAt: Date.now() }).where(eq(freightPolicy.id, SINGLETON_ID));
  return settingsView(db);
}

function upstreamCode(error: unknown): string | undefined {
  if (!(error instanceof AppError) || !error.details || typeof error.details !== "object") return undefined;
  const code = (error.details as { upstreamCode?: unknown }).upstreamCode;
  return typeof code === "string" ? code : undefined;
}

/** Turn an upstream failure into setup advice. A timeout is not an invalid key. */
function explainConnectionError(error: unknown, saved: boolean): never {
  if (error instanceof AppError && error.code === "UPSTREAM_TIMEOUT") {
    throw new AppError(
      "UPSTREAM_TIMEOUT",
      saved ? "HioBuy did not respond. Try again. The saved key was not marked invalid." : "HioBuy did not respond. Try again. The key was not saved and is not marked invalid.",
      504,
    );
  }
  const code = upstreamCode(error);
  if (code === "INVALID_API_KEY") {
    throw new AppError("INVALID_API_KEY", "This API key was rejected. Check it in the Developer Portal, or generate a new Production key.", 400);
  }
  if (code === "FULFILLMENT_MODE_NOT_SUPPORTED") {
    throw new AppError("FULFILLMENT_MODE_NOT_SUPPORTED", "Switch Fulfillment Mode to HioBuy Warehouse and Procurement Mode to Self Procurement, then try again.", 400);
  }
  if (code === "WAREHOUSE_AUTH_INVALID") {
    throw new AppError("WAREHOUSE_AUTH_INVALID", "Warehouse authorization failed. Bind the warehouse with the code HioBuy provides, then try again.", 400);
  }
  const message = error instanceof AppError ? error.message : "HioBuy could not be checked.";
  throw new AppError("UPSTREAM_ERROR", saved ? message : `${message} The key was not saved.`, 502);
}

/**
 * Warehouse address and shipping channels must both respond.
 * One success is not enough to call fulfillment ready.
 */
export async function verifyHioBuyAccess(token: string | undefined, saved = false) {
  if (!token?.trim()) throw new AppError("VALIDATION_ERROR", "Enter an API key first.");
  try {
    await fetchHioBuyWarehouse(token);
  } catch (error) {
    explainConnectionError(error, saved);
  }
  try {
    await fetchHioBuyChannelDestinations(token);
  } catch (error) {
    explainConnectionError(error, saved);
  }
  return { ok: true as const, warehouse: true as const, channels: true as const };
}

export async function connectHioBuy(db: Database, apiKey: string) {
  const token = apiKey.trim();
  if (token.length < 8) throw new AppError("VALIDATION_ERROR", "The API key looks too short.");
  await verifyHioBuyAccess(token, false);
  await saveApiKey(db, token);
  try {
    await syncWarehouseAddress(db, token);
    const view = await syncFreightDestinations(db, token);
    try {
      const { onAccessRestored, scanHistoricalSync } = await import("./fulfillment-sync");
      await onAccessRestored(db);
      await scanHistoricalSync(db);
    } catch (error) {
      const { logEvent } = await import("./errors");
      logEvent({ level: "error", message: "History scan did not finish", detail: error instanceof Error ? error.message : "unknown" });
    }
    return view;
  } catch (error) {
    if (error instanceof AppError && error.code === "UPSTREAM_TIMEOUT") {
      throw new AppError("UPSTREAM_TIMEOUT", "The key is saved, but HioBuy did not finish syncing. Try again. The key was not marked invalid.", 504);
    }
    const code = upstreamCode(error);
    if (code === "INVALID_API_KEY" || code === "FULFILLMENT_MODE_NOT_SUPPORTED" || code === "WAREHOUSE_AUTH_INVALID") explainConnectionError(error, true);
    const message = error instanceof AppError ? error.message : "Sync did not finish.";
    throw new AppError("UPSTREAM_ERROR", `The key is saved. ${message}`, 502);
  }
}

export async function setAllCountries(db: Database, enabled: boolean) {
  await freightPolicyRow(db);
  await db.update(freightAreas).set({ enabled, updatedAt: Date.now() });
  return settingsView(db);
}

export async function setCountryEnabled(db: Database, countryCode: string, enabled: boolean) {
  await freightPolicyRow(db);
  await db.update(freightAreas).set({ enabled, updatedAt: Date.now() }).where(eq(freightAreas.countryCode, countryCode));
  return settingsView(db);
}

export async function savePricing(
  db: Database,
  input: { markupBps: number; markupCnyFen: number; cnyPerUsdE4: number },
) {
  if (input.cnyPerUsdE4 <= 0) throw new AppError("VALIDATION_ERROR", "Enter an exchange rate greater than 0.");
  if (input.markupBps < 0 || input.markupBps > 10000) throw new AppError("VALIDATION_ERROR", "The markup percent must be between 0 and 100.");
  if (input.markupCnyFen < 0) throw new AppError("VALIDATION_ERROR", "The fixed markup cannot be negative.");
  await freightPolicyRow(db);
  const now = Date.now();
  await db
    .update(freightPolicy)
    .set({ markupBps: input.markupBps, markupCnyFen: input.markupCnyFen, cnyPerUsdE4: input.cnyPerUsdE4, updatedAt: now })
    .where(eq(freightPolicy.id, SINGLETON_ID));
  return settingsView(db);
}

export async function syncFreightDestinations(db: Database, token: string | undefined) {
  await freightPolicyRow(db);
  const live = await fetchHioBuyChannelDestinations(token);
  if (!live) throw new AppError("VALIDATION_ERROR", "Save a HioBuy API key before syncing channels. Nothing is listed until HioBuy responds.");
  const syncStats = await mergeAreas(db, live);
  await db
    .update(freightPolicy)
    .set({ syncSource: "hiobuy", syncedAt: Date.now() })
    .where(eq(freightPolicy.id, SINGLETON_ID));
  const view = await settingsView(db);
  return { ...view, live: true, syncStats };
}

export async function syncWarehouseAddress(db: Database, token: string | undefined) {
  await freightPolicyRow(db);
  const location = await fetchHioBuyWarehouse(token);
  if (!location) throw new AppError("VALIDATION_ERROR", "Save a HioBuy API key before syncing the warehouse address.");
  const now = Date.now();
  const existing = (await db.select().from(warehouseLocations).where(eq(warehouseLocations.id, "current")))[0];
  const values = {
    id: "current",
    name: location.name,
    country: location.country,
    province: location.province,
    city: location.city,
    district: location.district,
    street: location.street,
    postalCode: location.postalCode,
    phone: location.phone,
    recipient: location.recipient,
    hours: location.hours,
    supportedDestinations: JSON.stringify(location.supportedDestinations),
    notice: location.notice,
    remoteId: location.id,
    syncedAt: now,
  };
  const warehouseChanged = Boolean(existing?.remoteId && existing.remoteId !== location.id);
  if (existing) await db.update(warehouseLocations).set(values).where(eq(warehouseLocations.id, "current"));
  else await db.insert(warehouseLocations).values(values);
  if (warehouseChanged) {
    const { onWarehouseChanged } = await import("./fulfillment-sync");
    await onWarehouseChanged(db);
  }
  return settingsView(db);
}

export async function customerWarehouse(db: Database) {
  const row = (await db.select().from(warehouseLocations).where(eq(warehouseLocations.id, "current")))[0];
  if (!row) return { synced: false as const };
  return {
    synced: true as const,
    name: row.name,
    phone: row.phone,
    recipient: row.recipient,
    province: row.province,
    city: row.city,
    district: row.district,
    street: row.street,
    postalCode: row.postalCode,
    country: row.country,
    hours: row.hours,
    notice: row.notice,
    receivingRules: warehouseProfile.receivingRules,
    prohibitedItems: warehouseProfile.prohibitedItems,
    inboundNotes: warehouseProfile.inboundNotes,
    freeStorageDays: warehouseProfile.freeStorageDays,
  };
}
