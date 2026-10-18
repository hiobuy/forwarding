/**
 * Fixed Demo Admin catalog. Every figure is derived from this seed.
 * Nothing here is a production customer, payment, or HioBuy call.
 */

import { cnyFenToUsdFen, describeEarning, earningsWindow, formatEarningsWindow, summarizeEarnings, type EarningFact, type EarningRange } from "./earnings";
import { BUSINESS_EMAIL_EVENTS } from "./email";
import { customerUsdFen, type SellingPolicy } from "./freight";
import { ADMIN_SHIPMENT_FILTERS, CARGO_ATTRIBUTES, PACKAGE_FILTERS, PACKAGE_MORE_FILTERS, adminShipmentMatches, adminShipmentStatus, customerPaymentLabel, getPackageDisplayStatus, hiobuyPaymentLabel, packageEligibility, type CargoAttribute, type CustomerShipmentStatus, type PackageLifecycle } from "./status";

export const DEMO_NOW = Date.parse("2026-10-16T15:00:00.000Z");
export const DEMO_SAMPLE_RATES = "Sample rates — Not live shipping quotes";

export const DEMO_PERMISSIONS = [
  "settings.read",
  "payments.read",
  "earnings.read",
  "wallet.read",
  "fulfillment.read",
  "customers.read",
  "packages.read",
  "shipments.read",
] as const;

export const DEMO_PRICING: SellingPolicy = {
  markupBps: 1500,
  markupCnyFen: 500,
  cnyPerUsdE4: 72000,
};

const DAY = 24 * 60 * 60 * 1000;

const FIRST_NAMES = ["Ava", "Noah", "Mia", "Leo", "Sofia", "Ethan", "Isla", "Owen", "Maya", "Luca", "Nora", "Hugo", "Elena", "Felix", "Aria", "Jonas", "Chloe", "Mateo", "Iris", "Adrian"];
const LAST_NAMES = ["Nguyen", "Patel", "Silva", "Rossi", "Kim", "Novak", "Ibrahim", "Costa", "Berg", "Sato", "Dubois", "Keller", "Okeke", "Moreau", "Hansen", "Vogel", "Almeida", "Cho", "Lind", "Pereira"];
const COUNTRIES = ["US", "GB", "DE", "AU", "CA", "FR", "JP", "SG", "NL", "SE"];
const CITIES: Record<string, [string, string, string]> = {
  US: ["Austin", "TX", "78701"],
  GB: ["Manchester", "England", "M1 2WD"],
  DE: ["Hamburg", "Hamburg", "20095"],
  AU: ["Melbourne", "VIC", "3000"],
  CA: ["Toronto", "ON", "M5V 2T6"],
  FR: ["Lyon", "Auvergne-Rhône-Alpes", "69001"],
  JP: ["Osaka", "Osaka", "530-0001"],
  SG: ["Singapore", "Singapore", "018956"],
  NL: ["Rotterdam", "South Holland", "3011 AD"],
  SE: ["Gothenburg", "Västra Götaland", "411 03"],
};

type SyncLabel = "Synced" | "Failed" | "Pending" | "Not synced" | "Needs review";

type PackageSeed = {
  id: string;
  publicId: string;
  ownerIndex: number | null;
  lifecycle: PackageLifecycle;
  condition: "NORMAL" | "EXCEPTION";
  cargo: CargoAttribute;
  weightGrams: number | null;
  sync: SyncLabel;
  vasOpen: boolean;
  createdDaysAgo: number;
};

type ShipKind =
  | "processing"
  | "customer_due"
  | "customer_paid_hiobuy_due"
  | "ready"
  | "shipped"
  | "delivered"
  | "cancelled"
  | "partial";

type ShipSeed = {
  index: number;
  kind: ShipKind;
  paidDaysAgo: number | null;
  costCnyFen: number | null;
  refundUsdFen: number;
  excludeCost: boolean;
};

const SHIP_PLAN: ShipSeed[] = [
  { index: 0, kind: "processing", paidDaysAgo: null, costCnyFen: null, refundUsdFen: 0, excludeCost: false },
  { index: 1, kind: "processing", paidDaysAgo: null, costCnyFen: null, refundUsdFen: 0, excludeCost: false },
  { index: 2, kind: "processing", paidDaysAgo: null, costCnyFen: null, refundUsdFen: 0, excludeCost: false },
  { index: 3, kind: "customer_due", paidDaysAgo: null, costCnyFen: 10000, refundUsdFen: 0, excludeCost: false },
  { index: 4, kind: "customer_due", paidDaysAgo: null, costCnyFen: 10000, refundUsdFen: 0, excludeCost: false },
  { index: 5, kind: "customer_due", paidDaysAgo: null, costCnyFen: 10000, refundUsdFen: 0, excludeCost: false },
  { index: 6, kind: "partial", paidDaysAgo: null, costCnyFen: 10000, refundUsdFen: 0, excludeCost: false },
  { index: 7, kind: "customer_paid_hiobuy_due", paidDaysAgo: 12, costCnyFen: 10000, refundUsdFen: 0, excludeCost: false },
  { index: 8, kind: "customer_paid_hiobuy_due", paidDaysAgo: 12, costCnyFen: 10000, refundUsdFen: 0, excludeCost: false },
  { index: 9, kind: "customer_paid_hiobuy_due", paidDaysAgo: 40, costCnyFen: 10000, refundUsdFen: 0, excludeCost: false },
  { index: 10, kind: "ready", paidDaysAgo: 3, costCnyFen: 10000, refundUsdFen: 0, excludeCost: false },
  { index: 11, kind: "ready", paidDaysAgo: 12, costCnyFen: null, refundUsdFen: 0, excludeCost: true },
  { index: 12, kind: "ready", paidDaysAgo: 40, costCnyFen: 10000, refundUsdFen: 0, excludeCost: false },
  { index: 13, kind: "shipped", paidDaysAgo: 3, costCnyFen: 10000, refundUsdFen: 0, excludeCost: false },
  { index: 14, kind: "shipped", paidDaysAgo: 3, costCnyFen: 10000, refundUsdFen: 0, excludeCost: false },
  { index: 15, kind: "shipped", paidDaysAgo: 3, costCnyFen: 10000, refundUsdFen: 0, excludeCost: false },
  { index: 16, kind: "delivered", paidDaysAgo: 0, costCnyFen: 10000, refundUsdFen: 0, excludeCost: false },
  { index: 17, kind: "delivered", paidDaysAgo: 0, costCnyFen: 10000, refundUsdFen: 0, excludeCost: false },
  { index: 18, kind: "delivered", paidDaysAgo: 12, costCnyFen: 10000, refundUsdFen: 200, excludeCost: false },
  { index: 19, kind: "cancelled", paidDaysAgo: null, costCnyFen: null, refundUsdFen: 0, excludeCost: false },
];

const FREE_PACKAGES: { lifecycle: PackageLifecycle; condition: "NORMAL" | "EXCEPTION"; sync: SyncLabel; vasOpen: boolean }[] = [
  { lifecycle: "PENDING", condition: "NORMAL", sync: "Not synced", vasOpen: false },
  { lifecycle: "PENDING", condition: "NORMAL", sync: "Pending", vasOpen: false },
  { lifecycle: "PENDING", condition: "NORMAL", sync: "Failed", vasOpen: false },
  { lifecycle: "RECEIVED", condition: "NORMAL", sync: "Synced", vasOpen: false },
  { lifecycle: "RECEIVED", condition: "NORMAL", sync: "Synced", vasOpen: true },
  { lifecycle: "RECEIVED", condition: "EXCEPTION", sync: "Needs review", vasOpen: false },
  { lifecycle: "TRANSFERRING", condition: "NORMAL", sync: "Synced", vasOpen: false },
  { lifecycle: "DISCARDED", condition: "NORMAL", sync: "Synced", vasOpen: false },
  { lifecycle: "UNCLAIMED", condition: "NORMAL", sync: "Pending", vasOpen: false },
  { lifecycle: "ARCHIVED", condition: "NORMAL", sync: "Not synced", vasOpen: false },
];

