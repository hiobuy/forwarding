/** Operator brand. One workspace, not a tenant theme. */

export const DEFAULT_PRIMARY_COLOR = "#4F46E5";

/** Open-source fallback used until the operator saves a business profile. */
export const OPEN_SOURCE_BRAND = {
  name: "HIOBuy Forwarding",
  email: "",
  supportEmail: "",
  phone: "",
  whatsapp: "",
  country: "",
  address: "",
  description: "",
  primaryColor: DEFAULT_PRIMARY_COLOR,
  accentColor: "",
  publicUrl: "",
  appUrl: "",
  supportUrl: "",
  privacyUrl: "",
  termsUrl: "",
  browserTitle: "",
  metaDescription: "Consolidate packages at a warehouse and ship them internationally.",
} as const;

export const LOGO_KINDS = ["primary", "square", "favicon"] as const;
export type LogoKind = (typeof LOGO_KINDS)[number];

export type StoredBusiness = {
  name: string;
  legalName: string;
  email: string;
  supportEmail: string;
  phone: string;
  whatsapp: string;
  country: string;
  address: string;
  description: string;
  primaryColor: string;
  accentColor: string;
  publicUrl: string;
  appUrl: string;
  appUrlTrusted: boolean;
  supportUrl: string;
  privacyUrl: string;
  termsUrl: string;
  browserTitle: string;
  metaDescription: string;
  logos: { primary: boolean; square: boolean; favicon: boolean };
  updatedAt: number;
};

export type PublicBrand = {
  name: string;
  legalName: string;
  email: string;
  supportEmail: string;
  phone: string;
  whatsappUrl: string;
  country: string;
  address: string;
  description: string;
  primaryColor: string;
  accentColor: string;
  logos: { primary: boolean; square: boolean; favicon: boolean };
  updatedAt: number;
  website: {
    publicUrl: string;
    appUrl: string;
    supportUrl: string;
    privacyUrl: string;
    termsUrl: string;
  };
  seo: { browserTitle: string; metaDescription: string };
};

export type BusinessEnv = {
  BUSINESS_NAME?: string;
  BUSINESS_EMAIL?: string;
  PUBLIC_WEBSITE_URL?: string;
  APP_URL?: string;
  TRUSTED_APP_ORIGINS?: string;
};

export type BusinessInput = {
  name: string;
  legalName: string;
  email: string;
  supportEmail: string;
  phone: string;
  whatsapp: string;
  country: string;
  address: string;
  description: string;
  primaryColor: string;
  accentColor: string;
  publicUrl: string;
  appUrl: string;
  supportUrl: string;
  privacyUrl: string;
  termsUrl: string;
  browserTitle: string;
  metaDescription: string;
};

const LIMITS = {
  name: 80,
  legalName: 120,
  email: 120,
  phone: 40,
  country: 80,
  address: 400,
  description: 400,
  url: 400,
  title: 80,
  meta: 200,
} as const;

const LOGO_BYTES: Record<LogoKind, number> = {
  primary: 1024 * 1024,
  square: 1024 * 1024,
  favicon: 256 * 1024,
};

export function isLogoKind(value: string): value is LogoKind {
  return (LOGO_KINDS as readonly string[]).includes(value);
}

export function whatsappLink(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  let digits = "";
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      const host = url.hostname.replace(/^www\./, "");
      if (host !== "wa.me" && host !== "api.whatsapp.com") return "";
      const fromPath = url.pathname.split("/").filter(Boolean)[0] ?? "";
      digits = (url.searchParams.get("phone") || fromPath).replace(/\D/g, "");
    } catch {
      return "";
    }
  } else if (/[^\d+\s().-]/.test(trimmed)) {
    return "";
  } else {
    digits = trimmed.replace(/\D/g, "");
  }
  if (digits.length < 8 || digits.length > 15) return "";
  return `https://wa.me/${digits}`;
}

export function whatsappNumber(value: string): string {
  const link = whatsappLink(value);
  return link ? link.slice("https://wa.me/".length) : "";
}

export function plainText(value: string, max: number) {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").replace(/[<>]/g, "").trim().slice(0, max);
}

