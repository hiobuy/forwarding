import { Hono } from "hono";
import { demoAccess, demoAssistant, demoBusiness, demoCalculatorOptions, demoCatalog, demoChannel, demoDocuments, demoEarnings, demoEmailLogs, demoEmailRules, demoEmailSmtp, demoEmailTemplates, demoInvoicing, demoMe, demoOverview, demoPackageSync, demoPackages, demoPaymentSettings, demoPayments, demoQuote, demoRefunds, demoSettings, demoShipmentSync, demoShipments, demoTeam, demoTopups, demoTracking, demoUserTransactions, demoUsers, demoWalletBalance, demoWalletTransactions, type DemoCatalog } from "../src/domain/demo";
import type { EarningRange } from "../src/domain/earnings";
import { DEFAULT_TRACKING_EVENT_LABELS } from "../src/domain/tracking-events";
import type { WorkerBindings } from "./auth";
import { AppError } from "./errors";
import { vasCatalog } from "../src/mocks/vas";

type DemoEnv = {
  Bindings: WorkerBindings;
  Variables: { requestId: string; user: { id: string; name: string; email: string } };
};

export function demoEnabled(env: { DEMO_MODE?: string }) {
  return env.DEMO_MODE === "true";
}

const DEFAULT_GITHUB_REPO = "https://github.com/hiobuy/forwarding";

export function githubRepoUrl(env: { GITHUB_REPO_URL?: string }) {
  const value = env.GITHUB_REPO_URL?.trim() || DEFAULT_GITHUB_REPO;
  if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/?$/.test(value)) return null;
  return value.replace(/\/$/, "");
}

function demoPath(path: string) {
  const clean = path.split("?")[0] ?? "/";
  const marker = "/api/demo";
  const index = clean.indexOf(marker);
  const rest = (index >= 0 ? clean.slice(index + marker.length) : clean) || "/";
  return rest.length > 1 && rest.endsWith("/") ? rest.slice(0, -1) : rest;
}

function ok(c: { json: (body: unknown) => Response; get: (key: "requestId") => string }, data: unknown) {
  return c.json({ data, requestId: c.get("requestId") });
}

export const demo = new Hono<DemoEnv>();

demo.onError((error, c) => {
  if (error instanceof AppError) {
    return c.json({ error: { code: error.code, message: error.message, details: error.details ?? null }, requestId: c.get("requestId") }, error.status as 400);
  }
  return c.json({ error: { code: "INTERNAL", message: "Something went wrong. Please try again." } }, 500);
});

demo.all("*", async (c) => {
  const rel = demoPath(c.req.path);
  const enabled = demoEnabled(c.env);
  if (rel === "/status") return ok(c, { enabled, githubUrl: enabled ? githubRepoUrl(c.env) : null });
  if (!enabled) throw new AppError("NOT_FOUND", "Not found.", 404);
  const access = demoAccess(c.req.method, rel);
  if (access === "deny") {
    if (c.req.method === "GET" || c.req.method === "HEAD") throw new AppError("NOT_FOUND", "Not found.", 404);
    throw new AppError("DEMO_READONLY", "Demo mode is read-only. This change is not saved.", 403);
  }
  if (access === "quote") {
    const body = await c.req.json().catch(() => ({}));
    const record = body && typeof body === "object" ? body as { countryCode?: string; weightKg?: number; attribute?: string } : {};
    return ok(c, demoQuote(record));
  }
  const catalog = demoCatalog();
  const query = Object.fromEntries(new URL(c.req.url).searchParams);
  const data = readDemo(rel, query, catalog, c.get("user"), githubRepoUrl(c.env));
  if (data === undefined) throw new AppError("NOT_FOUND", "Not found.", 404);
  return ok(c, data);
});

