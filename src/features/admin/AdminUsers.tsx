import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { countryName } from "../../domain/countries";
import { formatDate } from "../../domain/dates";
import { Button, Dialog, ErrorState, Field, Money, Notice, Pagination, SearchInput, inputClass, plural } from "../../components/ui";
import { api } from "../../lib/api";
import { cn } from "../../lib/utils";
import type { Page } from "../../types/api";
import { AdminHeader, ListEmpty, ListFrame, RowsSkeleton, TableShell, allows, dollarsToFen, useAdminAccess, useAdminAction, type AdminUser } from "./shared";

const grid = "grid-cols-[minmax(0,1.6fr)_7rem_minmax(0,0.8fr)_7rem_minmax(0,0.7fr)_4.5rem]";

export function AdminUsers() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const page = Number(params.get("page") ?? 1);
  const [adjusting, setAdjusting] = useState<AdminUser | null>(null);
  const access = useAdminAccess();
  const canAdjust = allows(access.data, "payments.money");
  const query = useQuery({
    queryKey: ["admin", "users", q, page],
    queryFn: () => api<Page<AdminUser>>(`/api/admin/users?q=${encodeURIComponent(q)}&page=${page}`),
    placeholderData: keepPreviousData,
  });

  return (
    <div>
      <AdminHeader title="Customers" />
      <ListFrame toolbar={<SearchInput className="mb-0 w-full sm:max-w-sm" size="sm" defaultValue={q} placeholder="Name, email, or member code" label="Search users" onSearch={(next) => setParams(next ? { q: next } : {})} />}>
        {query.isLoading ? <RowsSkeleton rows={5} /> : null}
        {query.error ? <div className="p-4"><ErrorState message="Could not load users." onRetry={() => void query.refetch()} /></div> : null}
        {query.data && query.data.items.length === 0 ? <ListEmpty title={q ? `No one matches “${q}”` : "No customers yet"} body="Customers appear here after they register." /> : null}
        {query.data && query.data.items.length > 0 ? (
          <div className={cn("transition-opacity", query.isPlaceholderData && "opacity-60")}>
            <ul className="divide-y divide-slate-100 md:hidden">
              {query.data.items.map((item) => (
                <li key={item.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate font-medium text-ink">{item.name}</div>
                      <div className="truncate text-[12px] text-slate-400">{item.email}</div>
                      <div className="mt-1 font-mono text-[12px] text-slate-500">{item.memberCode}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold tabular-nums"><Money fen={item.balanceFen} /></div>
                      <AccountStatus item={item} />
                    </div>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[12px] text-slate-500">
                    <span>{plural(item.packageCount, "package")} · {plural(item.shipmentCount, "shipment")}</span>
                    {canAdjust ? <Button size="sm" variant="ghost" onClick={() => setAdjusting(item)}>Adjust</Button> : null}
                  </div>
                </li>
              ))}
            </ul>
            <div className="hidden md:block">
              <TableShell bare grid={grid} head={["Customer", "Member code", "Packages", ">Balance", "Status", ""]}>
                {query.data.items.map((item) => (
                  <li key={item.id} className={`grid ${grid} items-center gap-x-4 px-4 py-2 text-[13px]`}>
                    <div className="min-w-0">
                      <div className="truncate font-medium text-ink">{item.name}</div>
                      <div className="truncate text-[12px] text-slate-400">
                        {item.email}
                        {item.country ? ` · ${countryName(item.country)}` : ""}
                      </div>
                    </div>
                    <span className="font-mono text-[12px] text-slate-600">{item.memberCode}</span>
                    <div>
                      <div className="font-medium tabular-nums">{item.packageCount}</div>
                      <div className="text-[12px] text-slate-400">
                        {plural(item.shipmentCount, "shipment")}
                        {item.toPayCount ? <span className="text-amber-700"> · {item.toPayCount} due</span> : null}
                      </div>
                    </div>
                    <span className="text-right font-semibold tabular-nums"><Money fen={item.balanceFen} /></span>
                    <AccountStatus item={item} />
                    <div className="text-right">
                      {canAdjust ? <Button size="sm" variant="ghost" onClick={() => setAdjusting(item)}>Adjust</Button> : null}
                    </div>
                  </li>
                ))}
              </TableShell>
            </div>
            <div className="border-t border-slate-100 px-4 py-2">
              <Pagination className="mt-0" page={query.data.page} pageSize={query.data.pageSize} total={query.data.total} onChange={(next) => setParams({ ...(q ? { q } : {}), page: String(next) })} />
            </div>
          </div>
        ) : null}
      </ListFrame>
      <WalletDialog target={adjusting} onClose={() => setAdjusting(null)} />
    </div>
  );
}

