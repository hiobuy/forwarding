import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useSearchParams } from "react-router";
import { Button, ErrorState, Field, Money, Notice, Pagination, SearchInput, inputClass } from "../../components/ui";
import { useToast } from "../../components/toast";
import { formatDateTime } from "../../domain/dates";
import { ApiError, api } from "../../lib/api";
import { cn } from "../../lib/utils";
import { AdminHeader, ListEmpty, ListFrame, Panel, RowsSkeleton, TableShell, filterControl, useAdminAction, useDemoPreview, type AdminOverview } from "./shared";

type PaymentSettings = {
  stripeEnabled: boolean;
  stripeMode: "test" | "live";
  publishableKey: string;
  secretSet: boolean;
  webhookSet: boolean;
  cardTopupEnabled: boolean;
  minTopupFen: number;
  maxTopupFen: number;
  dailyTopupFen: number;
  bankEnabled: boolean;
  bankName: string;
  accountHolder: string;
  accountNumber: string;
  swift: string;
  bankCountry: string;
  bankCurrency: string;
  bankInstructions: string;
  status: { stripe: string; bank: string; cardTopup: string };
};

type PaymentRow = {
  id: string;
  customer: string;
  email: string;
  method: string;
  purpose: string;
  amountFen: number;
  status: string;
  hiobuyStatus: string | null;
  riskStatus: string | null;
  failureReason?: string | null;
  checkoutId: string | null;
  createdAt: string;
};

type Transfer = {
  id: string;
  publicId: string;
  userId: string;
  amountFen: number;
  reference: string | null;
  transferDate: string | null;
  proofNote: string | null;
  hasProof: boolean;
  status: string;
  customer: string;
  email: string;
  reviewedAt: string | null;
  reviewNote: string | null;
  createdAt: string;
};

const columns = "grid-cols-[minmax(14rem,1.6fr)_6rem_6rem_6rem_6.5rem_11.5rem_minmax(12rem,auto)]";

export function PaymentSettingsPanel() {
  const query = useQuery({ queryKey: ["admin", "payment-settings"], queryFn: () => api<PaymentSettings>("/api/admin/payments/settings") });
  if (query.isLoading) return <RowsSkeleton rows={4} />;
  if (query.error || !query.data) return <ErrorState message="Could not load payment settings." onRetry={() => void query.refetch()} />;
  return <PaymentForm key={query.dataUpdatedAt} initial={query.data} />;
}