export type DemoOwner = { id: string; name: string; email: string; memberCode: string } | null;

export type DemoPackage = {
  id: string;
  publicId: string;
  ownerId: string;
  owner: DemoOwner;
  domesticTrackingNumber: string;
  courier: string;
  receivedAt: string | null;
  weightGrams: number | null;
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
  volumetricWeightGrams: number | null;
  cargoAttributes: CargoAttribute[];
  packageStatus: string;
  conditionStatus: "NORMAL" | "EXCEPTION";
  displayStatus: { key: string; label: string; tone: "success" | "warning" | "danger" | "info" | "neutral" };
  eligible: boolean;
  ineligibleReason: string | null;
  photoCount: number;
  productName: string | null;
  quantity: number | null;
  declaredValueFen: number | null;
  sellerPlatform: string | null;
  notes: string | null;
  freeStorageDays: number;
  binLocation: string | null;
  freeStorageRemainingDays: number | null;
  storageWarning: boolean;
  storageFeeFen: number;
  exception: null | { id: string; type: string; description: string; message: string; actions: { code: string; label: string }[] };
  vasRequests: { id: string; name: string; code: string; status: string; estimatedFen: number; finalFen: number | null; paymentState: string; createdAt: string; completedAt: string | null }[];
  timeline: { at: string; title: string; detail: string }[];
  createdAt: string;
  hiobuyStatus: string | null;
  hiobuySyncedAt: string | null;
  syncLabel: SyncLabel;
  syncRemoteId: string | null;
  syncReason: string | null;
  canSync: false;
  canPull: false;
};

export type DemoShipment = {
  id: string;
  publicId: string;
  ownerId: string;
  owner: DemoOwner;
  status: CustomerShipmentStatus;
  displayStatus: { key: string; label: string; tone: "success" | "warning" | "danger" | "info" | "neutral" };
  createdAt: string;
  trackingNumber: string | null;
  canCancel: false;
  packingInstruction: string | null;
  packingNote: string | null;
  packageCount: number;
  packages: DemoPackage["id"] extends string
    ? { id: string; publicId: string; domesticTrackingNumber: string; courier: string; weightGrams: number | null; lengthMm: number | null; widthMm: number | null; heightMm: number | null; cargoAttributes: CargoAttribute[] }[]
    : never;
  destination: {
    name: string;
    firstName: string;
    lastName: string;
    email: string;
    company: null;
    phoneCode: string;
    phone: string;
    countryCode: string;
    regionCode: string;
    state: string;
    city: string;
    district: null;
    postalCode: string;
    addressLine1: string;
    addressLine2: null;
  };
  shippingMethod: { routeCode: string; routeName: string; estimatedDaysMin: number; estimatedDaysMax: number; estimatedMinFen: number; estimatedMaxFen: number; currency: "USD"; description: string };
  finalWeightGrams: number | null;
  finalLengthMm: number | null;
  finalWidthMm: number | null;
  finalHeightMm: number | null;
  finalVolumetricWeightGrams: number | null;
  charges: { id: string; type: string; name: string; amountFen: number; currency: string; status: string }[];
  amountFen: number;
  timeline: { at: string; title: string; detail: string }[];
  cartons: { id: string; code: string; status: string; weightGrams: number | null; lengthMm: number | null; widthMm: number | null; heightMm: number | null; trackingNumber: string | null; packages: { id: string; publicId: string; trackingNumber: string | null }[] }[];
  hiobuyShipmentId: string | null;
  hiobuyStatus: string | null;
  hiobuyPaymentStatus: string | null;
  interceptionStatus: string | null;
  hiobuySyncedAt: string | null;
  syncLabel: SyncLabel;
  syncRemoteId: string | null;
  fulfillment: { key: string; label: string; tone: "success" | "warning" | "danger" | "info" | "neutral" };
  customerPayment: string;
  hiobuyPayment: string;
  canPull: false;
  canPayHioBuy: false;
  earning: ReturnType<typeof presentDemoEarning>;
  collectedUsdFen: number | null;
  paidAtMs: number | null;
};

export type DemoWalletTx = {
  id: string;
  userId: string;
  type: string;
  amountFen: number;
  balanceAfter: number;
  description: string;
  referenceId: string | null;
  createdAt: string;
  createdAtMs: number;
};

export type DemoCatalog = {
  now: number;
  customers: {
    id: string;
    name: string;
    email: string;
    memberCode: string;
    country: string;
    status: "active";
    emailVerified: true;
    createdAt: string;
    createdAtMs: number;
    isAdmin: false;
    staffRole: null;
    balanceFen: number;
    packageCount: number;
    shipmentCount: number;
    toPayCount: number;
  }[];
  packages: DemoPackage[];
  shipments: DemoShipment[];
  walletTx: DemoWalletTx[];
  facts: { shipmentId: string; fact: EarningFact }[];
};

function iso(ms: number) {
  return new Date(ms).toISOString();
}

function presentDemoEarning(fact: EarningFact) {
  const view = describeEarning(fact);
  return {
    status: view.status,
    fullyRefunded: view.fullyRefunded,
    customerChargedUsdFen: view.customerChargedUsdFen,
    hiobuyCostCnyFen: view.hiobuyCostCnyFen,
    hiobuyCostUsdFen: view.hiobuyCostUsdFen,
    grossProfitUsdFen: view.grossProfitUsdFen,
    markupBps: view.markupBps,
    markupCnyFen: view.markupCnyFen,
    cnyPerUsdE4: view.cnyPerUsdE4,
    paidAt: view.paidAt ? iso(view.paidAt) : null,
    adjustments: view.adjustments.map((row) => ({
      id: row.id,
      kind: row.kind,
      usdFen: row.kind === "cost" ? null : row.usdFen,
      cnyFen: row.cnyFen,
      note: row.note,
      createdAt: iso(row.createdAt),
    })),
  };
}

function shipShape(kind: ShipKind): { local: CustomerShipmentStatus; remote: string | null; pay: string | null; lifecycle: PackageLifecycle } {
  switch (kind) {
    case "processing":
      return { local: "CONSOLIDATING", remote: "PENDING", pay: "UNPAID", lifecycle: "CONSOLIDATED" };
    case "customer_due":
      return { local: "TO_PAY", remote: "WAIT_PAYMENT", pay: "UNPAID", lifecycle: "CONSOLIDATED" };
    case "partial":
      return { local: "TO_PAY", remote: "WAIT_PAYMENT", pay: "PARTIAL", lifecycle: "CONSOLIDATED" };
    case "customer_paid_hiobuy_due":
      return { local: "READY_TO_SHIP", remote: "WAIT_PAYMENT", pay: "UNPAID", lifecycle: "CONSOLIDATED" };
    case "ready":
      return { local: "READY_TO_SHIP", remote: "WAIT_SHIP", pay: "PAID", lifecycle: "CONSOLIDATED" };
    case "shipped":
      return { local: "IN_TRANSIT", remote: "SHIPPED", pay: "PAID", lifecycle: "SHIPPED" };
    case "delivered":
      return { local: "DELIVERED", remote: "SIGNED", pay: "PAID", lifecycle: "DELIVERED" };
    case "cancelled":
      return { local: "CANCELLED", remote: "CANCELLED", pay: "UNPAID", lifecycle: "CONSOLIDATED" };
  }
}

