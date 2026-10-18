import { describe, expect, it } from "vitest";
import {
  appUrlAllowed,
  changedBusinessFields,
  darkenHex,
  inspectLogo,
  invoiceSeller,
  pageTitle,
  resolveBusiness,
  trustedAppOrigin,
  validateBusinessInput,
  type StoredBusiness,
} from "./business";

const stored: StoredBusiness = {
  name: "",
  legalName: "",
  email: "",
  supportEmail: "",
  phone: "",
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

describe("business settings", () => {
  it("uses the open-source name until an operator or environment value exists", () => {
    expect(resolveBusiness(stored).name).toBe("HIOBuy Forwarding");
    expect(resolveBusiness(stored, { BUSINESS_NAME: "Northwind Forwarding" }).name).toBe("Northwind Forwarding");
    expect(resolveBusiness({ ...stored, name: "Parcel House" }, { BUSINESS_NAME: "Northwind Forwarding" }).name).toBe("Parcel House");
  });

  it("rejects markup in names and unsafe website URLs", () => {
    const badName = validateBusinessInput(sample({ name: "<script>alert(1)</script>", email: "a@example.com" }));
    expect("value" in badName && badName.value.name).toBe("scriptalert(1)/script");
    expect(validateBusinessInput(sample({ name: "Parcel House", email: "not-an-email" }))).toEqual({ error: "Enter a business email." });
    const badUrl = validateBusinessInput(sample({ publicUrl: "javascript:alert(1)" }));
    const badAuth = validateBusinessInput(sample({ appUrl: "https://user:secret@evil.example/app" }));
    expect("error" in badUrl && badUrl.error).toMatch(/http/);
    expect("error" in badAuth && badAuth.error).toMatch(/http/);
  });

  it("trusts an app URL only when it matches the deployment allowlist", () => {
    expect(appUrlAllowed("https://app.example.com", { requestOrigin: "https://app.example.com" })).toBe(true);
    expect(appUrlAllowed("https://evil.example", { requestOrigin: "https://app.example.com", appUrl: "https://app.example.com" })).toBe(false);
    expect(appUrlAllowed("https://app.example.com/login", { trustedOrigins: "https://app.example.com" })).toBe(true);
    expect(trustedAppOrigin({ ...stored, appUrl: "https://evil.example", appUrlTrusted: false }, { APP_URL: "https://app.example.com" })).toBe("https://app.example.com");
    expect(trustedAppOrigin({ ...stored, appUrl: "https://app.example.com", appUrlTrusted: true })).toBe("https://app.example.com");
  });

  it("keeps invoice tax fields and prefers the legal name for new documents", () => {
    const seller = invoiceSeller(
      { ...stored, name: "Parcel House", legalName: "Parcel House LLC", address: "1 Dock Street", country: "US", email: "billing@example.com", supportEmail: "" },
      { businessName: "Old invoice name", businessAddress: "Old", countryRegion: "CN", contactEmail: "", taxId: "VAT-1", invoiceFooter: "Thanks" },
    );
    expect(seller.businessName).toBe("Parcel House LLC");
    expect(seller.businessAddress).toBe("1 Dock Street");
    expect(seller.contactEmail).toBe("billing@example.com");
    expect(seller.taxId).toBe("VAT-1");
    expect(seller.invoiceFooter).toBe("Thanks");
  });

  it("leaves an issued invoice snapshot alone when the profile later changes", () => {
    const issued = invoiceSeller(stored, { businessName: "Parcel House LLC", businessAddress: "1 Dock Street", countryRegion: "US", contactEmail: "a@example.com" });
    const later = invoiceSeller({ ...stored, legalName: "Other LLC", address: "9 New Road" }, issued);
    expect(issued.businessName).toBe("Parcel House LLC");
    expect(later.businessName).toBe("Other LLC");
    expect(issued.businessAddress).toBe("1 Dock Street");
  });

  it("names changed fields without storing the new text", () => {
    const previous = sample();
    const next = { ...previous, name: "Other House", primaryColor: "#111111" };
    expect(changedBusinessFields(previous, next)).toEqual(["Business name", "Primary color"]);
  });

  it("builds a browser title from the page and the operator brand", () => {
    const brand = resolveBusiness({ ...stored, name: "Parcel House", browserTitle: "Parcel House" });
    expect(pageTitle("My Packages", brand)).toBe("My Packages | Parcel House");
  });

  it("darkens the primary color without touching status colors", () => {
    expect(darkenHex("#4F46E5")).toMatch(/^#[0-9A-F]{6}$/);
    expect(darkenHex("#4F46E5")).not.toBe("#4F46E5");
  });

  it("accepts a small PNG and rejects an SVG with a script", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    expect(inspectLogo("favicon", png, "image/png")).toEqual({ contentType: "image/png" });
    const svg = new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`);
    expect("error" in inspectLogo("primary", svg, "image/svg+xml")).toBe(true);
    const safe = new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>`);
    expect(inspectLogo("square", safe, "image/svg+xml")).toEqual({ contentType: "image/svg+xml" });
  });
});

function sample(overrides: Partial<Parameters<typeof validateBusinessInput>[0]> = {}) {
  return {
    name: "Parcel House",
    legalName: "",
    email: "hello@example.com",
    supportEmail: "",
    phone: "",
    country: "",
    address: "",
    description: "",
    primaryColor: "#4F46E5",
    accentColor: "",
    publicUrl: "",
    appUrl: "",
    supportUrl: "",
    privacyUrl: "",
    termsUrl: "",
    browserTitle: "",
    metaDescription: "",
    ...overrides,
  };
}
