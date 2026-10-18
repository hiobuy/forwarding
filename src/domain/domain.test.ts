import { describe, expect, it } from "vitest";
import { isAssistantAccountRequest, leadingAssistantAnswer, matchAssistantAnswers } from "./assistant-knowledge";
import { formatFen, percentOf } from "./money";
import { customerUsdFen, parseChannelCatalog, parsePercentBps, parseRateE4 } from "./freight";
import { presentChannelDetail } from "./channel-detail";
import { readHioBuyBalance, readHioBuyTransaction, readHioBuyTransactions, signedAmount } from "./hiobuy-wallet";
import { priceLiveQuotes, publicQuotes, readItemAttributes, readQuoteList } from "./live-quote";
import { allowQuoteAttempt } from "./quote-limit";
import { applyPayment, cnyFenToUsdFen, countsAsShippingRevenue, describeEarning, earningsWindow, summarizeEarnings, type EarningFact } from "./earnings";
import { countriesByName, splitInternationalPhone, splitPersonName } from "./countries";
import { customerReceivingLine, formatWarehouseLine, hoursText, pickWarehouseLocation, presentSchedule } from "./warehouse-location";
import { adminShipmentStatus, customerShipmentDisplay, customerShipmentMatches, getPackageDisplayStatus, packageEligibility } from "./status";
import { normalizeTrackingInput } from "./tracking";
import { mergeTimeline, timelineFromSync } from "./timeline";
import { labelTrackingEvent, resolveTrackingLabels } from "./tracking-events";
import { volumetricGrams } from "./units";

const ready = {
  packageStatus: "RECEIVED" as const,
  conditionStatus: "NORMAL" as const,
  exceptionStatus: "NONE" as const,
  vasStatus: "NONE" as const,
  lockStatus: "AVAILABLE" as const,
  disposition: "NONE" as const,
};

describe("assistant knowledge", () => {
  const lost = {
    id: "lost",
    question: "包裹丢失怎么赔",
    answer: "丢失不自动赔付。",
    keywords: "丢失,赔偿",
  };
  const battery = {
    id: "battery",
    question: "电池能寄吗",
    answer: "带电货物要单独申报。",
    keywords: "电池",
  };

  it("matches a published answer by keyword and leaves account actions to tools", () => {
    expect(matchAssistantAnswers("我的包裹丢失了怎么办", [lost, battery]).map((item) => item.id)).toEqual(["lost"]);
    expect(leadingAssistantAnswer("我的包裹丢失了怎么办", [lost, battery])?.answer).toBe("丢失不自动赔付。");
    expect(leadingAssistantAnswer("帮我预报一个SF123123124", [lost])).toBeNull();
    expect(leadingAssistantAnswer("丢失电池怎么办", [lost, battery])).toBeNull();
    expect(isAssistantAccountRequest("钱包余额还有多少")).toBe(true);
  });
});

describe("money and units", () => {
  it("formats fen without floating point", () => {
    expect(formatFen(18000)).toBe("$180.00");
    expect(formatFen(32680)).toBe("$326.80");
    expect(formatFen(-2000)).toBe("-$20.00");
    expect(percentOf(30600, 10)).toBe(3060);
  });

  it("computes volumetric grams from millimeters", () => {
    expect(volumetricGrams(320, 210, 160)).toBe(2150);
  });
});