function syncFor(kind: ShipKind, index: number): SyncLabel {
  if (kind === "cancelled") return "Failed";
  if (index === 2) return "Pending";
  return "Synced";
}

export function buildDemoCatalog(now = DEMO_NOW): DemoCatalog {
  const customers = FIRST_NAMES.map((first, index) => {
    const name = `${first} ${LAST_NAMES[index]}`;
    const createdAtMs = now - (index < 3 ? (index + 1) * DAY : (10 + index) * DAY);
    return {
      id: `demo_user_${String(index + 1).padStart(2, "0")}`,
      name,
      email: `${first}.${LAST_NAMES[index]}@example.com`.toLowerCase(),
      memberCode: `DM${10001 + index}`,
      country: COUNTRIES[index % COUNTRIES.length]!,
      status: "active" as const,
      emailVerified: true as const,
      createdAt: iso(createdAtMs),
      createdAtMs,
      isAdmin: false as const,
      staffRole: null,
      balanceFen: 0,
      packageCount: 0,
      shipmentCount: 0,
      toPayCount: 0,
    };
  });

  const packageSeeds: PackageSeed[] = [];
  SHIP_PLAN.forEach((ship) => {
    const shape = shipShape(ship.kind);
    for (let slot = 0; slot < 2; slot += 1) {
      const n = packageSeeds.length;
      packageSeeds.push({
        id: `demo_pkg_${String(n + 1).padStart(2, "0")}`,
        publicId: `DP${24000 + n}`,
        ownerIndex: ship.index,
        lifecycle: shape.lifecycle,
        condition: "NORMAL",
        cargo: CARGO_ATTRIBUTES[(ship.index + slot) % CARGO_ATTRIBUTES.length]!,
        weightGrams: 400 + ship.index * 35 + slot * 80,
        sync: syncFor(ship.kind, ship.index),
        vasOpen: false,
        createdDaysAgo: 6 + ship.index,
      });
    }
  });
  FREE_PACKAGES.forEach((item, offset) => {
    const n = packageSeeds.length;
    packageSeeds.push({
      id: `demo_pkg_${String(n + 1).padStart(2, "0")}`,
      publicId: `DP${24000 + n}`,
      ownerIndex: item.lifecycle === "UNCLAIMED" ? null : offset % 10,
      lifecycle: item.lifecycle,
      condition: item.condition,
      cargo: CARGO_ATTRIBUTES[offset % CARGO_ATTRIBUTES.length]!,
      weightGrams: item.lifecycle === "PENDING" ? null : 520 + offset * 40,
      sync: item.sync,
      vasOpen: item.vasOpen,
      createdDaysAgo: 2 + offset,
    });
  });

  const packages: DemoPackage[] = packageSeeds.map((seed) => {
    const owner = seed.ownerIndex == null ? null : customers[seed.ownerIndex]!;
    const createdAtMs = now - seed.createdDaysAgo * DAY;
    const received = seed.lifecycle === "PENDING" || seed.lifecycle === "UNCLAIMED" ? null : createdAtMs + DAY;
    const state = {
      packageStatus: seed.lifecycle,
      conditionStatus: seed.condition,
      exceptionStatus: seed.condition === "EXCEPTION" ? "ACTION_REQUIRED" as const : "NONE" as const,
      vasStatus: seed.vasOpen ? "REQUESTED" as const : "NONE" as const,
      lockStatus: "AVAILABLE" as const,
      disposition: "NONE" as const,
    };
    const eligibility = packageEligibility(state);
    const remote = seed.sync === "Synced" || seed.sync === "Needs review" ? `HB-PKG-${seed.publicId}` : null;
    return {
      id: seed.id,
      publicId: seed.publicId,
      ownerId: owner?.id ?? "",
      owner: owner ? { id: owner.id, name: owner.name, email: owner.email, memberCode: owner.memberCode } : null,
      domesticTrackingNumber: `SF${8800000000 + Number(seed.publicId.slice(2))}`,
      courier: "SF Express",
      receivedAt: received ? iso(received) : null,
      weightGrams: seed.weightGrams,
      lengthMm: seed.weightGrams ? 220 : null,
      widthMm: seed.weightGrams ? 160 : null,
      heightMm: seed.weightGrams ? 80 : null,
      volumetricWeightGrams: seed.weightGrams ? Math.round((22 * 16 * 8) / 6) : null,
      cargoAttributes: [seed.cargo],
      packageStatus: seed.lifecycle,
      conditionStatus: seed.condition,
      displayStatus: getPackageDisplayStatus(state),
      eligible: eligibility.eligible,
      ineligibleReason: eligibility.reason,
      photoCount: 0,
      photos: [],
      productName: "Sample goods",
      quantity: 1,
      declaredValueFen: 2500,
      sellerPlatform: "Sample shop",
      notes: null,
      freeStorageDays: 30,
      binLocation: seed.lifecycle === "RECEIVED" || seed.lifecycle === "CONSOLIDATED" ? `A-${String((seed.ownerIndex ?? 0) + 1).padStart(2, "0")}-03` : null,
      freeStorageRemainingDays: received ? 18 : null,
      storageWarning: false,
      storageFeeFen: 0,
      exception: seed.condition === "EXCEPTION"
        ? { id: `${seed.id}_ex`, type: "DAMAGED", description: "Corner of the carton is crushed.", message: "Ask the customer how to continue.", actions: [{ code: "ACCEPT", label: "Accept and continue" }, { code: "SUPPORT", label: "Contact support" }] }
        : null,
      vasRequests: seed.vasOpen
        ? [{ id: `${seed.id}_vas`, name: "Photos", code: "PHOTO", status: "REQUESTED", estimatedFen: 300, finalFen: null, paymentState: "UNPAID", createdAt: iso(createdAtMs), completedAt: null }]
        : [],
      timeline: [{ at: iso(createdAtMs), title: "Inbound notice", detail: "Sample parcel recorded in the demo warehouse." }],
      createdAt: iso(createdAtMs),
      hiobuyStatus: remote ? seed.lifecycle : null,
      hiobuySyncedAt: seed.sync === "Not synced" ? null : iso(createdAtMs + 2 * 60 * 60 * 1000),
      syncLabel: seed.sync,
      syncRemoteId: remote,
      syncReason: seed.sync === "Failed" ? "Sample upstream timeout" : seed.sync === "Needs review" ? "Weight differs from the notice" : null,
      canSync: false,
      canPull: false,
    };
  });

  const facts: DemoCatalog["facts"] = [];
  const walletTx: DemoWalletTx[] = [];
  const shipments: DemoShipment[] = SHIP_PLAN.map((seed) => {
    const shape = shipShape(seed.kind);
    const owner = customers[seed.index]!;
    const linked = packages.filter((item) => item.ownerId === owner.id && item.packageStatus === shape.lifecycle).slice(0, 2);
    const createdAtMs = now - (8 + seed.index) * DAY;
    const paidAtMs = seed.paidDaysAgo == null ? null : seed.paidDaysAgo === 0 ? now - 2 * 60 * 60 * 1000 : now - seed.paidDaysAgo * DAY;
    const billed = seed.costCnyFen == null ? 0 : customerUsdFen(seed.costCnyFen, DEMO_PRICING);
    const collected = seed.kind === "partial" ? Math.round(billed / 2) : paidAtMs != null ? billed : null;
    const fact: EarningFact = {
      paidAt: paidAtMs,
      billedUsdFen: seed.kind === "processing" || seed.kind === "cancelled" ? null : billed,
      collectedUsdFen: collected,
      hiobuyCostCnyFen: seed.excludeCost ? null : seed.costCnyFen,
      markupBps: DEMO_PRICING.markupBps,
      markupCnyFen: DEMO_PRICING.markupCnyFen,
      cnyPerUsdE4: DEMO_PRICING.cnyPerUsdE4,
      costConfirmed: seed.kind === "delivered" && seed.refundUsdFen === 0,
      adjustments: seed.refundUsdFen
        ? [{ id: `demo_adj_${seed.index}`, idempotencyKey: `demo-refund-${seed.index}`, kind: "refund", usdFen: seed.refundUsdFen, cnyFen: null, note: "Sample partial refund", createdAt: (paidAtMs ?? now) + 60 * 60 * 1000 }]
        : [],
    };
    facts.push({ shipmentId: `demo_shp_${String(seed.index + 1).padStart(2, "0")}`, fact });
    const earning = presentDemoEarning(fact);
    const amountFen = collected ?? billed;
    const remoteId = shape.remote ? `HB-SHP-${24000 + seed.index}` : null;
    const fulfillment = adminShipmentStatus({ hiobuyShipmentId: remoteId, upstreamStatus: shape.remote, localStatus: shape.local });
    const city = CITIES[owner.country] ?? CITIES.US!;
    const [first = "Sample", last = "Customer"] = owner.name.split(" ");
    const id = `demo_shp_${String(seed.index + 1).padStart(2, "0")}`;
    const sync = syncFor(seed.kind, seed.index);
    if (collected) {
      walletTx.push({
        id: `demo_tx_pay_${id}`,
        userId: owner.id,
        type: "SHIPMENT_PAYMENT",
        amountFen: -collected,
        balanceAfter: 0,
        description: seed.kind === "partial" ? `Partial freight for ${`HS${78000 + seed.index}`}` : `Freight for HS${78000 + seed.index}`,
        referenceId: id,
        createdAt: iso(paidAtMs ?? createdAtMs + DAY),
        createdAtMs: paidAtMs ?? createdAtMs + DAY,
      });
    }
    if (seed.refundUsdFen) {
      walletTx.push({
        id: `demo_tx_refund_${id}`,
        userId: owner.id,
        type: "REFUND",
        amountFen: seed.refundUsdFen,
        balanceAfter: 0,
        description: `Refund for HS${78000 + seed.index}`,
        referenceId: id,
        createdAt: iso((paidAtMs ?? now) + 60 * 60 * 1000),
        createdAtMs: (paidAtMs ?? now) + 60 * 60 * 1000,
      });
    }
    return {
      id,
      publicId: `HS${78000 + seed.index}`,
      ownerId: owner.id,
      owner: { id: owner.id, name: owner.name, email: owner.email, memberCode: owner.memberCode },
      status: shape.local,
      displayStatus: fulfillment,
      createdAt: iso(createdAtMs),
      trackingNumber: shape.remote === "SHIPPED" || shape.remote === "SIGNED" ? `1ZDEMO${String(seed.index).padStart(6, "0")}` : null,
      canCancel: false,
      packingInstruction: "Keep the two parcels in one carton.",
      packingNote: null,
      packageCount: linked.length,
      packages: linked.map((item) => ({
        id: item.id,
        publicId: item.publicId,
        domesticTrackingNumber: item.domesticTrackingNumber,
        courier: item.courier,
        weightGrams: item.weightGrams,
        lengthMm: item.lengthMm,
        widthMm: item.widthMm,
        heightMm: item.heightMm,
        cargoAttributes: item.cargoAttributes,
      })),
      destination: {
        name: owner.name,
        firstName: first,
        lastName: last,
        email: owner.email,
        company: null,
        phoneCode: "+1",
        phone: `555010${String(seed.index).padStart(2, "0")}`,
        countryCode: owner.country,
        regionCode: owner.country,
        state: city[1],
        city: city[0],
        district: null,
        postalCode: city[2],
        addressLine1: `${10 + seed.index} Sample Street`,
        addressLine2: null,
      },
      shippingMethod: {
        routeCode: seed.index % 2 === 0 ? "DEMO-ECO" : "DEMO-EXP",
        routeName: seed.index % 2 === 0 ? "Sample Economy" : "Sample Express",
        estimatedDaysMin: seed.index % 2 === 0 ? 8 : 4,
        estimatedDaysMax: seed.index % 2 === 0 ? 15 : 7,
        estimatedMinFen: amountFen || billed,
        estimatedMaxFen: (amountFen || billed) + 400,
        currency: "USD",
        description: "Fixed sample channel",
      },
      finalWeightGrams: linked.reduce((sum, item) => sum + (item.weightGrams ?? 0), 0) || null,
      finalLengthMm: 320,
      finalWidthMm: 240,
      finalHeightMm: 140,
      finalVolumetricWeightGrams: 1800,
      charges: amountFen ? [{ id: `${id}_freight`, type: "FREIGHT", name: "International freight", amountFen, currency: "USD", status: paidAtMs ? "PAID" : "DUE" }] : [],
      amountFen,
      timeline: [{ at: iso(createdAtMs), title: "Shipment opened", detail: "Sample consolidation. No warehouse was called." }],
      cartons: [{
        id: `${id}_carton`,
        code: "1",
        status: shape.lifecycle,
        weightGrams: linked.reduce((sum, item) => sum + (item.weightGrams ?? 0), 0) || null,
        lengthMm: 320,
        widthMm: 240,
        heightMm: 140,
        trackingNumber: shape.remote === "SHIPPED" || shape.remote === "SIGNED" ? `1ZDEMO${String(seed.index).padStart(6, "0")}` : null,
        packages: linked.map((item) => ({ id: item.id, publicId: item.publicId, trackingNumber: item.domesticTrackingNumber })),
      }],
      hiobuyShipmentId: remoteId,
      hiobuyStatus: shape.remote,
      hiobuyPaymentStatus: shape.pay,
      interceptionStatus: null,
      hiobuySyncedAt: sync === "Not synced" ? null : iso(createdAtMs + 3 * 60 * 60 * 1000),
      syncLabel: sync,
      syncRemoteId: remoteId,
      fulfillment,
      customerPayment: customerPaymentLabel(shape.local, shape.local === "TO_PAY"),
      hiobuyPayment: hiobuyPaymentLabel(shape.pay),
      canPull: false,
      canPayHioBuy: false,
      photos: [],
      earning,
      collectedUsdFen: collected,
      paidAtMs,
    };
  });

  customers.forEach((customer, index) => {
    const opening = 20000 + index * 250;
    walletTx.push({
      id: `demo_tx_open_${customer.id}`,
      userId: customer.id,
      type: "TOP_UP",
      amountFen: opening,
      balanceAfter: 0,
      description: "Sample wallet credit",
      referenceId: null,
      createdAt: iso(customer.createdAtMs + DAY),
      createdAtMs: customer.createdAtMs + DAY,
    });
  });

  const byUser = new Map<string, DemoWalletTx[]>();
  for (const tx of walletTx) {
    const list = byUser.get(tx.userId) ?? [];
    list.push(tx);
    byUser.set(tx.userId, list);
  }
  for (const [userId, rows] of byUser) {
    rows.sort((a, b) => a.createdAtMs - b.createdAtMs);
    let balance = 0;
    for (const row of rows) {
      balance += row.amountFen;
      row.balanceAfter = balance;
    }
    const customer = customers.find((item) => item.id === userId);
    if (customer) customer.balanceFen = balance;
  }

  for (const customer of customers) {
    const ownedPackages = packages.filter((item) => item.ownerId === customer.id);
    const ownedShips = shipments.filter((item) => item.ownerId === customer.id);
    customer.packageCount = ownedPackages.length;
    customer.shipmentCount = ownedShips.length;
    customer.toPayCount = ownedShips.filter((item) => item.status === "TO_PAY").length;
  }

  return { now, customers, packages, shipments, walletTx, facts };
}

