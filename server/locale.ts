import { eq } from "drizzle-orm";
import {
  currencyCatalog,
  DEFAULT_CURRENCY,
  DEFAULT_LOCALE,
  enabledLocaleCodes,
  isCurrencyCode,
  isLocaleCode,
  localeCatalog,
  localeStorageValue,
  normalizeCurrency,
  type CurrencyCode,
  type LocaleCode,
} from "../src/domain/locale";
import type { Database } from "./db/client";
import { SINGLETON_ID, singletonRow } from "./db/singleton";
import { platformSettings } from "./db/schema";
import { AppError } from "./errors";

const defaults = {
  enabledLocales: localeCatalog.map((item) => item.code).join(","),
  defaultLocale: DEFAULT_LOCALE,
  customerCurrency: DEFAULT_CURRENCY,
};

async function localeRow(db: Database) {
  return singletonRow(db, platformSettings, defaults);
}

export async function customerCurrency(db: Database): Promise<CurrencyCode> {
  return normalizeCurrency((await localeRow(db)).customerCurrency);
}

export function localeSettingsView(stored: { enabledLocales: string; defaultLocale: string; customerCurrency: string }) {
  const enabled = new Set(enabledLocaleCodes(stored.enabledLocales));
  const defaultLocale = enabled.has(stored.defaultLocale as LocaleCode) ? (stored.defaultLocale as LocaleCode) : ([...enabled][0] ?? DEFAULT_LOCALE);
  return {
    languages: localeCatalog.map((item) => ({ ...item, enabled: enabled.has(item.code) })),
    defaultLocale,
    currency: normalizeCurrency(stored.customerCurrency),
    currencies: currencyCatalog.map((item) => ({ ...item })),
    note: "Languages are registered in src/domain/locale.ts and translated in src/locales/. This page only turns those languages on. Customer prices, wallet balances, and new card checkouts use the currency below. Amounts already stored are not converted.",
  };
}

export async function publicLocale(db: Database) {
  const view = localeSettingsView(await localeRow(db));
  return {
    defaultLocale: view.defaultLocale,
    currency: view.currency,
    languages: view.languages.filter((item) => item.enabled).map(({ code, nativeName, englishName }) => ({ code, nativeName, englishName })),
  };
}

export async function adminLocaleSettings(db: Database) {
  return localeSettingsView(await localeRow(db));
}

export async function saveLocaleSettings(
  db: Database,
  actorId: string,
  input: { enabled: string[]; defaultLocale: string; currency: string },
) {
  const enabled = enabledLocaleCodes(input.enabled.filter((code) => isLocaleCode(code)).join(","));
  const requested = input.enabled.map((code) => code.trim()).filter(Boolean);
  if (requested.some((code) => !isLocaleCode(code))) throw new AppError("VALIDATION_ERROR", "Choose a language that is registered in the code catalog.");
  if (!input.enabled.length || enabled.length !== new Set(requested).size) throw new AppError("VALIDATION_ERROR", "Turn on at least one registered language.");
  if (!enabled.includes(input.defaultLocale as LocaleCode)) throw new AppError("VALIDATION_ERROR", "The default language has to be one you turned on.");
  const currency = input.currency.trim().toUpperCase();
  if (!isCurrencyCode(currency)) throw new AppError("VALIDATION_ERROR", "Choose a currency from the list. Amounts use 2 decimal places.");
  await localeRow(db);
  await db
    .update(platformSettings)
    .set({
      enabledLocales: localeStorageValue(enabled),
      defaultLocale: input.defaultLocale,
      customerCurrency: currency,
      updatedAt: Date.now(),
      updatedBy: actorId,
    })
    .where(eq(platformSettings.id, SINGLETON_ID));
  return adminLocaleSettings(db);
}