describe("package status", () => {
  it("keeps lifecycle separate from an open exception", () => {
    const status = getPackageDisplayStatus({
      ...ready,
      conditionStatus: "EXCEPTION",
      exceptionStatus: "ACTION_REQUIRED",
      vasStatus: "PROCESSING",
      lockStatus: "LOCKED",
    });
    expect(status.label).toBe("Received");
    expect(packageEligibility({ ...ready, conditionStatus: "EXCEPTION" }).eligible).toBe(false);
  });

  it("blocks unfinished VAS", () => {
    expect(packageEligibility({ ...ready, vasStatus: "PROCESSING" }).reason).toMatch(/value-added/i);
  });

  it("labels a linked shipment from the HioBuy lifecycle and keeps an unlinked shipment local", () => {
    expect(adminShipmentStatus({ hiobuyShipmentId: "115", upstreamStatus: "WAIT_PAYMENT", localStatus: "CONSOLIDATING" }).label).toBe("Awaiting Payment");
    expect(adminShipmentStatus({ hiobuyShipmentId: null, upstreamStatus: null, localStatus: "CONSOLIDATING" }).label).toBe("Local · Packing");
  });

  it("shows Payment Received after the customer pays and Ready to Ship only after HioBuy WAIT_SHIP", () => {
    expect(customerShipmentDisplay({ status: "TO_PAY", upstreamStatus: "WAIT_PAYMENT", linked: true }).label).toBe("To Pay");
    expect(customerShipmentDisplay({ status: "READY_TO_SHIP", upstreamStatus: "WAIT_PAYMENT", linked: true }).label).toBe("Payment Received");
    expect(customerShipmentDisplay({ status: "READY_TO_SHIP", upstreamStatus: "WAIT_SHIP", linked: true }).label).toBe("Ready to Ship");
    expect(customerShipmentDisplay({ status: "READY_TO_SHIP", upstreamStatus: "SHIPPED", linked: true }).label).toBe("In Transit");
    expect(customerShipmentDisplay({ status: "READY_TO_SHIP", upstreamStatus: "SIGNED", linked: true }).label).toBe("Completed");
    expect(customerShipmentDisplay({ status: "CANCELLED", upstreamStatus: "CANCELLED", linked: true }).label).toBe("Cancelled");
    expect(customerShipmentDisplay({ status: "READY_TO_SHIP", upstreamStatus: "WAIT_PAYMENT", linked: false }).label).toBe("Ready to Ship");
    expect(customerShipmentMatches("payment_received", "ready_to_ship")).toBe(false);
    expect(customerShipmentMatches("payment_received", "all")).toBe(true);
    expect(customerShipmentMatches("to_pay", "to_pay")).toBe(true);
  });
});

describe("tracking input", () => {
  it("trims, dedupes, and keeps the first order", () => {
    const result = normalizeTrackingInput(" CJ123 \nCJ123\n\nCJ456 ");
    expect(result.numbers).toEqual(["CJ123", "CJ456"]);
    expect(result.overflow).toBe(false);
  });

  it("flags more than 20 numbers instead of dropping them", () => {
    const raw = Array.from({ length: 21 }, (_, index) => `CJ12345${index}`).join("\n");
    expect(normalizeTrackingInput(raw).overflow).toBe(true);
  });
});