function PaymentForm({ initial }: { initial: PaymentSettings }) {
  const demo = useDemoPreview();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState(initial);
  const [secretKey, setSecretKey] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const save = useMutation({
    mutationFn: () =>
      api<PaymentSettings>("/api/admin/payments/settings", {
        method: "PUT",
        body: JSON.stringify({
          ...form,
          secretKey,
          webhookSecret,
          minTopupFen: dollarsToFen(form.minTopupFen),
          maxTopupFen: dollarsToFen(form.maxTopupFen),
          dailyTopupFen: dollarsToFen(form.dailyTopupFen),
        }),
      }),
    onSuccess: async (next) => {
      setSecretKey("");
      setWebhookSecret("");
      setForm(next);
      await queryClient.invalidateQueries({ queryKey: ["admin", "payment-settings"] });
      toast({ title: "Payment settings saved.", tone: "success" });
    },
    onError: (reason) => toast({ title: reason instanceof ApiError ? reason.message : "Could not save payment settings.", tone: "danger" }),
  });
  const test = useMutation({
    mutationFn: () => api<{ mode: string }>("/api/admin/payments/settings/test", { method: "POST" }),
    onSuccess: (result) => toast({ title: `Stripe responded: ${result.mode}.`, tone: "success" }),
    onError: (reason) => toast({ title: reason instanceof ApiError ? reason.message : "Stripe did not respond.", tone: "danger" }),
  });

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!demo) save.mutate();
      }}
    >
      {demo ? <p className="text-[13px] text-slate-500">Sample payment settings. Stripe secrets are hidden, and checkout cannot be started.</p> : null}
      <fieldset disabled={demo} className="min-w-0 space-y-4 border-0 p-0 disabled:opacity-100">
      <div className="flex flex-wrap gap-2 text-[13px] text-slate-600">
        <StatusPill label={`Stripe — ${form.status.stripe}`} />
        <StatusPill label={`Bank transfer — ${form.status.bank}`} />
        <StatusPill label={`Card top-up — ${form.status.cardTopup}`} />
      </div>
      <Panel>
        <div className="space-y-4 p-4">
          <h2 className="text-[13px] font-medium text-ink">Stripe</h2>
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={form.stripeEnabled} onChange={(event) => setForm({ ...form, stripeEnabled: event.target.checked })} />
            Enable Stripe Checkout
          </label>
          <Field label="Mode">
            <select className={filterControl} value={form.stripeMode} onChange={(event) => setForm({ ...form, stripeMode: event.target.value as "test" | "live" })}>
              <option value="test">Test</option>
              <option value="live">Live</option>
            </select>
          </Field>
          <Field label="Publishable key">
            <input className={inputClass} value={form.publishableKey} onChange={(event) => setForm({ ...form, publishableKey: event.target.value })} autoComplete="off" />
          </Field>
          <Field label="Secret key" hint={form.secretSet ? "A secret is already saved. Leave this blank to keep it." : "Stored only on the server."}>
            <input className={inputClass} type="password" value={secretKey} onChange={(event) => setSecretKey(event.target.value)} autoComplete="new-password" placeholder={form.secretSet ? "••••••••" : ""} />
          </Field>
          <Field label="Webhook signing secret" hint={form.webhookSet ? "A webhook secret is already saved." : "From the Stripe webhook endpoint."}>
            <input className={inputClass} type="password" value={webhookSecret} onChange={(event) => setWebhookSecret(event.target.value)} autoComplete="new-password" placeholder={form.webhookSet ? "••••••••" : ""} />
          </Field>
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={form.cardTopupEnabled} onChange={(event) => setForm({ ...form, cardTopupEnabled: event.target.checked })} />
            Allow card wallet top-up
          </label>
          <div className="grid gap-3 sm:grid-cols-3">
            <DollarField label="Minimum top-up" fen={form.minTopupFen} onFen={(minTopupFen) => setForm({ ...form, minTopupFen })} />
            <DollarField label="Maximum top-up" fen={form.maxTopupFen} onFen={(maxTopupFen) => setForm({ ...form, maxTopupFen })} />
            <DollarField label="Daily card limit" fen={form.dailyTopupFen} onFen={(dailyTopupFen) => setForm({ ...form, dailyTopupFen })} />
          </div>
          <Button type="button" variant="secondary" loading={test.isPending} onClick={() => test.mutate()}>
            Test connection
          </Button>
        </div>
      </Panel>
      <Panel>
        <div className="space-y-4 p-4">
          <h2 className="text-[13px] font-medium text-ink">Bank transfer</h2>
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={form.bankEnabled} onChange={(event) => setForm({ ...form, bankEnabled: event.target.checked })} />
            Enable bank transfer top-up
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Bank name">
              <input className={inputClass} value={form.bankName} onChange={(event) => setForm({ ...form, bankName: event.target.value })} />
            </Field>
            <Field label="Account holder">
              <input className={inputClass} value={form.accountHolder} onChange={(event) => setForm({ ...form, accountHolder: event.target.value })} />
            </Field>
            <Field label="Account number / IBAN">
              <input className={inputClass} value={form.accountNumber} onChange={(event) => setForm({ ...form, accountNumber: event.target.value })} />
            </Field>
            <Field label="SWIFT / BIC">
              <input className={inputClass} value={form.swift} onChange={(event) => setForm({ ...form, swift: event.target.value })} />
            </Field>
            <Field label="Bank country">
              <input className={inputClass} value={form.bankCountry} onChange={(event) => setForm({ ...form, bankCountry: event.target.value })} />
            </Field>
            <Field label="Currency">
              <input className={inputClass} value="USD" readOnly />
            </Field>
          </div>
          <Field label="Payment instructions">
            <textarea className={cn(inputClass, "min-h-24 py-2")} value={form.bankInstructions} onChange={(event) => setForm({ ...form, bankInstructions: event.target.value })} />
          </Field>
        </div>
      </Panel>
      <Button type="submit" loading={save.isPending} disabled={demo}>
        {demo ? "Not saved in demo" : "Save payments"}
      </Button>
      </fieldset>
    </form>
  );
}

