import { describe, expect, it } from "vitest";
import { can, inviteState, lastOwnerBlocked, permissionFor, permissionsOf } from "./staff";

describe("staff permissions", () => {
  it("gives the owner every permission", () => {
    expect(can("owner", "secrets.write")).toBe(true);
    expect(can("owner", "team.manage")).toBe(true);
    expect(can("owner", "shipments.pay")).toBe(true);
  });

  it("lets a manager run fulfillment and HioBuy pay, not secrets or team settings", () => {
    expect(can("manager", "fulfillment.write")).toBe(true);
    expect(can("manager", "shipments.pay")).toBe(true);
    expect(can("manager", "payments.money")).toBe(true);
    expect(can("manager", "earnings.read")).toBe(true);
    expect(can("manager", "secrets.write")).toBe(false);
    expect(can("manager", "settings.write")).toBe(false);
    expect(can("manager", "business.write")).toBe(false);
    expect(can("manager", "team.manage")).toBe(false);
  });

  it("keeps support off money and system configuration", () => {
    expect(can("support", "packages.read")).toBe(true);
    expect(can("support", "shipments.read")).toBe(true);
    expect(can("support", "packages.exception")).toBe(true);
    expect(can("support", "assistant.write")).toBe(true);
    expect(can("support", "shipments.pay")).toBe(false);
    expect(can("support", "payments.money")).toBe(false);
    expect(can("support", "secrets.write")).toBe(false);
    expect(can("support", "settings.write")).toBe(false);
    expect(can("support", "business.write")).toBe(false);
    expect(can("support", "packages.write")).toBe(false);
    expect(permissionsOf("support")).not.toContain("shipments.pay");
  });

  it("blocks removing or demoting the last active owner", () => {
    const last = { activeOwnerCount: 1, targetRole: "owner" as const, targetStatus: "active" as const };
    expect(lastOwnerBlocked({ ...last, action: "remove" })).toBe(true);
    expect(lastOwnerBlocked({ ...last, action: "disable" })).toBe(true);
    expect(lastOwnerBlocked({ ...last, action: "role", nextRole: "manager" })).toBe(true);
    expect(lastOwnerBlocked({ ...last, action: "role", nextRole: "owner" })).toBe(false);
    expect(lastOwnerBlocked({ ...last, activeOwnerCount: 2, action: "remove" })).toBe(false);
    expect(lastOwnerBlocked({ activeOwnerCount: 1, targetRole: "support", targetStatus: "active", action: "remove" })).toBe(false);
  });

  it("accepts an invite token once, before it expires", () => {
    const now = 1_000;
    expect(inviteState({ usedAt: null, expiresAt: now + 1 }, now)).toBe("open");
    expect(inviteState({ usedAt: null, expiresAt: now }, now)).toBe("expired");
    expect(inviteState({ usedAt: now, expiresAt: now + 1 }, now)).toBe("used");
  });
});

describe("admin route gates", () => {
  it("stops support from HioBuy pay, Stripe settings, and the API key", () => {
    expect(permissionFor("POST", "/shipments/hiobuy-pay")).toBe("shipments.pay");
    expect(permissionFor("POST", "/shipments/shp_1/hiobuy-pay")).toBe("shipments.pay");
    expect(permissionFor("PUT", "/payments/settings")).toBe("secrets.write");
    expect(permissionFor("PUT", "/settings/api-key")).toBe("secrets.write");
    expect(permissionFor("POST", "/settings/connect")).toBe("secrets.write");
    expect(permissionFor("PUT", "/email/smtp")).toBe("secrets.write");
    expect(can("support", "shipments.pay")).toBe(false);
    expect(can("support", "secrets.write")).toBe(false);
  });

  it("covers the sensitive admin routes", () => {
    const routes: [string, string, string][] = [
      ["GET", "/me", "staff"],
      ["GET", "/team", "team.manage"],
      ["POST", "/team/invites", "team.manage"],
      ["PUT", "/payments/settings", "secrets.write"],
      ["POST", "/payments/pay_1/refund", "payments.money"],
      ["GET", "/payments", "payments.read"],
      ["POST", "/settings/fulfillment-sync/scan", "fulfillment.write"],
      ["PUT", "/settings/api-key", "secrets.write"],
      ["POST", "/settings/connect", "secrets.write"],
      ["PUT", "/email/smtp", "secrets.write"],
      ["POST", "/shipments/hiobuy-pay", "shipments.pay"],
      ["POST", "/shipments/shp_1/hiobuy-pay", "shipments.pay"],
      ["POST", "/users/user_1/wallet", "payments.money"],
      ["POST", "/packages/pkg_1/exception", "packages.exception"],
      ["POST", "/packages/pkg_1/receive", "packages.write"],
      ["GET", "/packages/pkg_1", "packages.read"],
      ["GET", "/settings/business", "settings.read"],
      ["PUT", "/settings/business", "business.write"],
      ["POST", "/settings/business/assets/primary", "business.write"],
      ["GET", "/unknown", "deny"],
    ];
    for (const [method, path, permission] of routes) {
      expect(permissionFor(method, path)).toBe(permission);
    }
  });
});
