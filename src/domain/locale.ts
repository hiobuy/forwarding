/**
 * Languages and customer currencies the product can offer.
 *
 * Add a language:
 * 1. Add a row to `localeCatalog` (code, nativeName, englishName).
 * 2. Add `src/locales/<code>.ts` exporting a map from English source text to the translation.
 * 3. Register that map in `src/locales/messages.ts`.
 *
 * English is the source text. A missing translation stays in English.
 * Operators turn registered languages on from Settings → Language.
 *
 * Add a currency to `currencyCatalog`. Amounts are minor units with 2 decimal places
 * (100 = 1). Do not add a zero-decimal currency such as JPY or KRW.
 */

export const localeCatalog = [
  { code: "en", nativeName: "English", englishName: "English" },
  { code: "zh-Hant", nativeName: "繁體中文", englishName: "Traditional Chinese" },
  { code: "ru", nativeName: "Русский", englishName: "Russian" },
] as const;

export type LocaleCode = (typeof localeCatalog)[number]["code"];

export const currencyCatalog = [
  { code: "USD", englishName: "US dollar" },
  { code: "EUR", englishName: "Euro" },
  { code: "GBP", englishName: "Pound sterling" },
  { code: "CNY", englishName: "Chinese yuan" },
  { code: "HKD", englishName: "Hong Kong dollar" },
  { code: "TWD", englishName: "New Taiwan dollar" },
  { code: "SGD", englishName: "Singapore dollar" },
  { code: "AUD", englishName: "Australian dollar" },
  { code: "CAD", englishName: "Canadian dollar" },
  { code: "CHF", englishName: "Swiss franc" },
  { code: "RUB", englishName: "Russian ruble" },
] as const;

export type CurrencyCode = (typeof currencyCatalog)[number]["code"];

export const DEFAULT_LOCALE: LocaleCode = "en";
export const DEFAULT_CURRENCY: CurrencyCode = "USD";

const localeCodes = new Set<string>(localeCatalog.map((item) => item.code));
const currencyCodes = new Set<string>(currencyCatalog.map((item) => item.code));

export function isLocaleCode(value: string): value is LocaleCode {
  return localeCodes.has(value);
}

export function isCurrencyCode(value: string): value is CurrencyCode {
  return currencyCodes.has(value);
}

/** Catalog order, dropping unknown codes. Empty input falls back to English. */
export function enabledLocaleCodes(stored: string): LocaleCode[] {
  const wanted = new Set(stored.split(",").map((item) => item.trim()).filter(Boolean));
  const codes = localeCatalog.filter((item) => wanted.has(item.code)).map((item) => item.code);
  return codes.length ? [...codes] : [DEFAULT_LOCALE];
}

export function localeStorageValue(codes: readonly string[]): string {
  return enabledLocaleCodes(codes.join(",")).join(",");
}

export type LocaleChoice = {
  stored: string | null;
  navigatorLanguage: string | null;
  enabled: readonly string[];
  fallback: string;
};

/** Saved choice, then the browser language, then the operator default. */
export function resolveActiveLocale(choice: LocaleChoice): LocaleCode {
  const enabled = enabledLocaleCodes(choice.enabled.join(","));
  if (choice.stored && enabled.includes(choice.stored as LocaleCode)) return choice.stored as LocaleCode;
  const matched = choice.navigatorLanguage ? matchNavigatorLocale(choice.navigatorLanguage, enabled) : null;
  if (matched) return matched;
  if (enabled.includes(choice.fallback as LocaleCode)) return choice.fallback as LocaleCode;
  return enabled[0] ?? DEFAULT_LOCALE;
}

export function matchNavigatorLocale(language: string, enabled: readonly LocaleCode[]): LocaleCode | null {
  const value = language.trim().toLowerCase().replace(/_/g, "-");
  if (!value) return null;
  if (value === "zh-tw" || value === "zh-hk" || value === "zh-mo" || value.startsWith("zh-hant")) {
    return enabled.includes("zh-Hant") ? "zh-Hant" : null;
  }
  if (value.startsWith("zh")) return null;
  const base = value.split("-")[0] ?? value;
  return enabled.find((code) => code.toLowerCase() === value || code.toLowerCase() === base) ?? null;
}

export function normalizeCurrency(value: string | null | undefined): CurrencyCode {
  const code = (value ?? "").trim().toUpperCase();
  return isCurrencyCode(code) ? code : DEFAULT_CURRENCY;
}

export function translate(messages: Record<string, string> | undefined, text: string, vars?: Record<string, string | number>): string {
  const lead = text.match(/^\s*/)?.[0] ?? "";
  const trail = text.match(/\s*$/)?.[0] ?? "";
  const key = text.trim();
  if (!key) return text;
  let value = messages?.[key] ?? key;
  if (vars) value = applyVars(value, vars);
  if (value === key && vars) value = applyVars(key, vars);
  return value === key ? text : `${lead}${value}${trail}`;
}

function applyVars(template: string, vars: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (token, name: string) => (vars[name] == null ? token : String(vars[name])));
}

export function formatMoney(minor: number, currency: string, locale: string, signed = false): string {
  const code = normalizeCurrency(currency);
  const formatted = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: code,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(minor / 100);
  if (signed && minor > 0) return `+${formatted}`;
  return formatted;
}

export function currencySymbol(currency: string, locale: string): string {
  const code = normalizeCurrency(currency);
  const part = new Intl.NumberFormat(locale, { style: "currency", currency: code }).formatToParts(0).find((item) => item.type === "currency");
  return part?.value ?? code;
}