describe("selling price", () => {
  it("adds a percent margin in yuan, then converts to dollar cents", () => {
    const usd = customerUsdFen(10000, { markupBps: 1000, markupCnyFen: 0, cnyPerUsdE4: 72000 });
    expect(usd).toBe(1528);
  });

  it("adds a fixed yuan amount before converting", () => {
    const usd = customerUsdFen(10000, { markupBps: 0, markupCnyFen: 500, cnyPerUsdE4: 72000 });
    expect(usd).toBe(1458);
  });

  it("combines a percent and a fixed yuan amount", () => {
    const usd = customerUsdFen(10000, { markupBps: 1000, markupCnyFen: 500, cnyPerUsdE4: 72000 });
    expect(usd).toBe(1597);
  });

  it("reads HioBuy channel regions", () => {
    const rows = parseChannelCatalog({
      data: [{ code: "CJ_AIR", name: "CJ AIR", regions: [{ code: "KANTO", name: "Kanto", country_code: "jp" }] }],
    });
    expect(rows).toEqual([{ channelCode: "CJ_AIR", channelName: "CJ AIR", countryCode: "JP", regionCode: "KANTO", regionName: "Kanto" }]);
    const listed = parseChannelCatalog({
      items: [{ code: "US-SEA", name: "美线海运", regions: [{ code: "US-WEST", name: "美西", countries: ["US"] }] }],
      pagination: { has_more: false },
    });
    expect(listed).toEqual([{ channelCode: "US-SEA", channelName: "美线海运", countryCode: "US", regionCode: "US-WEST", regionName: "美西" }]);
    expect(parsePercentBps("10")).toBe(1000);
    expect(parseRateE4("7.2")).toBe(72000);
  });

  it("picks the recommended open warehouse", () => {
    const location = pickWarehouseLocation({
      data: [
        { id: "wh_old", name: "Old", country: "CN", province: "Guangdong", city: "Shenzhen", district: "Baoan", address: { recipient: "WH", phone: "1", postal_code: "518000", address_line: "Old road" }, status: "INACTIVE", receiving_status: "CLOSED", recommended: false },
        { id: "wh_new", name: "Shenzhen", country: "CN", province: "Guangdong", city: "Shenzhen", district: "Longgang", address: { recipient: "WH", phone: "2", postal_code: "518001", address_line: "88 Logistics Avenue" }, status: "ACTIVE", receiving_status: "OPEN", recommended: true, business_hours: { text: "09:00–18:00" } },
      ],
    });
    expect(location?.id).toBe("wh_new");
    expect(location?.street).toBe("88 Logistics Avenue");
    expect(location?.recipient).toBe("WH");
    expect(location?.hours).toBe("09:00–18:00");
    expect(location?.supportedDestinations).toEqual([]);
    const numeric = pickWarehouseLocation({
      data: [{ id: 1, name: "默认仓库", country: "中国", province: "", city: "", district: "龙岗区", address: { recipient: "示例收件人", phone: 13800000002, postal_code: "430000", address_line: "深圳龙岗区" }, status: "ACTIVE", receiving_status: "OPEN", recommended: true }],
    });
    expect(numeric?.id).toBe("1");
    expect(numeric?.recipient).toBe("示例收件人");
    expect(numeric?.street).toBe("深圳龙岗区");
    expect(numeric?.hours).toBe("");
    expect(hoursText(1)).toBe("");
    expect(hoursText({ timezone: "Asia/Shanghai" })).toBe("Asia/Shanghai");
    const live = pickWarehouseLocation({
      data: [
        {
          id: "1",
          name: "SZ Warehouse",
          country: "cn",
          province: "广东省",
          city: "深圳市",
          district: "龙岗区",
          address: { recipient: "示例联系人", phone: "13800000001", postal_code: "5100000", address_line: "示例街道示例大厦101" },
          supported_destinations: ["US", "ID", "GB"],
          business_hours: {
            timezone: "Asia/Shanghai",
            weekdays: [
              { day: "MONDAY", closed: false, open: "09:00", close: "24:00" },
              { day: "TUESDAY", closed: false, open: "09:00", close: "24:00" },
              { day: "WEDNESDAY", closed: false, open: "09:00", close: "24:00" },
              { day: "THURSDAY", closed: false, open: "09:00", close: "24:00" },
              { day: "FRIDAY", closed: false, open: "09:00", close: "24:00" },
              { day: "SATURDAY", closed: false, open: "09:00", close: "24:00" },
              { day: "SUNDAY", closed: true, open: null, close: null },
            ],
          },
        },
      ],
    });
    expect(live?.recipient).toBe("示例联系人");
    expect(live?.hours).toBe("Mon–Sat 09:00–24:00, Sun closed");
    expect(live?.supportedDestinations).toEqual(["US", "ID", "GB"]);
    expect(presentSchedule(live?.hours ?? "")).toEqual({ label: "Hours", value: "Mon–Sat 09:00–24:00, Sun closed" });
    expect(presentSchedule("1")).toBeNull();
    expect(presentSchedule("Asia/Shanghai")).toEqual({ label: "Timezone", value: "Asia/Shanghai" });
    expect(presentSchedule("09:00–18:00")).toEqual({ label: "Hours", value: "09:00–18:00" });
    expect(customerReceivingLine("示例联系人", "HX10238")).toBe("示例联系人(HX10238)");
    expect(customerReceivingLine("广东省深圳市龙岗区示例街道示例大厦101", "HX10238")).toBe("广东省深圳市龙岗区示例街道示例大厦101(HX10238)");
    expect(customerReceivingLine("示例联系人(HX10238)", "HX10238")).toBe("示例联系人(HX10238)");
    expect(formatWarehouseLine({ country: "cn", province: "广东省", city: "深圳市", district: "龙岗区", street: "示例街道示例大厦101", postalCode: "518129" })).toBe("广东省深圳市龙岗区示例街道示例大厦101 518129");
    expect(formatWarehouseLine({ country: "cn", province: "广东省", city: "深圳市", district: "龙岗区", street: "广东省深圳市龙岗区示例街道示例大厦101", postalCode: "5100000" })).toBe("广东省深圳市龙岗区示例街道示例大厦101 5100000");
    expect(numeric?.phone).toBe("13800000002");
  });
});