let cached: DemoCatalog | null = null;

export function demoCatalog(): DemoCatalog {
  cached ??= buildDemoCatalog();
  return cached;
}

function paginate<T>(items: T[], page: number, pageSize: number) {
  const current = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const start = (current - 1) * pageSize;
  return { items: items.slice(start, start + pageSize), page: current, pageSize, total: items.length };
}

function includes(text: string, q: string) {
  return !q || text.toLowerCase().includes(q.toLowerCase());
}

function dayBound(raw: string | undefined, end: boolean) {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const start = Date.parse(`${raw}T00:00:00.000Z`);
  if (!Number.isFinite(start)) return null;
  return end ? start + DAY - 1 : start;
}

export function demoOverview(catalog = demoCatalog()) {
  const { packages, shipments, customers, walletTx, now } = catalog;
  const packageFilters = [...PACKAGE_FILTERS.filter((item) => item.key !== "all" && item.key !== "exception"), ...PACKAGE_MORE_FILTERS];
  const since30 = now - 30 * DAY;
  return {
    users: {
      total: customers.length,
      newLast7Days: customers.filter((row) => row.createdAtMs >= now - 7 * DAY).length,
    },
    packages: {
      total: packages.length,
      inWarehouse: packages.filter((pkg) => pkg.receivedAt && !["shipped", "delivered", "discarded", "archived"].includes(pkg.displayStatus.key)).length,
      byStatus: packageFilters.map((item) => ({ key: item.key, label: item.label, count: packages.filter((pkg) => pkg.displayStatus.key === item.key).length })),
    },
    shipments: {
      total: shipments.length,
      toPayFen: shipments.filter((item) => item.status === "TO_PAY").reduce((sum, item) => sum + item.amountFen, 0),
      byStatus: ADMIN_SHIPMENT_FILTERS.filter((item) => item.key !== "all").map((item) => ({
        key: item.key,
        label: item.label,
        count: shipments.filter((shipment) => adminShipmentMatches(shipment.fulfillment, item.key)).length,
      })),
    },
    wallet: {
      balanceFen: customers.reduce((sum, row) => sum + row.balanceFen, 0),
      topUpsLast30DaysFen: walletTx.filter((row) => row.type === "TOP_UP" && row.createdAtMs >= since30).reduce((sum, row) => sum + row.amountFen, 0),
      paymentsLast30DaysFen: -walletTx.filter((row) => row.type === "SHIPMENT_PAYMENT" && row.createdAtMs >= since30).reduce((sum, row) => sum + row.amountFen, 0),
    },
    queues: {
      toReceive: packages.filter((pkg) => pkg.displayStatus.key === "pending").length,
      servicesOpen: packages.filter((pkg) => pkg.vasRequests.some((request) => request.status === "REQUESTED" || request.status === "PROCESSING")).length,
      waitingOnCustomer: packages.filter((pkg) => pkg.conditionStatus === "EXCEPTION").length,
      toPack: shipments.filter((item) => item.fulfillment.key === "pending" || item.fulfillment.key === "local").length,
      toDispatch: shipments.filter((item) => item.fulfillment.key === "wait_ship").length,
      inTransit: shipments.filter((item) => item.fulfillment.key === "shipped").length,
      unclaimed: packages.filter((pkg) => pkg.packageStatus === "UNCLAIMED").length,
      unansweredQuestions: 1,
      publishedAnswers: 1,
      pendingTopups: 2,
      hiobuyPaymentsPending: shipments.filter((item) => item.hiobuyShipmentId && item.hiobuyStatus === "WAIT_PAYMENT" && item.hiobuyPaymentStatus !== "PAID" && (item.status === "READY_TO_SHIP" || item.status === "SHIPPED" || item.status === "IN_TRANSIT" || item.status === "DELIVERED")).length,
    },
  };
}