function readDemo(path: string, query: Record<string, string | undefined>, catalog: DemoCatalog, user: { email: string; name: string }, githubUrl: string | null): unknown {
  if (path === "/me") return demoMe(user, githubUrl);
  if (path === "/overview") return demoOverview(catalog);
  if (path === "/earnings") {
    const range: EarningRange = query.range === "today" || query.range === "7d" || query.range === "30d" ? query.range : "30d";
    return demoEarnings(range, catalog);
  }
  if (path === "/packages") return demoPackages(query, catalog);
  const packageSync = path.match(/^\/packages\/([^/]+)\/sync$/);
  if (packageSync) return demoPackageSync(decodeURIComponent(packageSync[1]!), catalog);
  const packageOne = path.match(/^\/packages\/([^/]+)$/);
  if (packageOne) return catalog.packages.find((item) => item.id === decodeURIComponent(packageOne[1]!)) ?? undefined;
  if (path === "/vas/catalog") return vasCatalog;
  if (path === "/shipments") return demoShipments(query, catalog);
  const shipmentSync = path.match(/^\/shipments\/([^/]+)\/sync$/);
  if (shipmentSync) return demoShipmentSync(decodeURIComponent(shipmentSync[1]!), catalog);
  const shipmentTrack = path.match(/^\/shipments\/([^/]+)\/tracking$/);
  if (shipmentTrack) return demoTracking(decodeURIComponent(shipmentTrack[1]!), catalog);
  const shipmentDocs = path.match(/^\/shipments\/([^/]+)\/documents$/);
  if (shipmentDocs) return catalog.shipments.some((item) => item.id === decodeURIComponent(shipmentDocs[1]!)) ? demoDocuments() : undefined;
  const shipmentPay = path.match(/^\/shipments\/([^/]+)\/hiobuy-pay$/);
  if (shipmentPay) {
    const shipment = catalog.shipments.find((item) => item.id === decodeURIComponent(shipmentPay[1]!));
    if (!shipment) return undefined;
    return { payable: false, amountFen: shipment.earning.hiobuyCostCnyFen ?? 0, message: "Demo mode cannot pay HioBuy." };
  }
  const shipmentOne = path.match(/^\/shipments\/([^/]+)$/);
  if (shipmentOne) return catalog.shipments.find((item) => item.id === decodeURIComponent(shipmentOne[1]!)) ?? undefined;
  if (path === "/users") return demoUsers(query, catalog);
  const txs = path.match(/^\/users\/([^/]+)\/transactions$/);
  if (txs) return catalog.customers.some((item) => item.id === decodeURIComponent(txs[1]!)) ? demoUserTransactions(decodeURIComponent(txs[1]!), catalog) : undefined;
  if (path === "/payments") return demoPayments(query, catalog);
  if (path === "/payments/settings") return demoPaymentSettings();
  if (path === "/payments/topups") return demoTopups(catalog);
  if (path === "/payments/refunds") return demoRefunds(catalog);
  if (path === "/assistant") return demoAssistant();
  if (path === "/team") return demoTeam();
  if (path === "/calculator/options") return demoCalculatorOptions();
  if (path === "/calculator/channel") return demoChannel(query.code ?? "", (query.country ?? "").toUpperCase());
  if (path === "/settings") return demoSettings();
  if (path === "/settings/business") return demoBusiness();
  if (path === "/settings/hiobuy-wallet") return demoWalletBalance();
  if (path === "/settings/hiobuy-wallet/transactions") return demoWalletTransactions(query);
  const walletTx = path.match(/^\/settings\/hiobuy-wallet\/transactions\/([^/]+)$/);
  if (walletTx) {
    const page = demoWalletTransactions({});
    return page.items.find((item) => item.id === decodeURIComponent(walletTx[1]!)) ?? undefined;
  }
  if (path === "/settings/tracking-events") return { labels: DEFAULT_TRACKING_EVENT_LABELS };
  if (path === "/settings/invoicing") return demoInvoicing();
  if (path === "/settings/fulfillment-sync") return { paused: null, counts: {}, webhookConfigured: false, items: [] };
  if (path === "/settings/hiobuy-webhook") {
    const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
    return {
      configured: true,
      rejectedAt: null,
      balanceAlert: null,
      events: [
        { id: "evt_demo_3", type: "shipment.dispatched", livemode: true, status: "processed", outcome: "SHP-20481 in transit (YT2291045871).", error: null, receivedAt: ago(12) },
        { id: "evt_demo_2", type: "shipment.ready_for_payment", livemode: true, status: "processed", outcome: "SHP-20481 billed 48.60 USD.", error: null, receivedAt: ago(95) },
        { id: "evt_demo_1", type: "package.received", livemode: true, status: "processed", outcome: "PKG-10233 marked RECEIVED.", error: null, receivedAt: ago(240) },
        { id: "evt_test_demo", type: "package.received", livemode: false, status: "processed", outcome: "No matching local package.", error: null, receivedAt: ago(600) },
      ],
    };
  }
  if (path === "/email/smtp") return demoEmailSmtp();
  if (path === "/email/templates") return demoEmailTemplates();
  if (path === "/email/rules") return demoEmailRules();
  if (path === "/email/logs") return demoEmailLogs();
  return undefined;
}
