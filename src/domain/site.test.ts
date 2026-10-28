import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveBusiness, type StoredBusiness } from "./business";
import { renderTemplate } from "./email";
import {
  authActionUrls,
  brandHomeHref,
  deploymentProfile,
  exposesPublicMarketing,
  externalWebsiteUrl,
  homeDecision,
  paymentReturnUrls,
  sharedAppRoutes,
} from "./site";

const modes = ["integrated", "app-only"] as const;
const appOrigin = "https://app.operator.example";
const website = "https://example.com/forwarding";

const stored: StoredBusiness = {
  name: "",
  legalName: "",
  email: "",
  supportEmail: "",
  phone: "",
  whatsapp: "",
  country: "",
  address: "",
  description: "",
  primaryColor: "#4F46E5",
  accentColor: "",
  publicUrl: "",
  appUrl: "",
  appUrlTrusted: false,
  supportUrl: "",
  privacyUrl: "",
  termsUrl: "",
  browserTitle: "",
  metaDescription: "",
  logos: { primary: false, square: false, favicon: false },
  updatedAt: 0,
};

describe("public site mode", () => {
  it("defaults to integrated and keeps demo mode independent", () => {
    expect(deploymentProfile({}).siteMode).toBe("integrated");
    expect(deploymentProfile({ PUBLIC_SITE_MODE: "integrated" }).siteMode).toBe("integrated");
    expect(deploymentProfile({ PUBLIC_SITE_MODE: "other" }).siteMode).toBe("integrated");
    expect(deploymentProfile({ DEMO_MODE: "true", PUBLIC_SITE_MODE: "app-only" })).toEqual({
      demo: true,
      siteMode: "app-only",
      websiteUrl: "",
    });
    expect(deploymentProfile({ DEMO_MODE: "false", PUBLIC_SITE_MODE: "integrated", PUBLIC_WEBSITE_URL: website })).toMatchObject({
      demo: false,
      siteMode: "integrated",
      websiteUrl: website,
    });
  });

  it("routes home without dropping login, register, the customer calculator, or admin", () => {
    expect(homeDecision("integrated", false)).toEqual({ kind: "public-site" });
    expect(homeDecision("integrated", true)).toEqual({ kind: "public-site" });
    expect(homeDecision("app-only", false)).toEqual({ kind: "redirect", to: "/auth/login" });
    expect(homeDecision("app-only", true)).toEqual({ kind: "redirect", to: "/app/dashboard" });
    for (const mode of modes) {
      expect(sharedAppRoutes.login).toBe("/auth/login");
      expect(sharedAppRoutes.register).toBe("/auth/register");
      expect(sharedAppRoutes.customerCalculator).toBe("/app/shipping-calculator");
      expect(sharedAppRoutes.dashboard).toBe("/app/dashboard");
      expect(sharedAppRoutes.admin).toBe("/admin");
      expect(exposesPublicMarketing(mode)).toBe(mode === "integrated");
    }
  });

  it("uses the configured website for the logo and does not invent a product domain", () => {
    expect(externalWebsiteUrl("")).toBe("");
    expect(externalWebsiteUrl("javascript:alert(1)")).toBe("");
    expect(externalWebsiteUrl("https://user:secret@example.com")).toBe("");
    expect(brandHomeHref({ mode: "integrated", publicUrl: "", signedIn: false })).toBe("/");
    expect(brandHomeHref({ mode: "app-only", publicUrl: "", signedIn: false })).toBe("/auth/login");
    expect(brandHomeHref({ mode: "app-only", publicUrl: "", signedIn: true })).toBe("/app/dashboard");
    expect(brandHomeHref({ mode: "app-only", publicUrl: website, signedIn: false })).toBe(website);
    expect(brandHomeHref({ mode: "app-only", publicUrl: website, signedIn: true })).not.toBe("/");
    expect(resolveBusiness(stored, { PUBLIC_WEBSITE_URL: website }).website.publicUrl).toBe(website);
    expect(resolveBusiness(stored).website.publicUrl).toBe("");
  });

  it("keeps email actions and payment returns on the app in both modes", () => {
    const actions = authActionUrls(appOrigin);
    const returns = paymentReturnUrls(appOrigin, "chk_1");
    expect(actions).toEqual({
      login: `${appOrigin}/auth/login`,
      register: `${appOrigin}/auth/register`,
      verifyEmail: `${appOrigin}/auth/verify-email`,
      resetPassword: `${appOrigin}/auth/reset-password`,
      welcome: `${appOrigin}/app/dashboard`,
      confirmEmail: `${appOrigin}/auth/confirm-email`,
    });
    expect(returns).toEqual({
      freightSuccess: `${appOrigin}/app/checkout/chk_1/return`,
      freightCancel: `${appOrigin}/app/checkout/chk_1`,
      topupSuccess: `${appOrigin}/app/wallet`,
      topupCancel: `${appOrigin}/app/wallet/top-up`,
    });
    for (const mode of modes) {
      expect(homeDecision(mode, false).kind === "public-site" || homeDecision(mode, false).kind === "redirect").toBe(true);
      const rendered = renderTemplate({
        subject: "Verify",
        body: "Open {{actionUrl}}",
        vars: { actionUrl: actions.verifyEmail },
        platformName: "Northwind",
        logoUrl: null,
        appUrl: actions.welcome,
        websiteUrl: website,
      });
      expect(rendered.html).toContain(actions.verifyEmail);
      expect(rendered.html).toContain("example.com");
      expect(rendered.html).not.toContain("package-consolidat");
      expect(rendered.html).not.toContain(mode);
      for (const url of [...Object.values(actions), ...Object.values(returns)]) {
        expect(url.startsWith(appOrigin)).toBe(true);
        expect(url).not.toContain("example.com");
      }
    }
    const payments = readFileSync(join(process.cwd(), "server/payments.ts"), "utf8");
    const auth = readFileSync(join(process.cwd(), "server/auth.ts"), "utf8");
    expect(payments).toContain("/app/checkout/${checkoutId}/return");
    expect(payments).toContain("/app/checkout/${checkoutId}");
    expect(payments).toContain("/app/wallet?topup=pending");
    expect(payments).toContain("/app/wallet/top-up");
    expect(payments).not.toContain("PUBLIC_WEBSITE_URL");
    expect(payments).not.toContain("PUBLIC_SITE_MODE");
    const createAuth = auth.slice(auth.indexOf("export async function createAuth"));
    expect(createAuth).toContain("/auth/reset-password?token=");
    expect(createAuth).toContain("/app/dashboard");
    expect(createAuth).not.toContain("PUBLIC_SITE_MODE");
    expect(createAuth).not.toContain("PUBLIC_WEBSITE_URL");
  });
});