export function demoEarnings(range: EarningRange, catalog = demoCatalog()) {
  const summary = summarizeEarnings(catalog.facts.map((item) => item.fact), range, catalog.now);
  const window = earningsWindow(range, catalog.now);
  return {
    range,
    timeZone: "UTC" as const,
    start: iso(window.start),
    end: iso(window.end),
    label: formatEarningsWindow(window.start, window.end),
    ...summary,
    untimedShipments: 0,
  };
}

export function demoPackages(query: Record<string, string | undefined>, catalog = demoCatalog()) {
  const status = query.status ?? "all";
  const q = (query.q ?? "").trim();
  const cargo = query.cargo ?? "";
  const link = query.link ?? "all";
  const condition = query.condition ?? "all";
  const vas = query.vas ?? "";
  const from = dayBound(query.from, false);
  const to = dayBound(query.to, true);
  const page = Number(query.page ?? 1);
  const filtered = catalog.packages.filter((item) => {
    const created = Date.parse(item.createdAt);
    if (from != null && created < from) return false;
    if (to != null && created > to) return false;
    if (cargo && !item.cargoAttributes.includes(cargo as CargoAttribute)) return false;
    if (condition === "exception" && item.conditionStatus !== "EXCEPTION") return false;
    if (condition === "normal" && item.conditionStatus !== "NORMAL") return false;
    if (vas === "open" && !item.vasRequests.some((request) => request.status === "REQUESTED" || request.status === "PROCESSING")) return false;
    if ((link === "linked" || link === "synced") && item.syncLabel !== "Synced") return false;
    if ((link === "unlinked" || link === "not_synced") && item.syncLabel !== "Not synced") return false;
    if (link === "pending" && item.syncLabel !== "Pending") return false;
    if (link === "failed" && item.syncLabel !== "Failed") return false;
    if (link === "needs_review" && item.syncLabel !== "Needs review") return false;
    return includes(`${item.publicId} ${item.domesticTrackingNumber} ${item.owner?.name ?? ""} ${item.owner?.email ?? ""} ${item.owner?.memberCode ?? ""}`, q);
  });
  const filters = [...PACKAGE_FILTERS.filter((item) => item.key !== "exception"), ...PACKAGE_MORE_FILTERS];
  const counts = Object.fromEntries(filters.map((filter) => [filter.key, filter.key === "all" ? filtered.length : filtered.filter((item) => item.displayStatus.key === filter.key).length]));
  const statusFiltered = filtered.filter((item) => status === "all" || (status === "exception" ? item.conditionStatus === "EXCEPTION" : item.displayStatus.key === status));
  return { ...paginate(statusFiltered, page, 25), counts };
}

export function demoPackageSync(id: string, catalog = demoCatalog()) {
  const item = catalog.packages.find((pkg) => pkg.id === id);
  if (!item) return null;
  const failed = item.syncLabel === "Failed" || item.syncLabel === "Needs review";
  return {
    label: item.syncLabel,
    canRetry: false,
    remoteId: item.syncRemoteId,
    externalRef: item.publicId,
    reason: item.syncReason,
    errorCode: failed ? "DEMO_SAMPLE" : null,
    errorMessage: item.syncReason,
    attemptCount: item.syncLabel === "Not synced" ? 0 : 1,
    requestId: item.syncLabel === "Not synced" ? null : `demo_req_${item.publicId}`,
    updatedAt: item.hiobuySyncedAt,
    history: item.syncLabel === "Not synced" ? [] : [{
      id: `${item.id}_attempt`,
      attempt: 1,
      httpStatus: failed ? 504 : 200,
      outcome: failed ? "failed" : "synced",
      errorCode: failed ? "DEMO_SAMPLE" : null,
      errorMessage: item.syncReason,
      requestId: `demo_req_${item.publicId}`,
      createdAt: item.hiobuySyncedAt ?? item.createdAt,
    }],
  };
}