function dollarsToFen(fen: number) {
  return fen;
}

function DollarField({ label, fen, onFen }: { label: string; fen: number; onFen: (fen: number) => void }) {
  const [text, setText] = useState((fen / 100).toFixed(2));
  return (
    <Field label={label}>
      <input
        className={inputClass}
        inputMode="decimal"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          const [whole = "0", frac = ""] = event.target.value.replace(/[^\d.]/g, "").split(".");
          onFen(Number(whole || 0) * 100 + Number((frac + "00").slice(0, 2)));
        }}
      />
    </Field>
  );
}

function StatusPill({ label }: { label: string }) {
  return <span className="rounded-md border border-slate-200 px-2 py-1">{label}</span>;
}

export function AdminPayments() {
  const [params, setParams] = useSearchParams();
  const overview = useQuery({ queryKey: ["admin", "overview"], queryFn: () => api<AdminOverview>("/api/admin/overview") });
  const pendingTopups = overview.data?.queues.pendingTopups;
  const tab = params.get("tab") === "topups" || params.get("tab") === "refunds" ? params.get("tab") : "transactions";
  function choose(next: string) {
    const copy = new URLSearchParams(params);
    if (next === "transactions") copy.delete("tab");
    else copy.set("tab", next);
    setParams(copy, { replace: true });
  }
  return (
    <div>
      <AdminHeader title="Payments" meta="Customer payments, bank top-ups, and refunds." />
      <div className="mb-5 flex gap-1 overflow-x-auto border-b border-line" role="tablist">
        {[
          ["transactions", "Transactions"],
          ["topups", "Top-ups"],
          ["refunds", "Refunds & disputes"],
        ].map(([id, label]) => {
          const selected = tab === id;
          const count = id === "topups" ? pendingTopups : undefined;
          return (
            <button key={id} type="button" role="tab" aria-selected={selected} aria-label={count == null ? label : `${label}, ${count} pending`} className={cn("-mb-px inline-flex shrink-0 items-center border-b-2 px-2.5 py-2 text-[13px] whitespace-nowrap", selected ? "border-ink font-medium text-ink" : "border-transparent text-slate-500")} onClick={() => choose(id)}>
              {label}
              {count == null ? null : <span className={cn("ml-1.5 text-[12px] tabular-nums", selected ? "text-ink" : count ? "text-slate-400" : "text-slate-300")}>{count}</span>}
            </button>
          );
        })}
      </div>
      {tab === "transactions" ? <Transactions /> : null}
      {tab === "topups" ? <PendingTopups /> : null}
      {tab === "refunds" ? <Refunds /> : null}
    </div>
  );
}