function AccountStatus({ item }: { item: AdminUser }) {
  const label = item.status === "active" ? "Active" : item.status;
  return (
    <span className="block">
      <span className="block text-[13px] text-slate-700">{label}</span>
      <span className="block text-[12px] text-slate-400">
        {!item.emailVerified ? "Unverified · " : ""}
        {item.staffRole ? `${item.staffRole} · ` : ""}
        {formatDate(item.createdAt)}
      </span>
    </span>
  );
}

type Tx = { id: string; type: string; amountFen: number; balanceAfter: number; description: string; createdAt: string };

function WalletDialog({ target, onClose }: { target: AdminUser | null; onClose: () => void }) {
  const [direction, setDirection] = useState<"credit" | "debit">("credit");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    setDirection("credit");
    setAmount("");
    setNote("");
    setError("");
  }, [target]);
  const txs = useQuery({
    queryKey: ["admin", "transactions", target?.id],
    queryFn: () => api<Tx[]>(`/api/admin/users/${target!.id}/transactions`),
    enabled: target != null,
  });
  const adjust = useAdminAction<{ user: AdminUser; amountFen: number; note: string }>(({ user }) => `/api/admin/users/${user.id}/wallet`, {
    body: ({ amountFen, note: text }) => ({ amountFen, note: text }),
    success: ({ user, amountFen }) => `${amountFen > 0 ? "Added" : "Deducted"} $${(Math.abs(amountFen) / 100).toFixed(2)} ${amountFen > 0 ? "to" : "from"} ${user.name}'s wallet.`,
    onDone: onClose,
  });
  const fen = dollarsToFen(amount);
  const after = target && fen ? target.balanceFen + (direction === "credit" ? fen : -fen) : null;

  return (
    <Dialog
      open={target != null}
      title={target ? `${target.name}'s wallet` : ""}
      description={target ? `${target.memberCode} · ${target.email}` : undefined}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button type="submit" form="wallet-form" loading={adjust.isPending} variant={direction === "debit" ? "danger" : "primary"}>
            {direction === "credit" ? "Add to wallet" : "Deduct from wallet"}
          </Button>
        </>
      }
    >
      {target ? (
        <div className="space-y-5">
          <div className="flex items-baseline justify-between rounded-xl bg-slate-50 px-4 py-3">
            <span className="text-[13px] text-slate-500">Current balance</span>
            <span className="text-xl font-semibold tracking-tight">
              <Money fen={target.balanceFen} />
            </span>
          </div>
          <form
            id="wallet-form"
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (!fen || fen <= 0) {
                setError("Enter an amount above $0, with up to two decimals.");
                return;
              }
              if (note.trim().length < 2) {
                setError("Add a short reason. The customer sees it in wallet activity.");
                return;
              }
              setError("");
              adjust.mutate({ user: target, amountFen: direction === "credit" ? fen : -fen, note: note.trim() });
            }}
          >
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Adjustment type">
              {(["credit", "debit"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={direction === value}
                  className={cn(
                    "h-10 rounded-lg border text-[13px] font-medium transition-colors",
                    direction === value ? (value === "credit" ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-red-300 bg-red-50 text-red-800") : "border-slate-200 text-slate-600 hover:bg-slate-50",
                  )}
                  onClick={() => setDirection(value)}
                >
                  {value === "credit" ? "Add money" : "Deduct money"}
                </button>
              ))}
            </div>
            <Field label="Amount (USD)" hint={after != null ? `New balance: $${(after / 100).toFixed(2)}${after < 0 ? " — can't go below $0" : ""}` : undefined}>
              <div className="relative">
                <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-slate-400">$</span>
                <input className={cn(inputClass, "pl-7 tabular-nums")} inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value.replace(/[^\d.]/g, ""))} placeholder="20.00" autoFocus />
              </div>
            </Field>
            <Field label="Reason" hint="Shown to the customer in their wallet activity.">
              <input className={inputClass} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Refund for damaged carton" maxLength={120} />
            </Field>
            {error ? <Notice tone="danger">{error}</Notice> : null}
          </form>
          <div>
            <h3 className="text-[13px] font-semibold">Recent activity</h3>
            {txs.isLoading ? <p className="mt-2 text-[12px] text-slate-400">Loading…</p> : null}
            {txs.data && txs.data.length === 0 ? <p className="mt-2 text-[12px] text-slate-400">No wallet activity yet.</p> : null}
            <ul className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-200">
              {txs.data?.slice(0, 8).map((tx) => (
                <li key={tx.id} className="flex items-center justify-between gap-3 px-3 py-2 text-[12px]">
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-slate-700">{tx.description}</span>
                    <span className="text-slate-400">
                      {formatDate(tx.createdAt)} · {tx.type.replaceAll("_", " ").toLowerCase()}
                    </span>
                  </span>
                  <span className={cn("font-medium tabular-nums", tx.amountFen > 0 ? "text-emerald-700" : "text-ink")}>
                    <Money fen={tx.amountFen} signed />
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}