export function demoShipments(query: Record<string, string | undefined>, catalog = demoCatalog()) {
  const status = query.status ?? "all";
  const q = (query.q ?? "").trim();
  const country = (query.country ?? "").trim().toUpperCase();
  const link = query.link ?? "all";
  const from = dayBound(query.from, false);
  const to = dayBound(query.to, true);
  const page = Number(query.page ?? 1);
  const filtered = catalog.shipments.filter((item) => {
    const created = Date.parse(item.createdAt);
    if (from != null && created < from) return false;
    if (to != null && created > to) return false;
    if (country && item.destination.countryCode !== country) return false;
    if ((link === "linked" || link === "synced") && item.syncLabel !== "Synced") return false;
    if (link === "failed" && item.syncLabel !== "Failed") return false;
    if (link === "pending" && item.syncLabel !== "Pending") return false;
    return includes(`${item.publicId} ${item.trackingNumber ?? ""} ${item.owner?.name ?? ""} ${item.owner?.email ?? ""} ${item.owner?.memberCode ?? ""}`, q);
  });
  const counts = Object.fromEntries(ADMIN_SHIPMENT_FILTERS.map((filter) => [filter.key, filter.key === "all" ? filtered.length : filtered.filter((item) => adminShipmentMatches(item.fulfillment, filter.key)).length]));
  const statusFiltered = filtered.filter((item) => adminShipmentMatches(item.fulfillment, status));
  return { ...paginate(statusFiltered, page, 25), counts };
}

export function demoShipmentSync(id: string, catalog = demoCatalog()) {
  const item = catalog.shipments.find((shipment) => shipment.id === id);
  if (!item) return null;
  return {
    history: item.syncLabel === "Not synced" ? [] : [{
      id: `${item.id}_sync`,
      operationLabel: item.syncLabel === "Failed" ? "Create shipment" : "Status pull",
      outcome: item.syncLabel === "Failed" ? "failed" : "synced",
      previousStatus: null,
      newStatus: item.hiobuyStatus,
      errorCode: item.syncLabel === "Failed" ? "DEMO_SAMPLE" : null,
      errorMessage: item.syncLabel === "Failed" ? "Sample upstream rejected the cancelled shipment." : null,
      requestId: `demo_req_${item.publicId}`,
      createdAt: item.hiobuySyncedAt ?? item.createdAt,
    }],
  };
}

export function demoUsers(query: Record<string, string | undefined>, catalog = demoCatalog()) {
  const q = (query.q ?? "").trim();
  const page = Number(query.page ?? 1);
  const items = catalog.customers.filter((item) => includes(`${item.name} ${item.email} ${item.memberCode}`, q));
  return paginate(items, page, 25);
}

export function demoUserTransactions(id: string, catalog = demoCatalog()) {
  return catalog.walletTx
    .filter((row) => row.userId === id)
    .sort((a, b) => b.createdAtMs - a.createdAtMs)
    .slice(0, 20)
    .map(({ createdAtMs: _ms, userId: _user, ...row }) => row);
}

export function demoPayments(query: Record<string, string | undefined>, catalog = demoCatalog()) {
  const q = (query.q ?? "").trim();
  const status = (query.status ?? "").trim();
  const from = dayBound(query.from, false);
  const to = dayBound(query.to, true);
  const page = Number(query.page ?? 1);
  const items = catalog.shipments.flatMap((shipment) => {
    if (!shipment.amountFen) return [];
    const paid = shipment.paidAtMs != null;
    const rowStatus = shipment.status === "CANCELLED" ? "failed" : paid ? "paid" : "pending";
    return [{
      id: `demo_pay_${shipment.id}`,
      customer: shipment.owner?.name ?? "Sample customer",
      email: shipment.owner?.email ?? "",
      method: "wallet",
      purpose: "shipment",
      amountFen: shipment.collectedUsdFen ?? shipment.amountFen,
      status: rowStatus,
      hiobuyStatus: shipment.hiobuyPaymentStatus,
      riskStatus: null,
      checkoutId: shipment.publicId,
      createdAt: shipment.paidAtMs ? iso(shipment.paidAtMs) : shipment.createdAt,
      createdAtMs: shipment.paidAtMs ?? Date.parse(shipment.createdAt),
    }];
  }).filter((row) => {
    if (status && row.status !== status) return false;
    if (from != null && row.createdAtMs < from) return false;
    if (to != null && row.createdAtMs > to) return false;
    return includes(`${row.id} ${row.customer} ${row.email} ${row.checkoutId}`, q);
  });
  const result = paginate(items.map(({ createdAtMs: _ms, ...row }) => row), page, 20);
  return { page: result.page, total: result.total, items: result.items };
}

export function demoTopups(catalog = demoCatalog()) {
  return [0, 1].map((index) => {
    const customer = catalog.customers[index]!;
    return {
      id: `demo_topup_${index + 1}`,
      publicId: `BT${900 + index}`,
      userId: customer.id,
      amountFen: 5000 + index * 2500,
      reference: `SAMPLE-${900 + index}`,
      transferDate: iso(catalog.now - DAY),
      proofNote: "Sample transfer. No screenshot is stored.",
      hasProof: false,
      status: "pending",
      customer: customer.name,
      email: customer.email,
      reviewedAt: null,
      reviewNote: null,
      createdAt: iso(catalog.now - DAY),
    };
  });
}

export function demoRefunds(catalog = demoCatalog()) {
  const refunded = catalog.shipments.find((item) => item.earning.adjustments.some((row) => row.kind === "refund"));
  return {
    refunds: refunded ? [{
      id: `demo_refund_${refunded.id}`,
      paymentId: `demo_pay_${refunded.id}`,
      amountFen: refunded.earning.adjustments.find((row) => row.kind === "refund")?.usdFen ?? 0,
      method: "wallet",
      status: "completed",
      note: "Sample partial refund",
      createdAt: refunded.earning.adjustments[0]?.createdAt ?? refunded.createdAt,
    }] : [],
    disputes: [],
  };
}

const QUOTE_COUNTRIES = [
  { code: "US", name: "United States", perKgCnyFen: 2800 },
  { code: "GB", name: "United Kingdom", perKgCnyFen: 3200 },
  { code: "DE", name: "Germany", perKgCnyFen: 3100 },
  { code: "AU", name: "Australia", perKgCnyFen: 3600 },
  { code: "CA", name: "Canada", perKgCnyFen: 3000 },
] as const;

const CARGO_FACTOR: Record<string, number> = {
  GENERAL: 1,
  BATTERY: 1.35,
  MAGNETIC: 1.2,
  LIQUID: 1.5,
  POWDER: 1.45,
  SENSITIVE: 1.4,
};

export function demoCalculatorOptions() {
  return {
    connected: true,
    countries: QUOTE_COUNTRIES.map(({ code, name }) => ({ code, name })),
    attributes: CARGO_ATTRIBUTES.map((code) => ({ code, name: code.charAt(0) + code.slice(1).toLowerCase() })),
    message: DEMO_SAMPLE_RATES,
  };
}

/** Public calculator view of the sample quote. Cost, markup, and profit stay off this object. */
export function publicDemoEstimate(input: { countryCode: string; weightKg: number; attributes?: string[] }) {
  const result = demoQuote({ countryCode: input.countryCode, weightKg: input.weightKg, attribute: input.attributes?.[0] });
  return {
    demo: true as const,
    disclaimer: result.disclaimer,
    quotes: result.quotes.map(({ code, name, description, eta, partial, note, priceUsdFen }) => ({
      code,
      name,
      description,
      eta,
      partial,
      note,
      priceUsdFen,
    })),
  };
}