function Transactions() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const status = params.get("status") ?? "";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const page = Number(params.get("page") ?? 1);
  const query = useQuery({
    queryKey: ["admin", "payments", q, status, from, to, page],
    queryFn: () => api<{ page: number; total: number; items: PaymentRow[] }>(`/api/admin/payments?q=${encodeURIComponent(q)}&status=${encodeURIComponent(status)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&page=${page}`),
  });
  const [refunding, setRefunding] = useState<PaymentRow | null>(null);
  function patch(next: Record<string, string>) {
    const copy = new URLSearchParams(params);
    for (const [key, value] of Object.entries(next)) {
      if (value) copy.set(key, value);
      else copy.delete(key);
    }
    copy.delete("page");
    setParams(copy, { replace: true });
  }
  return (
    <div>
      <ListFrame
        toolbar={
          <>
            <SearchInput className="mb-0 w-full sm:max-w-sm" size="sm" defaultValue={q} placeholder="Payment, customer, or checkout" label="Search payments" onSearch={(next) => patch({ q: next })} />
            <select className={cn(filterControl, "w-36")} value={status} aria-label="Status" onChange={(event) => patch({ status: event.target.value })}>
              <option value="">All statuses</option>
              {["pending", "paid", "held", "failed", "refunded", "disputed"].map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
            <div className="flex h-8 items-center gap-1 rounded-md border border-slate-200 bg-white px-2">
              <input className="h-7 w-[7.6rem] bg-transparent text-[13px] text-slate-700 outline-none" type="date" aria-label="From" value={from} onChange={(event) => patch({ from: event.target.value })} />
              <span className="text-slate-300" aria-hidden="true">–</span>
              <input className="h-7 w-[7.6rem] bg-transparent text-[13px] text-slate-700 outline-none" type="date" aria-label="To" value={to} onChange={(event) => patch({ to: event.target.value })} />
            </div>
          </>
        }
      >
        {query.isLoading ? <RowsSkeleton /> : null}
        {query.error ? <div className="p-4"><ErrorState message="Could not load payments." onRetry={() => void query.refetch()} /></div> : null}
        {query.data && query.data.items.length === 0 ? <ListEmpty title="No payments" body="Card checkouts, wallet freight payments, and approved bank transfers show up here." /> : null}
        {query.data && query.data.items.length > 0 ? (
          <>
            <ul className="divide-y divide-slate-100 md:hidden">
              {query.data.items.map((item) => (
                <li key={item.id} className="space-y-1 px-4 py-3 text-[13px]">
                  <div className="flex justify-between gap-3">
                    <span className="font-medium">{item.customer}</span>
                    <Money fen={item.amountFen} />
                  </div>
                  <div className="text-slate-500">{item.method} · {item.status} · {formatDateTime(item.createdAt)}</div>
                  {item.failureReason ? <div className="text-[12px] text-red-700">{item.failureReason}</div> : null}
                  <PaymentActions item={item} onRefund={setRefunding} />
                </li>
              ))}
            </ul>
            <div className="hidden md:block">
              <TableShell bare head={["Customer", "Method", "Amount", "Status", "HioBuy", "Date", ">Actions"]} grid={columns} minWidth={1040}>
                {query.data.items.map((item) => (
                  <li key={item.id} className={`grid ${columns} items-center gap-x-4 px-4 py-3 text-[13px]`}>
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{item.customer}</span>
                      <span className="block truncate text-[12px] text-slate-400">{item.email}</span>
                    </span>
                    <span className="capitalize">{item.method}</span>
                    <Money fen={item.amountFen} />
                    <span className="min-w-0">
                      <span className="block capitalize">{item.status}</span>
                      {item.failureReason ? <span className="block truncate text-[12px] text-red-700" title={item.failureReason}>{item.failureReason}</span> : null}
                    </span>
                    <span className="truncate text-slate-500">{item.hiobuyStatus ?? "—"}</span>
                    <span className="whitespace-nowrap text-slate-500">{formatDateTime(item.createdAt)}</span>
                    <PaymentActions item={item} onRefund={setRefunding} />
                  </li>
                ))}
              </TableShell>
            </div>
          </>
        ) : null}
      </ListFrame>
      {query.data ? <Pagination page={query.data.page} pageSize={20} total={query.data.total} onChange={(next) => { const copy = new URLSearchParams(params); copy.set("page", String(next)); setParams(copy); }} /> : null}
      {refunding ? <RefundBox item={refunding} onClose={() => setRefunding(null)} /> : null}
    </div>
  );
}

