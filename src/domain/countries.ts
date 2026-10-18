export const COUNTRIES = [
  { code: "AU", name: "Australia", dial: "+61" },
  { code: "CA", name: "Canada", dial: "+1" },
  { code: "FR", name: "France", dial: "+33" },
  { code: "DE", name: "Germany", dial: "+49" },
  { code: "JP", name: "Japan", dial: "+81" },
  { code: "KR", name: "Korea", dial: "+82" },
  { code: "SG", name: "Singapore", dial: "+65" },
  { code: "GB", name: "United Kingdom", dial: "+44" },
  { code: "US", name: "United States", dial: "+1" },
] as const;

export type CountryCode = (typeof COUNTRIES)[number]["code"];

const NAMES = new Map<string, string>(COUNTRIES.map((country) => [country.code, country.name]));

export function countryName(code: string): string {
  const known = NAMES.get(code);
  if (known) return known;
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

export function isCountryCode(code: string): code is CountryCode {
  return NAMES.has(code);
}

export function countriesByName() {
  return [...COUNTRIES].sort((a, b) => a.name.localeCompare(b.name));
}

const EXTRA_DIALS: Record<string, string> = {
  CN: "+86",
  ID: "+62",
  IR: "+98",
  NG: "+234",
  RU: "+7",
  UZ: "+998",
};

export function dialFor(countryCode: string): string {
  const code = countryCode.toUpperCase();
  return COUNTRIES.find((country) => country.code === code)?.dial ?? EXTRA_DIALS[code] ?? "";
}

export function splitPersonName(name: string): { firstName: string; lastName: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

/** Pull a known calling code off the front of a stored phone number. */
export function splitInternationalPhone(phone: string, fallbackDial = ""): { phoneCode: string; phone: string } {
  const compact = phone.trim();
  const dials = [...new Set(COUNTRIES.map((country) => country.dial))].sort((a, b) => b.length - a.length);
  for (const dial of dials) {
    if (compact.startsWith(dial)) return { phoneCode: dial, phone: compact.slice(dial.length).trim() };
  }
  return { phoneCode: fallbackDial, phone: compact };
}