export function demoQuote(input: { countryCode?: string; weightKg?: number; attribute?: string }) {
  const country = QUOTE_COUNTRIES.find((item) => item.code === (input.countryCode ?? "").toUpperCase()) ?? QUOTE_COUNTRIES[0]!;
  const weight = Math.max(0.1, Number(input.weightKg) || 0);
  const factor = CARGO_FACTOR[(input.attribute ?? "GENERAL").toUpperCase()] ?? 1;
  const economyCost = Math.round(weight * country.perKgCnyFen * factor);
  const channels = [
    { code: "DEMO-ECO", name: "Sample Economy", eta: "8–15 days", multiplier: 1 },
    { code: "DEMO-EXP", name: "Sample Express", eta: "4–7 days", multiplier: 1.45 },
  ];
  return {
    quotes: channels.map((channel) => {
      const costCnyFen = Math.round(economyCost * channel.multiplier);
      const priceUsdFen = customerUsdFen(costCnyFen, DEMO_PRICING);
      const costUsdFen = cnyFenToUsdFen(costCnyFen, DEMO_PRICING.cnyPerUsdE4) ?? 0;
      return {
        code: channel.code,
        name: channel.name,
        description: "Fixed sample rate for this demo. It cannot be purchased.",
        eta: channel.eta,
        partial: false,
        note: DEMO_SAMPLE_RATES,
        priceUsdFen,
        costCnyFen,
        markupCnyFen: costCnyFen,
        profitUsdFen: priceUsdFen - costUsdFen,
        cnyPerUsdE4: DEMO_PRICING.cnyPerUsdE4,
      };
    }),
    disclaimer: DEMO_SAMPLE_RATES,
  };
}

export function demoChannel(code: string, country: string) {
  const match = demoQuote({ countryCode: country, weightKg: 1, attribute: "GENERAL" }).quotes.find((item) => item.code === code) ?? demoQuote({ countryCode: country, weightKg: 1, attribute: "GENERAL" }).quotes[0]!;
  return {
    code: match.code,
    name: match.name,
    description: `${DEMO_SAMPLE_RATES} ${match.name} to ${country || "the sample destination"} is not a live HioBuy quote.`,
    delivery: ["Door to door"],
    range: "0.1–30 kg",
    volumetric: "Length × width × height (cm) / 6000",
    regions: [{ name: "Sample region", eta: match.eta }],
    restrictions: ["Sample data only"],
    services: [],
    rates: null,
  };
}

export function demoSettings() {
  return {
    connection: { configured: true, hint: "Sample key · not a live credential" },
    connected: true,
    sync: { syncedAt: iso(DEMO_NOW - DAY) },
    warehouse: {
      name: "Sample Dongguan warehouse",
      phone: "+86 769 0000 0000",
      recipient: "HioBuy Forwarding Demo",
      province: "Guangdong",
      city: "Dongguan",
      district: "Nancheng",
      street: "88 Sample Road",
      postalCode: "523000",
      country: "CN",
      hours: "Mon–Sat 09:00–18:00 CST",
      supportedDestinations: QUOTE_COUNTRIES.map((item) => item.code),
      notice: "This address is fictional. Do not ship real parcels here.",
      syncedAt: iso(DEMO_NOW - DAY),
    },
    countries: QUOTE_COUNTRIES.map((item) => ({ code: item.code, name: item.name, enabled: true })),
    pricing: { markupBps: DEMO_PRICING.markupBps, markupCnyFen: DEMO_PRICING.markupCnyFen, cnyPerUsdE4: DEMO_PRICING.cnyPerUsdE4 },
    autoSyncPackages: false,
  };
}

export function demoBusiness() {
  const stored = {
    name: "Northwind Forwarding",
    legalName: "Northwind Forwarding Demo LLC",
    email: "hello@example.com",
    supportEmail: "support@example.com",
    phone: "+1 555 0100",
    country: "United States",
    address: "100 Sample Avenue, Austin, TX 78701",
    description: "Fictional company profile used only in Demo Admin.",
    primaryColor: "#4F46E5",
    accentColor: "",
    publicUrl: "https://example.com",
    appUrl: "https://example.com",
    supportUrl: "https://example.com/support",
    privacyUrl: "https://example.com/privacy",
    termsUrl: "https://example.com/terms",
    browserTitle: "Northwind Forwarding",
    metaDescription: "Sample storefront description.",
  };
  return {
    stored,
    brand: { name: stored.name },
    appUrlTrusted: false,
    linkOrigin: "https://example.com",
    requestOrigin: "https://example.com",
    logos: { primary: false, square: false, favicon: false },
    updatedAt: DEMO_NOW - DAY,
    audit: [{ id: "demo_audit_business", actor: "owner@example.com", summary: "Sample profile published", createdAt: iso(DEMO_NOW - 2 * DAY) }],
  };
}

export function demoWalletBalance() {
  const shipping = demoCatalog().shipments.filter((item) => item.hiobuyPaymentStatus === "PAID").reduce((sum, item) => sum + (item.earning.hiobuyCostCnyFen ?? 0), 0);
  return {
    connected: true as const,
    fetchedAt: iso(DEMO_NOW),
    balance: { availableFen: 2500000 - shipping, frozenFen: 120000, totalFen: 2620000 - shipping, currency: "CNY" },
  };
}

export function demoWalletTransactions(query: Record<string, string | undefined>) {
  const catalog = demoCatalog();
  const paid = catalog.shipments.filter((item) => item.hiobuyPaymentStatus === "PAID" && item.earning.hiobuyCostCnyFen);
  let balance = 2500000;
  const items = paid.map((item) => {
    const amount = -(item.earning.hiobuyCostCnyFen ?? 0);
    const before = balance;
    balance += amount;
    return {
      id: `demo_hb_tx_${item.id}`,
      type: "SHIPPING",
      category: "SHIPPING",
      invoiceStatus: null,
      createdAt: item.earning.paidAt,
      amountFen: amount,
      signedAmountFen: amount,
      balanceAfterFen: balance,
      balanceBeforeFen: before,
      relatedType: "shipment",
      relatedId: item.hiobuyShipmentId,
      description: `Sample HioBuy freight ${item.publicId}`,
      localShipmentId: item.id,
      createdAtMs: item.paidAtMs ?? catalog.now,
    };
  });
  const category = query.category ?? "";
  const from = dayBound(query.from, false);
  const to = dayBound(query.to, true);
  const matched = items.filter((item) => {
    if (category && item.category !== category) return false;
    if (from != null && item.createdAtMs < from) return false;
    if (to != null && item.createdAtMs > to) return false;
    return true;
  });
  const visible = matched.length ? matched : category ? [] : items;
  const page = paginate(visible.map(({ createdAtMs: _ms, ...row }) => row), Number(query.page ?? 1), 20);
  return { ...page, total: page.total, from: query.from ?? "", to: query.to ?? "" };
}

export function demoMe(user: { email: string; name: string }, githubUrl: string | null) {
  return {
    email: user.email,
    name: user.name,
    role: "demo" as const,
    permissions: [...DEMO_PERMISSIONS],
    mfaEnabled: false,
    githubUrl,
  };
}

export function demoTeam() {
  return {
    members: [
      { userId: "demo_staff_owner", name: "Sample Owner", email: "owner@example.com", role: "owner" as const, status: "active", lastLoginAt: iso(DEMO_NOW - 2 * 60 * 60 * 1000) },
      { userId: "demo_staff_manager", name: "Sample Manager", email: "manager@example.com", role: "manager" as const, status: "active", lastLoginAt: iso(DEMO_NOW - DAY) },
      { userId: "demo_staff_support", name: "Sample Support", email: "support@example.com", role: "support" as const, status: "active", lastLoginAt: iso(DEMO_NOW - 3 * DAY) },
    ],
    invites: [],
    audit: [{ id: "demo_team_audit", actorEmail: "owner@example.com", action: "team.sample", target: "manager@example.com", createdAt: iso(DEMO_NOW - 5 * DAY) }],
  };
}