describe("shipping gross profit", () => {
  const paidAt = Date.UTC(2026, 9, 16, 8, 0, 0);
  const now = Date.UTC(2026, 9, 16, 18, 0, 0);
  const snapshot = { hiobuyCostCnyFen: 10000, markupBps: 1500, markupCnyFen: 300, cnyPerUsdE4: 72000, costConfirmed: false };
  const charged = customerUsdFen(10000, { markupBps: 1500, markupCnyFen: 300, cnyPerUsdE4: 72000 });

  function paid(overrides: Partial<EarningFact> = {}): EarningFact {
    return { paidAt, billedUsdFen: charged, collectedUsdFen: charged, adjustments: [], ...snapshot, ...overrides };
  }

  it("recognizes revenue and profit once a shipment is paid", () => {
    const view = describeEarning(paid());
    expect(charged).toBe(1639);
    expect(cnyFenToUsdFen(10000, 72000)).toBe(1389);
    expect(view.customerChargedUsdFen).toBe(1639);
    expect(view.hiobuyCostUsdFen).toBe(1389);
    expect(view.grossProfitUsdFen).toBe(250);
    expect(view.status).toBe("provisional");
    expect(view.included).toBe(true);
  });

  it("ignores wallet top-ups, quotes, unpaid bills, and failed charges", () => {
    expect(countsAsShippingRevenue("top_up")).toBe(false);
    expect(countsAsShippingRevenue("quote")).toBe(false);
    expect(countsAsShippingRevenue("unpaid")).toBe(false);
    expect(countsAsShippingRevenue("failed")).toBe(false);
    expect(countsAsShippingRevenue("shipment_payment")).toBe(true);
    const summary = summarizeEarnings([paid({ paidAt: null, collectedUsdFen: null })], "30d", now);
    expect(summary.revenueUsdFen).toBe(0);
    expect(summary.paidShipments).toBe(0);
  });

  it("keeps a later markup or exchange rate from rewriting the snapshot", () => {
    const original = describeEarning(paid());
    const repriced = describeEarning(paid({ markupBps: 5000, cnyPerUsdE4: 80000 }));
    expect(original.grossProfitUsdFen).toBe(250);
    expect(original.hiobuyCostUsdFen).toBe(1389);
    expect(repriced.hiobuyCostUsdFen).not.toBe(original.hiobuyCostUsdFen);
  });

  it("reduces profit for a full refund, a partial refund, and a higher HioBuy cost", () => {
    const full = describeEarning(paid({ adjustments: [{ id: "r1", idempotencyKey: "r1", kind: "refund", usdFen: 1639, cnyFen: null, note: "cancel", createdAt: paidAt }] }));
    expect(full.revenueUsdFen).toBe(0);
    expect(full.grossProfitUsdFen).toBe(-1389);
    expect(full.fullyRefunded).toBe(true);
    expect(full.status).toBe("adjusted");
    const partial = describeEarning(paid({ adjustments: [{ id: "r2", idempotencyKey: "r2", kind: "refund", usdFen: 100, cnyFen: null, note: "part", createdAt: paidAt }] }));
    expect(partial.revenueUsdFen).toBe(1539);
    expect(partial.grossProfitUsdFen).toBe(150);
    expect(partial.fullyRefunded).toBe(false);
    const cost = describeEarning(paid({ adjustments: [{ id: "c1", idempotencyKey: "c1", kind: "cost", usdFen: 0, cnyFen: 13000, note: "surcharge", createdAt: paidAt }] }));
    expect(cost.hiobuyCostCnyFen).toBe(13000);
    expect(cost.hiobuyCostUsdFen).toBe(cnyFenToUsdFen(13000, 72000));
    expect(cost.grossProfitUsdFen).toBe(1639 - (cost.hiobuyCostUsdFen ?? 0));
  });

  it("applies a repeated payment or adjustment only once", () => {
    const once = applyPayment(paid({ paidAt: null, collectedUsdFen: null }), 1639, paidAt);
    const twice = applyPayment(once, 9999, paidAt + 1000);
    expect(twice.collectedUsdFen).toBe(1639);
    expect(twice.paidAt).toBe(paidAt);
    const doubled = describeEarning(paid({
      adjustments: [
        { id: "a", idempotencyKey: "same", kind: "refund", usdFen: 100, cnyFen: null, note: "once", createdAt: paidAt },
        { id: "b", idempotencyKey: "same", kind: "refund", usdFen: 100, cnyFen: null, note: "replay", createdAt: paidAt },
      ],
    }));
    expect(doubled.revenueUsdFen).toBe(1539);
  });

  it("does not invent profit when the cost snapshot is missing", () => {
    const view = describeEarning(paid({ hiobuyCostCnyFen: null, markupBps: null, markupCnyFen: null, cnyPerUsdE4: null }));
    expect(view.status).toBe("unavailable");
    expect(view.grossProfitUsdFen).toBeNull();
    expect(view.hiobuyCostUsdFen).toBeNull();
    expect(view.included).toBe(false);
    const summary = summarizeEarnings([paid(), paid({ hiobuyCostCnyFen: null, cnyPerUsdE4: null })], "30d", now);
    expect(summary.excludedShipments).toBe(1);
    expect(summary.revenueUsdFen).toBe(1639);
    expect(summary.grossProfitUsdFen).toBe(250);
  });

  it("matches the period total to the shipment rows, in UTC", () => {
    const yesterday = Date.UTC(2026, 9, 15, 23, 30, 0);
    const rows = [paid(), paid({ paidAt: yesterday, collectedUsdFen: 1000, billedUsdFen: 1000, hiobuyCostCnyFen: 5000 })];
    const summary = summarizeEarnings(rows, "today", now);
    const included = rows.filter((row) => {
      const view = describeEarning(row);
      return view.included && row.paidAt != null && row.paidAt >= earningsWindow("today", now).start && row.paidAt <= now;
    });
    expect(earningsWindow("today", now).start).toBe(Date.UTC(2026, 9, 16));
    expect(summary.paidShipments).toBe(1);
    expect(summary.grossProfitUsdFen).toBe(included.reduce((sum, row) => sum + (describeEarning(row).grossProfitUsdFen ?? 0), 0));
    const week = summarizeEarnings(rows, "7d", now);
    expect(week.paidShipments).toBe(2);
  });
});

