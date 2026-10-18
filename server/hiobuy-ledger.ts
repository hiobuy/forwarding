import { eq } from "drizzle-orm";
import { readHioBuyBalance, readHioBuyTransaction, readHioBuyTransactions, type HioBuyTransaction } from "../src/domain/hiobuy-wallet";
import type { Database } from "./db/client";
import { shipments } from "./db/schema";
import { AppError } from "./errors";
import { fulfillmentConnected, resolveHioBuyToken } from "./freight";
import { fetchFulfillmentBalance, fetchFulfillmentTransaction, fetchFulfillmentTransactions } from "./services/hiobuy/wallet";

const CATEGORIES = new Set(["TOP_UP", "PROCUREMENT", "SHIPPING", "VALUE_ADDED_SERVICE", "RETURN", "STORAGE", "TRANSFER", "REFUND", "MANUAL_ADJUSTMENT", "OTHER"]);

export async function hioBuyBalanceView(db: Database, envToken: string | undefined) {
  const token = await requireToken(db, envToken);
  const balance = readHioBuyBalance(await fetchFulfillmentBalance(token));
  if (!balance) throw new AppError("UPSTREAM_ERROR", "HioBuy returned a balance response without an available amount.", 502);
  return { connected: true as const, balance, fetchedAt: new Date().toISOString() };
}

export async function hioBuyTransactionsView(db: Database, envToken: string | undefined, query: { category?: string; from?: string; to?: string; page?: number }) {
  const token = await requireToken(db, envToken);
  const range = dateRange(query.from, query.to);
  const category = query.category && CATEGORIES.has(query.category) ? query.category : undefined;
  if (query.category && !category) throw new AppError("VALIDATION_ERROR", "That transaction type is not supported.");
  const page = Math.max(1, query.page ?? 1);
  const pageSize = 20;
  const payload = await fetchFulfillmentTransactions(token, { category, createdFrom: range.from, createdTo: range.to, page, pageSize });
  const listed = readHioBuyTransactions(payload, page, pageSize);
  const links = await shipmentLinks(db, listed.items);
  return { ...listed, from: range.from.slice(0, 10), to: range.to.slice(0, 10), items: listed.items.map((item) => withLink(item, links)) };
}

export async function hioBuyTransactionView(db: Database, envToken: string | undefined, id: string) {
  const token = await requireToken(db, envToken);
  const transactionId = id.trim();
  if (!transactionId || transactionId.length > 80) throw new AppError("VALIDATION_ERROR", "That transaction was not found.");
  const row = readHioBuyTransaction(await fetchFulfillmentTransaction(token, transactionId));
  if (!row) throw new AppError("UPSTREAM_ERROR", "HioBuy returned a transaction without an id.", 502);
  const links = await shipmentLinks(db, [row]);
  return withLink(row, links);
}

async function requireToken(db: Database, envToken: string | undefined) {
  if (!(await fulfillmentConnected(db))) throw new AppError("UPSTREAM_ERROR", "Connect HioBuy before opening the fulfillment wallet.", 409);
  const token = await resolveHioBuyToken(db, envToken);
  if (!token) throw new AppError("UPSTREAM_ERROR", "Add a HioBuy API key before opening the fulfillment wallet.", 409);
  return token;
}

function dateRange(from: string | undefined, to: string | undefined) {
  const end = validDay(to) ?? new Date().toISOString().slice(0, 10);
  const start = validDay(from) ?? new Date(Date.now() - 29 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return { from: `${start}T00:00:00.000Z`, to: `${end}T23:59:59.999Z` };
}

function validDay(value: string | undefined) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

async function shipmentLinks(db: Database, items: HioBuyTransaction[]) {
  const links = new Map<string, string>();
  for (const item of items) {
    if (item.relatedType !== "SHIPMENT" || !item.relatedId || links.has(item.relatedId)) continue;
    const row = (await db.select({ id: shipments.id }).from(shipments).where(eq(shipments.hiobuyShipmentId, item.relatedId)))[0];
    if (row) links.set(item.relatedId, row.id);
  }
  return links;
}

function withLink(item: HioBuyTransaction, links: Map<string, string>) {
  return { ...item, localShipmentId: item.relatedId ? links.get(item.relatedId) ?? null : null };
}