export function demoEmailSmtp() {
  return {
    configured: true,
    host: "smtp.example.com",
    port: 587,
    encryption: "starttls" as const,
    username: "demo@example.com",
    passwordSet: true,
    passwordFromEnvironment: false,
    senderName: "Northwind Forwarding",
    senderNameFallback: "Northwind Forwarding",
    senderEmail: "noreply@example.com",
    replyTo: "support@example.com",
    platformName: "Northwind Forwarding",
    hostFromEnvironment: false,
  };
}

export function demoEmailTemplates() {
  return [
    { id: "package_received", name: "Package received", variables: ["name", "platformName"], subject: "Your parcel arrived", body: "Hello {{name}},\n\nA sample parcel is in the demo warehouse.", customized: false },
    { id: "payment_due", name: "Payment due", variables: ["name"], subject: "Freight is ready to pay", body: "Hello {{name}},\n\nThis is a sample payment reminder.", customized: false },
  ];
}

export function demoEmailRules() {
  return {
    security: [
      { event: "email.verification", label: "Email verification", required: true },
      { event: "password.reset", label: "Password reset", required: true },
    ],
    business: BUSINESS_EMAIL_EVENTS.map((item) => ({ event: item.event, label: item.label, enabled: true })),
  };
}

export function demoEmailLogs() {
  const catalog = demoCatalog();
  const items = catalog.customers.slice(0, 4).map((customer, index) => ({
    id: `demo_mail_${index + 1}`,
    to: customer.email,
    event: index % 2 === 0 ? "package.received" : "shipment.payment_due",
    subject: index % 2 === 0 ? "Your parcel arrived" : "Freight is ready to pay",
    relatedType: "demo",
    relatedId: customer.memberCode,
    status: "sent",
    attempts: 1,
    lastError: null,
    createdAt: iso(DEMO_NOW - (index + 1) * DAY),
    sentAt: iso(DEMO_NOW - (index + 1) * DAY),
  }));
  return { items, page: 1, total: items.length };
}

export function demoPaymentSettings() {
  return {
    stripeEnabled: true,
    stripeMode: "test" as const,
    publishableKey: "pk_test_sample_not_a_real_key",
    secretSet: true,
    webhookSet: true,
    cardTopupEnabled: true,
    minTopupFen: 1000,
    maxTopupFen: 50000,
    dailyTopupFen: 100000,
    bankEnabled: true,
    bankName: "Sample Bank",
    accountHolder: "Northwind Forwarding Demo",
    accountNumber: "0000000000",
    swift: "SAMPLXXX",
    bankCountry: "US",
    bankCurrency: "USD",
    bankInstructions: "Sample instructions. Transfers are not reviewed in demo mode.",
    status: { stripe: "sample", bank: "sample", cardTopup: "sample" },
  };
}

export function demoAssistant() {
  const catalog = demoCatalog();
  const asker = catalog.customers[0]!;
  return {
    open: [{
      id: "demo_q_1",
      question: "How long does the sample economy channel take?",
      askedBy: [{ memberCode: asker.memberCode, name: asker.name }],
      ids: ["demo_q_1"],
      lastAskedAt: iso(DEMO_NOW - 2 * DAY),
    }],
    answers: [{
      id: "demo_a_1",
      question: "Where is the warehouse?",
      answer: "The demo warehouse address is fictional. A production workspace shows the address returned by HioBuy.",
      keywords: "warehouse address",
      status: "published" as const,
      updatedAt: iso(DEMO_NOW - 3 * DAY),
    }],
  };
}

export function demoInvoicing() {
  return {
    businessName: "Northwind Forwarding Demo LLC",
    businessAddress: "100 Sample Avenue, Austin, TX 78701",
    countryRegion: "United States",
    taxId: "",
    contactEmail: "billing@example.com",
    invoicePrefix: "DEMO",
    invoiceFooter: "Sample invoice. Not a tax document.",
    paymentInstructions: "Do not pay this sample invoice.",
    defaultCurrency: "USD",
    taxRateBps: 0,
    hasLogo: false,
    seller: { businessName: "Northwind Forwarding Demo LLC", businessAddress: "100 Sample Avenue, Austin, TX 78701", countryRegion: "United States", contactEmail: "billing@example.com" },
    fromBusiness: true,
  };
}

export function demoDocuments() {
  return {
    documents: [],
    capabilities: { proforma: false, shippingInvoice: false, receipt: false },
    sellerReady: true,
    profiles: [],
  };
}

export function demoTracking(id: string, catalog = demoCatalog()) {
  const shipment = catalog.shipments.find((item) => item.id === id);
  if (!shipment) return null;
  const events = shipment.hiobuyStatus === "SIGNED" || shipment.hiobuyStatus === "SHIPPED"
    ? [
        { at: shipment.createdAt, title: "Dispatched", location: "Sample hub" },
        ...(shipment.hiobuyStatus === "SIGNED" ? [{ at: iso(DEMO_NOW - 60 * 60 * 1000), title: "Delivered", location: shipment.destination.city }] : []),
      ]
    : [];
  return { available: Boolean(shipment.trackingNumber), trackingNumber: shipment.trackingNumber, carrier: shipment.trackingNumber ? "Sample Carrier" : null, events };
}

/** Read endpoints the demo UI may call. Anything else is denied, including every write except the local quote. */
export function demoAccess(method: string, path: string): "read" | "quote" | "deny" {
  const verb = method.toUpperCase();
  const normalized = path.split("?")[0] ?? "/";
  if (verb === "POST" && normalized === "/calculator") return "quote";
  if (verb !== "GET" && verb !== "HEAD") return "deny";
  const reads = [
    /^\/status$/,
    /^\/me$/,
    /^\/overview$/,
    /^\/earnings$/,
    /^\/packages$/,
    /^\/packages\/[^/]+$/,
    /^\/packages\/[^/]+\/sync$/,
    /^\/vas\/catalog$/,
    /^\/shipments$/,
    /^\/shipments\/[^/]+$/,
    /^\/shipments\/[^/]+\/sync$/,
    /^\/shipments\/[^/]+\/tracking$/,
    /^\/shipments\/[^/]+\/documents$/,
    /^\/shipments\/[^/]+\/hiobuy-pay$/,
    /^\/users$/,
    /^\/users\/[^/]+\/transactions$/,
    /^\/payments$/,
    /^\/payments\/settings$/,
    /^\/payments\/topups$/,
    /^\/payments\/refunds$/,
    /^\/assistant$/,
    /^\/team$/,
    /^\/calculator\/options$/,
    /^\/calculator\/channel$/,
    /^\/settings$/,
    /^\/settings\/business$/,
    /^\/settings\/hiobuy-wallet$/,
    /^\/settings\/hiobuy-wallet\/transactions$/,
    /^\/settings\/hiobuy-wallet\/transactions\/[^/]+$/,
    /^\/settings\/tracking-events$/,
    /^\/settings\/invoicing$/,
    /^\/settings\/fulfillment-sync$/,
    /^\/settings\/hiobuy-webhook$/,
    /^\/email\/smtp$/,
    /^\/email\/templates$/,
    /^\/email\/rules$/,
    /^\/email\/logs$/,
  ];
  return reads.some((rule) => rule.test(normalized)) ? "read" : "deny";
}