function PaymentActions({ item, onRefund }: { item: PaymentRow; onRefund: (item: PaymentRow) => void }) {
  const demo = useDemoPreview();
  const retry = useAdminAction((id: string) => `/api/admin/payments/${id}/retry-hiobuy`, { success: () => "Marked for HioBuy pay. Confirm Pay HioBuy on the shipment. The customer was not charged again." });
  if (demo) return <span className="text-[12px] text-slate-400">Read only</span>;
  return (
    <div className="flex flex-wrap justify-end gap-2">
      {item.status === "paid" || item.status === "disputed" ? (
        <Button size="sm" variant="secondary" onClick={() => onRefund(item)}>Refund</Button>
      ) : null}
      {item.purpose === "shipment" && item.status === "paid" && item.hiobuyStatus !== "skipped" ? (
        <Button size="sm" variant="secondary" loading={retry.isPending} onClick={() => retry.mutate(item.id)}>Queue HioBuy pay</Button>
      ) : null}
    </div>
  );
}

function RefundBox({ item, onClose }: { item: PaymentRow; onClose: () => void }) {
  const [amount, setAmount] = useState((item.amountFen / 100).toFixed(2));
  const [note, setNote] = useState("");
  const refund = useAdminAction(
    (input: { id: string; amountFen: number; note: string }) => `/api/admin/payments/${input.id}/refund`,
    { success: () => "Refund recorded.", body: (input) => ({ amountFen: input.amountFen, note: input.note }), onDone: onClose },
  );
  const fen = Math.round(Number(amount) * 100);
  return (
    <Panel className="mt-4">
      <form
        className="space-y-3 p-4"
        onSubmit={(event) => {
          event.preventDefault();
          refund.mutate({ id: item.id, amountFen: fen, note });
        }}
      >
        <h2 className="text-[13px] font-medium">Refund {item.customer}</h2>
        <Field label="Amount (USD)">
          <input className={inputClass} value={amount} onChange={(event) => setAmount(event.target.value)} />
        </Field>
        <Field label="Note">
          <input className={inputClass} value={note} onChange={(event) => setNote(event.target.value)} />
        </Field>
        <div className="flex gap-2">
          <Button type="submit" loading={refund.isPending}>Confirm refund</Button>
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Panel>
  );
}

function PendingTopups() {
  const demo = useDemoPreview();
  const [open, setOpen] = useState<Transfer | null>(null);
  const query = useQuery({ queryKey: ["admin", "payment-topups"], queryFn: () => api<Transfer[]>("/api/admin/payments/topups") });
  const review = useAdminAction(
    (input: { id: string; decision: "approve" | "reject" }) => `/api/admin/payments/topups/${input.id}`,
    { success: (input) => (input.decision === "approve" ? "Top-up added to the wallet." : "Top-up rejected."), body: (input) => ({ decision: input.decision, note: "" }) },
  );
  if (query.isLoading) return <RowsSkeleton />;
  if (query.error) return <ErrorState message="Could not load top-up requests." onRetry={() => void query.refetch()} />;
  return (
    <ListFrame>
      {query.data && query.data.length === 0 ? <ListEmpty title="No transfer requests" body="Submitted, approved, and rejected bank transfers stay here so the record matches the customer wallet." /> : null}
      <ul className="divide-y divide-slate-100">
        {query.data?.map((item) => (
          <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-[13px]">
            <div>
              <div className="font-medium">{item.publicId} <span className={transferTone(item.status)}>{transferLabel(item.status)}</span></div>
              <div className="text-slate-500">{item.customer} · <Money fen={item.amountFen} /> · {formatDateTime(item.reviewedAt ?? item.createdAt)}{item.reference ? ` · ${item.reference}` : ""}</div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => setOpen(item)}>Details</Button>
              {!demo && item.status === "pending" ? <Button size="sm" loading={review.isPending} onClick={() => review.mutate({ id: item.id, decision: "approve" })}>Approve</Button> : null}
              {!demo && item.status === "pending" ? <Button size="sm" variant="secondary" onClick={() => review.mutate({ id: item.id, decision: "reject" })}>Reject</Button> : null}
            </div>
          </li>
        ))}
      </ul>
      {open ? (
        <div className="border-t border-slate-100 p-4 text-[13px] text-slate-600">
          <p>{transferLabel(open.status)}{open.reviewedAt ? ` · ${formatDateTime(open.reviewedAt)}` : ""}</p>
          <p className="mt-1">Reference {open.reference || "—"} · Transfer date {open.transferDate || "—"}</p>
          <p className="mt-1">Note: {open.proofNote || "No remark."}</p>
          {open.reviewNote ? <p className="mt-1">Review note: {open.reviewNote}</p> : null}
          {open.hasProof ? <img src={`/api/admin/payments/topups/${open.id}/proof`} alt="Transfer screenshot" className="mt-3 max-h-80 rounded-lg border border-slate-200" /> : <p className="mt-2 text-slate-500">No screenshot uploaded.</p>}
          <p className="mt-2 text-slate-400">A screenshot or reference number is not the same as money received.</p>
          <Button className="mt-3" size="sm" variant="secondary" onClick={() => setOpen(null)}>Close</Button>
        </div>
      ) : null}
    </ListFrame>
  );
}

