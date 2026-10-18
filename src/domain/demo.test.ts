import { describe, expect, it } from "vitest";
import { describeEarning, summarizeEarnings } from "./earnings";
import { DEMO_SAMPLE_RATES, buildDemoCatalog, demoAccess, demoEarnings, demoOverview, demoPackages, demoQuote, demoShipments, demoUsers, publicDemoEstimate } from "./demo";
import { can } from "./staff";

describe("demo catalog", () => {
  const catalog = buildDemoCatalog();

  it("keeps a stable set of customers, packages, and shipments", () => {
    expect(catalog.customers).toHaveLength(20);
    expect(catalog.packages).toHaveLength(50);
    expect(catalog.shipments).toHaveLength(20);
    expect(buildDemoCatalog()).toEqual(buildDemoCatalog());
  });

  it("links every shipment to packages that exist for the same customer", () => {
    for (const shipment of catalog.shipments) {
      expect(shipment.packages.length).toBeGreaterThan(0);
      for (const pkg of shipment.packages) {
        const stored = catalog.packages.find((item) => item.id === pkg.id);
        expect(stored?.ownerId).toBe(shipment.ownerId);
      }
    }
  });

  it("keeps HioBuy pay, delivery, and wallet debits on the same story", () => {
    for (const shipment of catalog.shipments) {
      if (shipment.hiobuyStatus === "WAIT_SHIP" || shipment.hiobuyStatus === "SHIPPED" || shipment.hiobuyStatus === "SIGNED") {
        expect(shipment.hiobuyPaymentStatus).toBe("PAID");
      }
      if (shipment.hiobuyStatus === "SIGNED") expect(shipment.status).toBe("DELIVERED");
      if (shipment.collectedUsdFen) {
        const payment = catalog.walletTx.find((row) => row.referenceId === shipment.id && row.type === "SHIPMENT_PAYMENT");
        expect(payment?.amountFen).toBe(-shipment.collectedUsdFen);
      }
    }
    const refunded = catalog.shipments.find((item) => item.earning.adjustments.some((row) => row.kind === "refund"));
    expect(refunded).toBeTruthy();
    const credit = catalog.walletTx.find((row) => row.referenceId === refunded?.id && row.type === "REFUND");
    expect(credit?.amountFen).toBe(refunded?.earning.adjustments.find((row) => row.kind === "refund")?.usdFen);
  });

  it("adds gross profit from the same shipment facts", () => {
    const summary = demoEarnings("30d", catalog);
    const again = summarizeEarnings(catalog.facts.map((item) => item.fact), "30d", catalog.now);
    expect(summary.revenueUsdFen - summary.costUsdFen).toBe(summary.grossProfitUsdFen);
    expect(summary).toMatchObject(again);
    expect(summary.paidShipments).toBeGreaterThan(0);
    const overview = demoOverview(catalog);
    expect(overview.users.total).toBe(20);
    expect(overview.packages.total).toBe(50);
    expect(overview.shipments.total).toBe(20);
    expect(overview.wallet.balanceFen).toBe(catalog.customers.reduce((sum, item) => sum + item.balanceFen, 0));
    expect(overview.queues.hiobuyPaymentsPending).toBe(catalog.shipments.filter((item) => item.status === "READY_TO_SHIP" && item.hiobuyStatus === "WAIT_PAYMENT").length);
  });

  it("filters search without changing the seed", () => {
    const name = catalog.customers[3]!.name;
    expect(demoUsers({ q: name }, catalog).total).toBe(1);
    expect(demoPackages({ q: "DP24000", status: "all" }, catalog).total).toBe(1);
    expect(demoShipments({ status: "signed" }, catalog).total).toBe(catalog.shipments.filter((item) => item.fulfillment.key === "signed").length);
    expect(demoPackages({ status: "exception" }, catalog).items.every((item) => item.conditionStatus === "EXCEPTION")).toBe(true);
  });

  it("quotes locally and labels the result as a sample", () => {
    const light = demoQuote({ countryCode: "US", weightKg: 1, attribute: "GENERAL" });
    const heavy = demoQuote({ countryCode: "US", weightKg: 2, attribute: "GENERAL" });
    expect(light.disclaimer).toBe(DEMO_SAMPLE_RATES);
    expect(heavy.quotes[0]!.costCnyFen).toBe(light.quotes[0]!.costCnyFen * 2);
    expect(light.quotes[0]!.priceUsdFen).toBeGreaterThan(0);
  });

  it("keeps sample cost and profit off the public demo quote", () => {
    const result = publicDemoEstimate({ countryCode: "US", weightKg: 1.2, attributes: ["GENERAL"] });
    expect(result.demo).toBe(true);
    expect(result.disclaimer).toBe(DEMO_SAMPLE_RATES);
    expect(result.quotes.length).toBeGreaterThan(0);
    for (const quote of result.quotes) {
      expect(quote).not.toHaveProperty("costCnyFen");
      expect(quote).not.toHaveProperty("markupCnyFen");
      expect(quote).not.toHaveProperty("profitUsdFen");
      expect(quote.priceUsdFen).toBeGreaterThan(0);
    }
  });

  it("describes a paid fact the same way the shipment card does", () => {
    const paid = catalog.facts.find((item) => item.fact.paidAt && item.fact.hiobuyCostCnyFen);
    expect(paid && describeEarning(paid.fact).grossProfitUsdFen).toBe(catalog.shipments.find((item) => item.id === paid?.shipmentId)?.earning.grossProfitUsdFen);
  });
});

describe("demo access", () => {
  it("allows sample reads and the local quote only", () => {
    expect(demoAccess("GET", "/overview")).toBe("read");
    expect(demoAccess("GET", "/packages/demo_pkg_01")).toBe("read");
    expect(demoAccess("GET", "/shipments/demo_shp_01/sync")).toBe("read");
    expect(demoAccess("POST", "/calculator")).toBe("quote");
    expect(demoAccess("POST", "/shipments/hiobuy-pay")).toBe("deny");
    expect(demoAccess("POST", "/shipments/demo_shp_01/hiobuy-pay")).toBe("deny");
    expect(demoAccess("PUT", "/settings/api-key")).toBe("deny");
    expect(demoAccess("POST", "/settings/connect")).toBe("deny");
    expect(demoAccess("PUT", "/payments/settings")).toBe("deny");
    expect(demoAccess("POST", "/payments/pay_1/refund")).toBe("deny");
    expect(demoAccess("POST", "/users/demo_user_01/wallet")).toBe("deny");
    expect(demoAccess("PUT", "/settings/business")).toBe("deny");
    expect(demoAccess("PUT", "/email/smtp")).toBe("deny");
    expect(demoAccess("POST", "/team/invites")).toBe("deny");
    expect(demoAccess("DELETE", "/users/demo_user_01")).toBe("deny");
  });

  it("does not treat demo as a staff role", () => {
    expect(can("owner", "shipments.pay")).toBe(true);
    expect(can("manager", "shipments.pay")).toBe(true);
    expect(can("support", "packages.read")).toBe(true);
    expect(can("support", "shipments.pay")).toBe(false);
  });
});
