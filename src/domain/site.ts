/** Deployment shape for the public site. Independent of DEMO_MODE. */

export const SITE_MODES = ["integrated", "app-only"] as const;
export type SiteMode = (typeof SITE_MODES)[number];

export function resolveSiteMode(value: string | undefined | null): SiteMode {
  return value === "app-only" ? "app-only" : "integrated";
}

export function deploymentProfile(env: { DEMO_MODE?: string; PUBLIC_SITE_MODE?: string; PUBLIC_WEBSITE_URL?: string }) {
  return {
    demo: env.DEMO_MODE === "true",
    siteMode: resolveSiteMode(env.PUBLIC_SITE_MODE),
    websiteUrl: externalWebsiteUrl(env.PUBLIC_WEBSITE_URL ?? ""),
  };
}

/** http(s) website only. Empty and unsafe values stay empty so no product domain is invented. */
export function externalWebsiteUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 400) return "";
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    if (url.username || url.password) return "";
    return url.toString();
  } catch {
    return "";
  }
}

export function homeDecision(mode: SiteMode, signedIn: boolean): { kind: "public-site" } | { kind: "redirect"; to: "/app/dashboard" | "/auth/login" } {
  if (mode === "integrated") return { kind: "public-site" };
  return { kind: "redirect", to: signedIn ? "/app/dashboard" : "/auth/login" };
}

/** Built-in marketing page is the `/` entry only in integrated mode. */
export function exposesPublicMarketing(mode: SiteMode) {
  return mode === "integrated";
}

export const sharedAppRoutes = {
  login: "/auth/login",
  register: "/auth/register",
  verifyEmail: "/auth/verify-email",
  forgotPassword: "/auth/forgot-password",
  resetPassword: "/auth/reset-password",
  confirmEmail: "/auth/confirm-email",
  terms: "/auth/terms",
  privacy: "/auth/privacy",
  invite: "/auth/invite",
  dashboard: "/app/dashboard",
  customerCalculator: "/app/shipping-calculator",
  admin: "/admin",
  adminDemo: "/admin/demo",
} as const;

export function brandHomeHref(input: { mode: SiteMode; publicUrl: string; signedIn: boolean }): string {
  const website = externalWebsiteUrl(input.publicUrl);
  if (website) return website;
  if (input.mode === "app-only") return input.signedIn ? "/app/dashboard" : "/auth/login";
  return "/";
}

/** Mail actions stay on the app origin. The public website is a footer link, not these targets. */
export function authActionUrls(appOrigin: string) {
  const origin = appOrigin.replace(/\/$/, "");
  return {
    login: `${origin}/auth/login`,
    register: `${origin}/auth/register`,
    verifyEmail: `${origin}/auth/verify-email`,
    resetPassword: `${origin}/auth/reset-password`,
    welcome: `${origin}/app/dashboard`,
    confirmEmail: `${origin}/auth/confirm-email`,
  };
}

/** Stripe return paths. Same in both site modes, and never the external marketing host. */
export function paymentReturnUrls(appOrigin: string, checkoutId: string) {
  const origin = appOrigin.replace(/\/$/, "");
  return {
    freightSuccess: `${origin}/app/checkout/${checkoutId}/return`,
    freightCancel: `${origin}/app/checkout/${checkoutId}`,
    topupSuccess: `${origin}/app/wallet`,
    topupCancel: `${origin}/app/wallet/top-up`,
  };
}