function transferLabel(status: string) {
  if (status === "approved") return "Approved";
  if (status === "rejected") return "Rejected";
  return "Pending";
}

function transferTone(status: string) {
  return cn("ml-1.5 text-[12px] font-medium", status === "approved" ? "text-emerald-700" : status === "rejected" ? "text-red-700" : "text-amber-700");
}

function Refunds() {
  const query = useQuery({
    queryKey: ["admin", "payment-refunds"],
    queryFn: () => api<{ refunds: { id: string; paymentId: string; amountFen: number; method: string; status: string; note: string | null; createdAt: string }[]; disputes: { id: string; amountFen: number; status: string; riskStatus: string | null; method: string }[] }>("/api/admin/payments/refunds"),
  });
  if (query.isLoading) return <RowsSkeleton />;
  if (query.error || !query.data) return <ErrorState message="Could not load refunds." onRetry={() => void query.refetch()} />;
  return (
    <div className="space-y-4">
      <Panel>
        <h2 className="border-b border-slate-100 px-4 py-2 text-[13px] font-medium">Refunds</h2>
        {query.data.refunds.length === 0 ? <ListEmpty title="No refunds" body="Wallet refunds credit the customer wallet. Card refunds go back through Stripe." /> : null}
        <ul className="divide-y divide-slate-100">
          {query.data.refunds.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px]">
              <span>{item.method} · {item.status}{item.note ? ` · ${item.note}` : ""}</span>
              <Money fen={item.amountFen} />
            </li>
          ))}
        </ul>
      </Panel>
      <Panel>
        <h2 className="border-b border-slate-100 px-4 py-2 text-[13px] font-medium">Disputes</h2>
        {query.data.disputes.length === 0 ? <p className="px-4 py-6 text-[13px] text-slate-500">No open disputes. A lost card top-up is reversed only when the wallet can cover it.</p> : null}
        <ul className="divide-y divide-slate-100">
          {query.data.disputes.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px]">
              <span className="capitalize">{item.method} · {item.status}{item.riskStatus ? ` · ${item.riskStatus}` : ""}</span>
              <Money fen={item.amountFen} />
            </li>
          ))}
        </ul>
      </Panel>
      <Notice tone="info">A customer payment stays paid if HioBuy fulfillment fails. Queue HioBuy pay does not charge the customer or the HioBuy wallet. Confirm Pay HioBuy on the shipment.</Notice>
    </div>
  );
}