describe("live shipping quotes", () => {
  const policy = { markupBps: 1500, markupCnyFen: 300, cnyPerUsdE4: 72000 };

  it("prices a HioBuy fen total once, then sorts by the selling price", () => {
    const quotes = priceLiveQuotes([
      { channel: { code: "B", name: "Sea" }, available: true, quote_status: "COMPLETE", total: { amount: 20000 }, known_total: { amount: 20000 }, transit_time: { min_business_days: 20, max_business_days: 30 } },
      { channel: { code: "A", name: "Air" }, available: true, quote_status: "COMPLETE", total: { amount: 10000 }, known_total: { amount: 10000 }, transit_time: { min_business_days: 7, max_business_days: 12 } },
      { channel: { code: "C", name: "Closed" }, available: false, quote_status: "UNAVAILABLE", total: { amount: 100 } },
    ], policy);
    expect(quotes.map((item) => item.code)).toEqual(["A", "B"]);
    expect(quotes[0]?.priceUsdFen).toBe(1639);
    expect(quotes[0]?.profitUsdFen).toBe(250);
    expect(quotes[0]?.eta).toBe("7–12 business days");
    const shown = publicQuotes(quotes);
    expect(shown[0]).not.toHaveProperty("costCnyFen");
    expect(shown[0]).not.toHaveProperty("profitUsdFen");
    expect(shown[0]?.priceUsdFen).toBe(1639);
  });

  it("reads quote and attribute payloads without inventing a price", () => {
    expect(readQuoteList({ quotes: [{ channel: { code: "A" }, available: true }] })).toHaveLength(1);
    expect(readItemAttributes({ items: [{ code: "GENERAL", name: "General cargo" }, { code: "GENERAL", name: "Duplicate" }] })).toEqual([{ code: "GENERAL", name: "General cargo" }]);
    expect(priceLiveQuotes([{ channel: { code: "A", name: "Air" }, available: true, quote_status: "COMPLETE" }], policy)).toEqual([]);
  });

  it("stops a public quote burst", () => {
    const key = `test-${Date.now()}`;
    expect(allowQuoteAttempt(key, 2, 1000, 1)).toBe(true);
    expect(allowQuoteAttempt(key, 2, 1000, 2)).toBe(true);
    expect(allowQuoteAttempt(key, 2, 1000, 3)).toBe(false);
    expect(allowQuoteAttempt(key, 2, 1000, 2000)).toBe(true);
  });

  it("shows channel limits to customers and keeps HioBuy rate rows for admins", () => {
    const payload = {
      code: "AIR",
      name: "Air line",
      description: "Door delivery for general cargo.",
      capabilities: { delivery_methods: ["DOOR_DELIVERY"] },
      billing: { quantity_unit: "KG", supported_range: { minimum: { value: 0.1, unit: "KG" }, maximum: { value: 20, unit: "KG" } }, volumetric_weight: { enabled: true, divisor: 6000 } },
      regions: [{ code: "US-WEST", name: "US West", countries: ["US"], reference_transit_time: { min_business_days: 7, max_business_days: 12 } }, { code: "JP", name: "Japan", countries: ["JP"] }],
      channel_rules: { items: [{ name: "No liquids", rule_type: "FORBID_ORDERING" }] },
      value_added_services: [{ code: "PHOTO", name: "Photo", request_mode: "OPTIONAL", description: "Warehouse photos" }],
      rate_cards: [{ region_code: "US-WEST", price_rows: [{ type: "FIRST_WEIGHT", range: { minimum: 0, maximum: 1, unit: "KG" }, charge: { amount: 5000, currency: "CNY" } }] }],
    };
    const customer = presentChannelDetail(payload, "US", "public");
    const admin = presentChannelDetail(payload, "US", "admin");
    expect(customer?.regions.map((region) => region.name)).toEqual(["US West"]);
    expect(customer?.restrictions).toEqual(["No liquids"]);
    expect(customer?.rates).toBeNull();
    expect(admin?.rates?.[0]?.rows[0]?.amount).toBe("¥50.00");
  });
});