export function hexColor(value: string): string | null {
  const trimmed = value.trim();
  if (!/^#[0-9A-Fa-f]{6}$/.test(trimmed)) return null;
  return trimmed.toUpperCase();
}

export function darkenHex(hex: string, amount = 0.14) {
  const parsed = hexColor(hex);
  if (!parsed) return DEFAULT_PRIMARY_COLOR;
  const n = Number.parseInt(parsed.slice(1), 16);
  const mix = (channel: number) => Math.max(0, Math.round(channel * (1 - amount)));
  const channels = [mix((n >> 16) & 255), mix((n >> 8) & 255), mix(n & 255)];
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

/** http(s) URL without credentials. Empty input stays empty. Invalid input is null. */
export function httpUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.length > LIMITS.url) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  return url.toString();
}

export function appUrlAllowed(value: string, allow: { appUrl?: string; trustedOrigins?: string; requestOrigin?: string }) {
  const url = httpUrl(value);
  if (!url) return false;
  const origin = new URL(url).origin;
  const allowed = new Set<string>();
  for (const candidate of [allow.requestOrigin, allow.appUrl, ...(allow.trustedOrigins ?? "").split(",")]) {
    const parsed = candidate ? httpUrl(candidate.trim()) : null;
    if (parsed) allowed.add(new URL(parsed).origin);
  }
  return allowed.has(origin);
}

export function pageTitle(page: string, brand: Pick<PublicBrand, "name" | "seo">) {
  const site = brand.seo.browserTitle || brand.name;
  return `${page} | ${site}`;
}

export function resolveBusiness(stored: StoredBusiness, env: BusinessEnv = {}): PublicBrand {
  const name = firstText(stored.name, env.BUSINESS_NAME, OPEN_SOURCE_BRAND.name);
  const email = firstText(stored.email, env.BUSINESS_EMAIL, "");
  const publicUrl = firstText(stored.publicUrl, env.PUBLIC_WEBSITE_URL, "");
  const appUrl = firstText(stored.appUrl, env.APP_URL, "");
  return {
    name,
    legalName: stored.legalName,
    email,
    supportEmail: stored.supportEmail,
    phone: stored.phone,
    whatsappUrl: whatsappLink(stored.whatsapp),
    country: stored.country,
    address: stored.address,
    description: stored.description,
    primaryColor: hexColor(stored.primaryColor) ?? DEFAULT_PRIMARY_COLOR,
    accentColor: stored.accentColor ? hexColor(stored.accentColor) ?? "" : "",
    logos: stored.logos,
    updatedAt: stored.updatedAt,
    website: {
      publicUrl,
      appUrl,
      supportUrl: stored.supportUrl,
      privacyUrl: stored.privacyUrl,
      termsUrl: stored.termsUrl,
    },
    seo: {
      browserTitle: stored.browserTitle || name,
      metaDescription: stored.metaDescription || OPEN_SOURCE_BRAND.metaDescription,
    },
  };
}

/** Absolute customer-center origin for links. Untrusted admin URLs are ignored. */
export function trustedAppOrigin(stored: StoredBusiness, env: BusinessEnv = {}): string | null {
  if (stored.appUrl && stored.appUrlTrusted) return originOf(stored.appUrl);
  return originOf(env.APP_URL);
}

export function validateBusinessInput(input: BusinessInput): { value: BusinessInput } | { error: string } {
  const name = plainText(input.name, LIMITS.name);
  const email = input.email.trim().toLowerCase();
  if (!name) return { error: "Enter a business name." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > LIMITS.email) return { error: "Enter a business email." };
  const whatsapp = whatsappNumber(input.whatsapp);
  if (input.whatsapp.trim() && !whatsapp) return { error: "Enter a WhatsApp number with the country code, or leave it empty." };
  const supportEmail = input.supportEmail.trim().toLowerCase();
  if (supportEmail && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(supportEmail) || supportEmail.length > LIMITS.email)) return { error: "Enter a valid support email." };
  const primaryColor = hexColor(input.primaryColor);
  if (!primaryColor) return { error: "Primary color must be a hex color like #4F46E5." };
  const accentRaw = input.accentColor.trim();
  const accentColor = accentRaw ? hexColor(accentRaw) : "";
  if (accentRaw && !accentColor) return { error: "Accent color must be a hex color, or left empty." };
  const urls = {
    publicUrl: httpUrl(input.publicUrl),
    appUrl: httpUrl(input.appUrl),
    supportUrl: httpUrl(input.supportUrl),
    privacyUrl: httpUrl(input.privacyUrl),
    termsUrl: httpUrl(input.termsUrl),
  };
  if (Object.values(urls).some((url) => url == null)) return { error: "Website addresses must start with http:// or https://." };
  return {
    value: {
      name,
      legalName: plainText(input.legalName, LIMITS.legalName),
      email,
      supportEmail,
      phone: plainText(input.phone, LIMITS.phone),
      whatsapp,
      country: plainText(input.country, LIMITS.country),
      address: plainText(input.address, LIMITS.address),
      description: plainText(input.description, LIMITS.description),
      primaryColor,
      accentColor: accentColor || "",
      publicUrl: urls.publicUrl ?? "",
      appUrl: urls.appUrl ?? "",
      supportUrl: urls.supportUrl ?? "",
      privacyUrl: urls.privacyUrl ?? "",
      termsUrl: urls.termsUrl ?? "",
      browserTitle: plainText(input.browserTitle, LIMITS.title),
      metaDescription: plainText(input.metaDescription, LIMITS.meta),
    },
  };
}

