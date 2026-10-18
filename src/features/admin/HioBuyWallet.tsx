import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { formatCnyFen } from "../../domain/freight";
import { formatDateTime } from "../../domain/dates";
import { Button, Dialog, ErrorState, LoadingBlock } from "../../components/ui";
import { Panel, RowsSkeleton, filterControl } from "./shared";
import { ApiError, api } from "../../lib/api";
import { cn } from "../../lib/utils";

type Balance = { connected: true; fetchedAt: string; balance: { availableFen: number; frozenFen: number | null; totalFen: number | null; currency: string } };
type Transaction = {
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
  localShipmentId: string | null;
};
type Page = { items: Transaction[]; page: number; pageSize: number; total: number | null; from: string; to: string };

const categories = [
  ["", "All types"],
  ["TOP_UP", "Wallet top-up"],
  ["SHIPPING", "Shipping payment"],
  ["REFUND", "Refund"],
  ["MANUAL_ADJUSTMENT", "Adjustment"],
  ["PROCUREMENT", "Procurement payment"],
  ["VALUE_ADDED_SERVICE", "Value-added service"],
  ["RETURN", "Return"],
  ["STORAGE", "Storage"],
  ["TRANSFER", "Transfer"],
  ["OTHER", "Other"],
] as const;

export function HioBuyWallet() {
  const balance = useQuery({ queryKey: ["admin", "hiobuy-wallet"], queryFn: () => api<Balance>("/api/admin/settings/hiobuy-wallet") });
  const [from, setFrom] = useState(dayOffset(29));
  const [to, setTo] = useState(dayOffset(0));
  const [category, setCategory] = useState("");
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const transactions = useQuery({
    queryKey: ["admin", "hiobuy-wallet", "transactions", from, to, category, page],
    queryFn: () => api<Page>(`/api/admin/settings/hiobuy-wallet/transactions?${queryText({ from, to, category, page })}`),
    enabled: balance.isSuccess,
  });
  const disconnected = balance.error instanceof ApiError && balance.error.status === 409;

  return (
    <div className="space-y-4">
      <Panel>
        <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-4">
          <div>
            <h2 className="text-[12px] text-slate-500">Available · {balance.data?.balance.currency ?? "CNY"}</h2>
            {balance.isLoading ? <div className="mt-2 h-8 w-28 animate-pulse rounded bg-slate-100" /> : null}
            {balance.data ? <p className="mt-1 text-[28px] leading-none font-semibold tracking-tight tabular-nums">{formatCnyFen(balance.data.balance.availableFen)}</p> : null}
            {disconnected ? <p className="mt-2 text-[13px] text-slate-600">Connect a warehouse API key in Integration before this balance can load.</p> : null}
            {balance.data ? (
              <p className="mt-2 text-[12px] text-slate-400">
                Refreshed {formatDateTime(balance.data.fetchedAt)}
                {balance.data.balance.frozenFen ? ` · Frozen ${formatCnyFen(balance.data.balance.frozenFen)}` : ""}
              </p>
            ) : null}
            {balance.data && balance.data.balance.availableFen <= 0 ? <p className="mt-2 text-[13px] text-amber-800">Balance is ¥0.00. HioBuy shipping payments will fail until the account is topped up there.</p> : null}
          </div>
          <Button variant="secondary" size="sm" loading={balance.isFetching} onClick={() => void balance.refetch()}>Refresh</Button>
        </div>
        {balance.isError && !disconnected ? <div className="border-t border-slate-100 px-4 py-4"><ErrorState message={balance.error instanceof ApiError ? balance.error.message : "Could not load the HioBuy balance."} onRetry={() => void balance.refetch()} /></div> : null}
      </Panel>

      <Panel>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-2">
          <h2 className="mr-auto text-[13px] font-semibold">Transactions</h2>
          <input className={cn(filterControl, "w-[9.2rem]")} type="date" aria-label="From" value={from} onChange={(event) => { setFrom(event.target.value); setPage(1); }} />
          <input className={cn(filterControl, "w-[9.2rem]")} type="date" aria-label="To" value={to} onChange={(event) => { setTo(event.target.value); setPage(1); }} />
          <select className={cn(filterControl, "w-44")} aria-label="Transaction type" value={category} onChange={(event) => { setCategory(event.target.value); setPage(1); }}>
            {categories.map(([value, label]) => <option key={value || "all"} value={value}>{label}</option>)}
          </select>
          <Button variant="ghost" size="sm" loading={transactions.isFetching} disabled={!balance.isSuccess} onClick={() => void transactions.refetch()}>Refresh</Button>
        </div>
        {transactions.isLoading ? <RowsSkeleton rows={5} /> : null}
        {transactions.isError ? <div className="px-4 py-4"><ErrorState message={transactions.error instanceof ApiError ? transactions.error.message : "Could not load HioBuy transactions."} onRetry={() => void transactions.refetch()} /></div> : null}
        {transactions.data && transactions.data.items.length === 0 ? <p className="px-4 py-12 text-center text-[13px] text-slate-500">No transactions in this range.</p> : null}
        {transactions.data && transactions.data.items.length > 0 ? (
          <>
            <ul className="divide-y divide-slate-100 md:hidden">
              {transactions.data.items.map((item) => (
                <li key={item.id}>
                  <button type="button" className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50" onClick={() => setOpenId(item.id)}>
                    <span>
                      <span className="block text-[13px] font-medium">{categoryLabel(item.category)}</span>
                      <span className="block text-[12px] text-slate-400">{item.createdAt ? formatDateTime(item.createdAt) : "—"}</span>
                    </span>
                    <Amount fen={item.signedAmountFen} />
                  </button>
                </li>
              ))}
            </ul>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[720px] text-left text-[13px]">
                <thead className="border-b border-slate-100 text-[12px] font-medium text-slate-500">
                  <tr>
                    <th className="px-4 py-2 font-medium">Date</th>
                    <th className="py-2 pr-3 font-medium">Type</th>
                    <th className="py-2 pr-3 font-medium">Reference</th>
                    <th className="py-2 pr-3 font-medium">Description</th>
                    <th className="py-2 pr-3 text-right font-medium">Amount</th>
                    <th className="py-2 pr-4 text-right font-medium">Balance after</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.data.items.map((item) => (
                    <tr key={item.id} className="cursor-pointer border-b border-slate-100 last:border-0 hover:bg-slate-50" onClick={() => setOpenId(item.id)}>
                      <td className="px-4 py-2.5 whitespace-nowrap text-slate-600">{item.createdAt ? formatDateTime(item.createdAt) : "—"}</td>
                      <td className="py-2.5 pr-3">{categoryLabel(item.category)}</td>
                      <td className="py-2.5 pr-3 font-mono text-[12px] text-slate-400">{item.relatedId ?? "—"}</td>
                      <td className="max-w-[16rem] truncate py-2.5 pr-3 text-slate-500">{item.description ?? "—"}</td>
                      <td className="py-2.5 pr-3 text-right"><Amount fen={item.signedAmountFen} /></td>
                      <td className="py-2.5 pr-4 text-right text-slate-600 tabular-nums">{item.balanceAfterFen == null ? "—" : formatCnyFen(item.balanceAfterFen)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2 text-[12px] text-slate-500">
              <span>{transactions.data.total == null ? `Page ${transactions.data.page}` : `${transactions.data.total} transactions`}</span>
              <span className="flex gap-2">
                <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</Button>
                <Button size="sm" variant="secondary" disabled={transactions.data.total != null ? page * transactions.data.pageSize >= transactions.data.total : transactions.data.items.length < transactions.data.pageSize} onClick={() => setPage((value) => value + 1)}>Next</Button>
              </span>
            </div>
          </>
        ) : null}
      </Panel>
      <TransactionDialog id={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}

function TransactionDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const detail = useQuery({
    queryKey: ["admin", "hiobuy-wallet", "transaction", id],
    queryFn: () => api<Transaction>(`/api/admin/settings/hiobuy-wallet/transactions/${id}`),
    enabled: Boolean(id),
  });
  const item = detail.data;
  return (
    <Dialog open={id != null} title="Transaction" description={item?.id} onClose={onClose} size="lg">
      {detail.isLoading ? <LoadingBlock rows={3} /> : null}
      {detail.isError ? <ErrorState message={detail.error instanceof ApiError ? detail.error.message : "Could not load this transaction."} onRetry={() => void detail.refetch()} /> : null}
      {item ? (
        <dl className="space-y-2 text-[13px]">
          <Row label="Type" value={`${categoryLabel(item.category)}${item.type ? ` · ${typeLabel(item.type)}` : ""}`} />
          <Row label="Amount" value={item.signedAmountFen == null ? "—" : signedCny(item.signedAmountFen)} />
          <Row label="Currency" value="CNY" />
          <Row label="Created" value={item.createdAt ? formatDateTime(item.createdAt) : "—"} />
          <Row label="Related" value={item.relatedId ? `${item.relatedType ?? "Reference"} ${item.relatedId}` : "—"} />
          <Row label="Description" value={item.description ?? "—"} />
          <Row label="Invoice status" value={item.invoiceStatus ? item.invoiceStatus.replaceAll("_", " ").toLowerCase() : "—"} />
          <Row label="Balance before" value={item.balanceBeforeFen == null ? "—" : formatCnyFen(item.balanceBeforeFen)} />
          <Row label="Balance after" value={item.balanceAfterFen == null ? "—" : formatCnyFen(item.balanceAfterFen)} />
          {item.localShipmentId ? <div className="pt-1"><Button size="sm" variant="secondary" to={`/admin/shipments/${item.localShipmentId}`}>Open shipment</Button></div> : null}
        </dl>
      ) : null}
    </Dialog>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between gap-3"><dt className="text-slate-500">{label}</dt><dd className="text-right text-ink">{value}</dd></div>;
}

function Amount({ fen }: { fen: number | null }) {
  if (fen == null) return <span className="text-slate-300">—</span>;
  return <span className="font-medium text-ink tabular-nums">{signedCny(fen)}</span>;
}

function signedCny(fen: number) {
  const body = formatCnyFen(Math.abs(fen));
  if (fen > 0) return `+${body}`;
  if (fen < 0) return `−${body.replace("-", "")}`;
  return body;
}

function categoryLabel(category: string | null) {
  return categories.find(([value]) => value === category)?.[1] ?? category?.replaceAll("_", " ").toLowerCase() ?? "Transaction";
}

function typeLabel(type: string) {
  if (type === "CREDIT") return "Credit";
  if (type === "DEBIT") return "Debit";
  if (type === "REFUND") return "Refund";
  if (type === "ADJUSTMENT") return "Adjustment";
  return type;
}

function dayOffset(daysAgo: number) {
  return new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function queryText(input: { from: string; to: string; category: string; page: number }) {
  const query = new URLSearchParams({ from: input.from, to: input.to, page: String(input.page) });
  if (input.category) query.set("category", input.category);
  return query.toString();
}