describe("HioBuy fulfillment wallet", () => {
  it("reads the documented balance and transaction fields", () => {
    expect(readHioBuyBalance({ balance: { available: { amount: 500000, currency: "CNY" }, frozen: { amount: 12000, currency: "CNY" }, total: { amount: 512000, currency: "CNY" } } })).toEqual({
      availableFen: 500000,
      frozenFen: 12000,
      totalFen: 512000,
      currency: "CNY",
    });
    const raw = {
      id: "txn_01",
      type: "DEBIT",
      category: "SHIPPING",
      created_at: "2026-10-01T00:00:00Z",
      amount: { amount: 3850, currency: "CNY" },
      balance_after: 500000,
      related_resource: { type: "SHIPMENT", id: "shp_1" },
      description: "Freight",
    };
    const row = readHioBuyTransaction(raw);
    expect(row?.signedAmountFen).toBe(-3850);
    expect(signedAmount("CREDIT", 500000)).toBe(500000);
    expect(signedAmount("REFUND", 100)).toBe(100);
    const page = readHioBuyTransactions({ items: [raw], pagination: { page: 1, page_size: 20, total: 1 } }, 1, 20);
    expect(page.total).toBe(1);
    expect(page.items[0]?.relatedId).toBe("shp_1");
  });
});

describe("timeline", () => {
  it("keeps the warehouse submission time and does not repeat the same event", () => {
    const events = timelineFromSync({
      entity: "shipment",
      audience: "admin",
      milestones: [
        { action: "shipment_create", status: "synced", at: "2026-10-02T00:00:00.000Z", remoteId: "173" },
        { action: "shipment_pay", status: "synced", at: "2026-10-03T00:00:00.000Z", remoteId: "173" },
      ],
      changes: [{ operation: "shipment_status_pull", outcome: "updated", at: "2026-10-04T00:00:00.000Z", previousStatus: "WAIT_PAYMENT", newStatus: "WAIT_SHIP" }],
    });
    const merged = mergeTimeline([{ at: "2026-10-01T00:00:00.000Z", title: "Consolidation submitted", detail: "Created in Forwarding." }, ...events, events[0]!]);
    expect(merged.map((event) => event.title)).toEqual(["Ready to ship", "HioBuy paid", "Submitted to HioBuy", "Consolidation submitted"]);
    expect(timelineFromSync({ entity: "shipment", audience: "customer", milestones: [{ action: "shipment_pay", status: "synced", at: "2026-10-03T00:00:00.000Z", remoteId: "173" }], changes: [] })).toEqual([]);
  });
});

describe("tracking event labels", () => {
  it("uses the preset English label and an admin override, never the upstream title", () => {
    const labels = resolveTrackingLabels(JSON.stringify({ SHIPMENT_DISPATCHED: "Handed to the carrier" }));
    expect(labelTrackingEvent("SHIPMENT_DISPATCHED", labels)).toBe("Handed to the carrier");
    expect(labelTrackingEvent("SHIPMENT_CREATED", labels)).toBe("Shipment created");
    expect(labelTrackingEvent("UNKNOWN_CODE", labels)).toBe("Tracking update");
  });
});

describe("address contact", () => {
  it("sorts countries A to Z and splits a name and calling code", () => {
    const names = countriesByName().map((country) => country.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    expect(splitPersonName("Alex Chen")).toEqual({ firstName: "Alex", lastName: "Chen" });
    expect(splitInternationalPhone("+81 90 1234 5678")).toEqual({ phoneCode: "+81", phone: "90 1234 5678" });
  });
});