export function changedBusinessFields(previous: BusinessInput, next: BusinessInput) {
  const labels: Record<keyof BusinessInput, string> = {
    name: "Business name",
    legalName: "Legal company name",
    email: "Business email",
    supportEmail: "Support email",
    phone: "Support phone",
    whatsapp: "WhatsApp",
    country: "Country",
    address: "Address",
    description: "Description",
    primaryColor: "Primary color",
    accentColor: "Accent color",
    publicUrl: "Public website",
    appUrl: "Customer app URL",
    supportUrl: "Support URL",
    privacyUrl: "Privacy URL",
    termsUrl: "Terms URL",
    browserTitle: "Browser title",
    metaDescription: "Meta description",
  };
  return (Object.keys(labels) as (keyof BusinessInput)[]).filter((key) => previous[key] !== next[key]).map((key) => labels[key]);
}

/** Seller block for a newly issued document. Stored invoice fields fill anything Business has not set. */
export function invoiceSeller<T extends { businessName: string; businessAddress: string; countryRegion: string; contactEmail: string }>(
  business: Pick<StoredBusiness, "name" | "legalName" | "email" | "supportEmail" | "address" | "country">,
  invoice: T,
): T {
  const name = business.legalName.trim() || business.name.trim() || invoice.businessName;
  return {
    ...invoice,
    businessName: name,
    businessAddress: business.address.trim() || invoice.businessAddress,
    countryRegion: business.country.trim() || invoice.countryRegion,
    contactEmail: invoice.contactEmail.trim() || business.email.trim() || business.supportEmail.trim(),
  };
}

export function svgProblem(source: string): string | null {
  const text = source.replace(/^\uFEFF/, "").trim();
  if (!text || text.length > 500_000) return "This SVG is too large.";
  if (!/^<svg[\s>]/i.test(text) && !/^<\?xml[\s>]/i.test(text)) return "Upload an SVG file.";
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) return "This SVG is not allowed.";
  if (/<\s*(script|foreignObject|iframe|embed|object|handler)\b/i.test(text)) return "This SVG is not allowed.";
  if (/\son[a-z]+\s*=/i.test(text)) return "This SVG is not allowed.";
  if (/javascript\s*:|data\s*:/i.test(text)) return "This SVG is not allowed.";
  if (/(?:href|xlink:href)\s*=\s*["']?\s*https?:/i.test(text)) return "SVG files cannot reference external images.";
  return null;
}

export function inspectLogo(kind: LogoKind, bytes: Uint8Array, declaredType: string): { contentType: string } | { error: string } {
  if (bytes.byteLength < 8) return { error: "That file is empty." };
  if (bytes.byteLength > LOGO_BYTES[kind]) return { error: kind === "favicon" ? "Favicon must be 256 KB or smaller." : "Logo must be 1 MB or smaller." };
  const sniffed = sniffImage(bytes);
  if (!sniffed) return { error: "Upload a PNG, WebP, or SVG file." };
  const declared = declaredType.toLowerCase().split(";")[0]?.trim() ?? "";
  if (declared && declared !== sniffed && declared !== "image/svg+xml") return { error: "The file contents do not match its type." };
  if (sniffed === "image/svg+xml") {
    const problem = svgProblem(new TextDecoder().decode(bytes));
    if (problem) return { error: problem };
  }
  return { contentType: sniffed };
}

function sniffImage(bytes: Uint8Array): string | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  const head = new TextDecoder().decode(bytes.slice(0, 256)).trimStart();
  if (head.startsWith("<svg") || head.startsWith("<?xml")) return "image/svg+xml";
  return null;
}

function firstText(...values: (string | undefined)[]) {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return "";
}

function originOf(value: string | undefined) {
  const url = value ? httpUrl(value) : null;
  if (!url) return null;
  return new URL(url).origin;
}
