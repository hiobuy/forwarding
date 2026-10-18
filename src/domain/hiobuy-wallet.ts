/** Documented fulfillment wallet fields. Amounts are CNY fen. */

export type HioBuyBalance = {
  availableFen: number;
  frozenFen: number | null;
  totalFen: number | null;
  currency: string;
};

export type HioBuyTransaction = {
  id: string;
  type: string | null;
  category: string | null;
  invoiceStatus: string | null;
  createdAt: string | null;
  amountFen: number | null;
  signedAmountFen: number | null;
  balanceAfterFen: number | null;
  balanceBeforeFen: number | null;
  relatedType: string | null;
  relatedId: string | null;
  description: string | null;
};

export type HioBuyTransactionPage = {
  items: HioBuyTransaction[];
  page: number;
  pageSize: number;
  total: number | null;
};

export function readHioBuyBalance(payload: unknown): HioBuyBalance | null {
  const root = asRecord(payload);
  const balance = asRecord(root?.balance) ?? root;
  const available = moneyFen(balance?.available);
  if (available == null) return null;
  const currency = moneyCurrency(balance?.available) ?? "CNY";
  return {
    availableFen: available,
    frozenFen: moneyFen(balance?.frozen),
    totalFen: moneyFen(balance?.total),
    currency,
  };
}

export function readHioBuyTransactions(payload: unknown, fallbackPage: number, fallbackPageSize: number): HioBuyTransactionPage {
  const root = asRecord(payload);
  const items = transactionList(root).flatMap((item) => {
    const row = readHioBuyTransaction(item);
    return row ? [row] : [];
  });
  const pagination = asRecord(root?.pagination);
  const page = integerOf(pagination?.page) ?? fallbackPage;
  const pageSize = integerOf(pagination?.page_size) ?? fallbackPageSize;
  const total = integerOf(pagination?.total);
  return { items, page, pageSize, total };
}

export function readHioBuyTransaction(payload: unknown): HioBuyTransaction | null {
  const row = asRecord(payload);
  const id = text(row?.id);
  if (!row || !id) return null;
  const amountFen = moneyFen(row.amount);
  const type = text(row.type) || null;
  return {
    id,
    type,
    category: text(row.category) || null,
    invoiceStatus: text(row.invoice_status) || null,
    createdAt: text(row.created_at) || null,
    amountFen,
    signedAmountFen: amountFen == null ? null : signedAmount(type, amountFen),
    balanceAfterFen: moneyFen(row.balance_after),
    balanceBeforeFen: moneyFen(row.balance_before),
    relatedType: text(asRecord(row.related_resource)?.type) || null,
    relatedId: text(asRecord(row.related_resource)?.id) || null,
    description: text(row.description) || null,
  };
}

/** CREDIT and REFUND add funds. DEBIT removes them. ADJUSTMENT keeps the sign returned by the API. */
export function signedAmount(type: string | null, amountFen: number): number {
  const abs = Math.abs(Math.round(amountFen));
  if (type === "DEBIT") return -abs;
  if (type === "CREDIT" || type === "REFUND") return abs;
  return Math.round(amountFen);
}

function transactionList(root: Record<string, unknown> | null): unknown[] {
  if (!root) return [];
  if (Array.isArray(root.items)) return root.items;
  if (Array.isArray(root.transactions)) return root.transactions;
  if (Array.isArray(root.data)) return root.data;
  const data = asRecord(root.data);
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.transactions)) return data.transactions;
  return [];
}

function moneyFen(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  const record = asRecord(value);
  if (record && typeof record.amount === "number" && Number.isFinite(record.amount)) return Math.round(record.amount);
  return null;
}

function moneyCurrency(value: unknown): string | null {
  const currency = text(asRecord(value)?.currency);
  return currency || null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function integerOf(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}
