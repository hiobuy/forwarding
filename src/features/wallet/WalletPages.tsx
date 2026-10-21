import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownLeft, ArrowUpRight, ChevronRight, CreditCard, Landmark, Plus, ReceiptText, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { formatDate } from "../../domain/dates";
import { Button, Card, CopyButton, EmptyState, ErrorState, Field, FilterBar, LoadingBlock, Money, Notice, PageHeader, Pagination, inputClass } from "../../components/ui";
import { useToast } from "../../components/toast";
import { ApiError, api } from "../../lib/api";
import { downloadPdf } from "../../lib/download";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../lib/utils";
import type { Page, WalletTx } from "../../types/api";

const filters = [
  { key: "all", label: "All" },
  { key: "TOP_UP", label: "Top-ups" },
  { key: "SHIPMENT_PAYMENT", label: "Payments" },
  { key: "REFUND", label: "Refunds" },
  { key: "ADJUSTMENT", label: "Adjustments" },
];

type Transfer = { id: string; publicId: string; amountFen: number; status: string; reviewNote: string | null; createdAt: string; reviewedAt: string | null };
type TransferPage = { counts: { pending: number; approved: number; rejected: number }; items: Transfer[]; page: number; pageSize: number; total: number };

const transferFilters = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
] as const;

export function WalletPage() {
  const { t, currency } = useI18n();
  const [params] = useSearchParams();
  const toast = useToast();
  const [type, setType] = useState("all");
  const wallet = useQuery({ queryKey: ["wallet"], queryFn: () => api<{ balanceFen: number; currency: string; lowBalance: boolean }>("/api/wallet") });
  const txs = useQuery({ queryKey: ["transactions", type], queryFn: () => api<Page<WalletTx>>(`/api/wallet/transactions?type=${type}`), placeholderData: keepPreviousData });
  const transfers = useQuery({ queryKey: ["bank-transfers", "summary"], queryFn: () => api<TransferPage>("/api/wallet/bank-transfers?status=all&page=1") });
  const counts = transfers.data?.counts;
  const transferTotal = counts ? counts.pending + counts.approved + counts.rejected : 0;

  return (
    <div className="max-w-3xl">
      <PageHeader title="Wallet" subtitle="Freight and warehouse charges are paid from this balance." />
      <section className="relative overflow-hidden rounded-2xl bg-[#101828] px-5 py-5 text-white sm:px-6">
        <div className="pointer-events-none absolute -top-16 -right-10 size-48 rounded-full bg-indigo-500/25 blur-3xl" aria-hidden="true" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-[13px] text-slate-400">{t("Available balance · {currency}", { currency })}</div>
            <div className="mt-1 text-[2.25rem] leading-none font-semibold tracking-tight">
              {wallet.data ? <Money fen={wallet.data.balanceFen} /> : <span className="inline-block h-9 w-36 animate-pulse rounded-lg bg-white/10" />}
            </div>
            {wallet.data?.lowBalance ? <p className="mt-2 text-[13px] text-amber-300">{t("Low balance. Top up before your next freight payment.")}</p> : null}
          </div>
          <Button to="/app/wallet/top-up" className="bg-white text-ink shadow-none hover:bg-slate-100 active:bg-slate-200">
            <Plus size={15} aria-hidden="true" /> Top up
          </Button>
        </div>
      </section>
      {params.get("topup") === "pending" ? <div className="mt-4"><Notice tone="info">Card top-up is waiting for confirmation. This page does not change your balance.</Notice></div> : null}
      {transferTotal ? (
        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold tracking-tight">Transfer requests</h2>
            <Link to="/app/wallet/transfers" className="text-[13px] font-medium text-slate-500 hover:text-ink">View all</Link>
          </div>
          <div className="grid grid-cols-3 overflow-hidden rounded-xl border border-slate-200/80 bg-white">
            <TransferCount to="/app/wallet/transfers?status=pending" label="Pending" count={counts?.pending ?? 0} tone="text-amber-700" />
            <TransferCount to="/app/wallet/transfers?status=approved" label="Approved" count={counts?.approved ?? 0} tone="text-emerald-700" />
            <TransferCount to="/app/wallet/transfers?status=rejected" label="Rejected" count={counts?.rejected ?? 0} tone="text-red-700" />
          </div>
        </div>
      ) : null}
      <h2 className="mt-7 mb-3 text-sm font-semibold tracking-tight">Activity</h2>
      <FilterBar value={type} options={filters} onChange={setType} />
      {txs.isLoading ? <LoadingBlock rows={4} /> : null}
      {txs.error ? <ErrorState message="Could not load wallet activity." onRetry={() => void txs.refetch()} /> : null}
      {txs.data && txs.data.items.length === 0 ? <EmptyState icon={ReceiptText} title="No activity here yet" body="Top-ups, payments, and refunds show up here as they happen." /> : null}
      {txs.data && txs.data.items.length > 0 ? (
        <ul className={cn("divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200/80 bg-white transition-opacity", txs.isPlaceholderData && "opacity-60")}>
          {txs.data.items.map((item) => {
            const credit = item.amountFen > 0;
            const Icon = credit ? ArrowDownLeft : ArrowUpRight;
            return (
              <li key={item.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                <span className={cn("grid size-8 shrink-0 place-items-center rounded-full", credit ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-500")}>
                  <Icon size={15} aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{item.description}</div>
                  <div className="text-[12px] text-slate-400">
                    {formatDate(item.createdAt)}
                    {item.referenceId?.startsWith("SHP") ? <> · {item.referenceId}</> : null}
                  </div>
                </div>
                <span className={cn("font-semibold tabular-nums", credit ? "text-emerald-700" : "text-ink")}>
                  <Money fen={item.amountFen} signed />
                </span>
                {item.type === "TOP_UP" && item.amountFen > 0 ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      void downloadPdf(`/api/wallet/transactions/${item.id}/receipt`, `receipt-${item.id.slice(0, 8)}.pdf`).catch((error) => {
                        toast({ title: error instanceof ApiError ? error.message : "Could not download the receipt.", tone: "danger" });
                      });
                    }}
                  >
                    Receipt
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

function TransferCount({ to, label, count, tone }: { to: string; label: string; count: number; tone: string }) {
  return (
    <Link to={to} className="border-r border-slate-100 px-3 py-3 text-center last:border-r-0 hover:bg-slate-50">
      <span className={cn("block text-[1.35rem] leading-none font-semibold tabular-nums", count ? tone : "text-slate-300")}>{count}</span>
      <span className="mt-1 block text-[12px] text-slate-500">{label}</span>
    </Link>
  );
}

function transferStatus(status: string) {
  if (status === "approved") return "Approved";
  if (status === "rejected") return "Rejected";
  return "Waiting for review";
}

export function TransferRequestsPage() {
  const [params, setParams] = useSearchParams();
  const requested = params.get("status") ?? "all";
  const status = transferFilters.some((item) => item.key === requested) ? requested : "all";
  const page = Math.max(1, Number(params.get("page") ?? 1) || 1);
  const query = useQuery({
    queryKey: ["bank-transfers", status, page],
    queryFn: () => api<TransferPage>(`/api/wallet/bank-transfers?status=${status}&page=${page}`),
    placeholderData: keepPreviousData,
  });
  const counts = query.data?.counts;
  function choose(next: string) {
    const copy = new URLSearchParams(params);
    if (next === "all") copy.delete("status");
    else copy.set("status", next);
    copy.delete("page");
    setParams(copy, { replace: true });
  }
  function go(next: number) {
    const copy = new URLSearchParams(params);
    if (next <= 1) copy.delete("page");
    else copy.set("page", String(next));
    setParams(copy, { replace: true });
  }
  return (
    <div className="max-w-3xl">
      <PageHeader back={{ to: "/app/wallet", label: "Wallet" }} title="Transfer requests" subtitle="Bank transfers stay here after review, with the same reference shown to finance." />
      <FilterBar
        value={status}
        onChange={choose}
        options={transferFilters.map((item) => ({
          ...item,
          count: item.key === "all" ? (counts ? counts.pending + counts.approved + counts.rejected : undefined) : counts?.[item.key],
        }))}
      />
      {query.isLoading ? <LoadingBlock rows={4} /> : null}
      {query.error ? <ErrorState message="Could not load transfer requests." onRetry={() => void query.refetch()} /> : null}
      {query.data && query.data.total === 0 ? <EmptyState icon={ReceiptText} title="No transfers in this view" body="Submitted, approved, and rejected bank transfers are listed here." /> : null}
      {query.data && query.data.items.length > 0 ? (
        <ul className={cn("divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200/80 bg-white transition-opacity", query.isPlaceholderData && "opacity-60")}>
          {query.data.items.map((item) => (
            <li key={item.id} className="flex items-center gap-3 px-4 py-3 text-sm">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1">
                  <span className="font-mono text-[13px] font-medium">{item.publicId}</span>
                  <CopyButton value={item.publicId} label="Copy reference" iconOnly variant="ghost" size="sm" toastTitle="Reference copied." />
                </div>
                <div className={cn("text-[12px]", item.status === "approved" ? "text-emerald-700" : item.status === "rejected" ? "text-red-700" : "text-amber-700")}>{transferStatus(item.status)}</div>
                <div className="text-[12px] text-slate-400">{formatDate(item.reviewedAt ?? item.createdAt)}{item.reviewNote ? ` · ${item.reviewNote}` : ""}</div>
              </div>
              <Money fen={item.amountFen} />
            </li>
          ))}
        </ul>
      ) : null}
      {query.data ? <Pagination page={query.data.page} pageSize={query.data.pageSize} total={query.data.total} onChange={go} /> : null}
    </div>
  );
}

const presets = ["50", "100", "200", "500"];
const proofTypes = ["image/jpeg", "image/png", "image/webp"];

type PayOptions = {
  stripe: boolean;
  cardTopup: boolean;
  bank: boolean;
  bankDetails: { bankName: string; accountHolder: string; accountNumber: string; swift: string; country: string; currency: string; instructions: string } | null;
  minTopupFen: number;
  maxTopupFen: number;
};

export function TopUpPage() {
  const { t, symbol, currency, format } = useI18n();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const returnTo = params.get("return");
  const suggested = params.get("amount");
  const initial = suggested && Number(suggested) > 0 ? suggested : "100";
  const [amount, setAmount] = useState(initial);
  const [custom, setCustom] = useState(!presets.includes(initial));
  const [method, setMethod] = useState("");
  const [step, setStep] = useState<"choose" | "remit">("choose");
  const [reference, setReference] = useState("");
  const [proofNote, setProofNote] = useState("");
  const [proof, setProof] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const previewRef = useRef<string | null>(null);
  const [error, setError] = useState("");
  const wallet = useQuery({ queryKey: ["wallet"], queryFn: () => api<{ balanceFen: number; lowBalance: boolean }>("/api/wallet") });
  const options = useQuery({ queryKey: ["payment-options"], queryFn: () => api<PayOptions>("/api/payments/options") });
  const value = Number(amount);
  const invalid = !/^\d+(\.\d{1,2})?$/.test(amount.trim()) || value <= 0;
  const configured: string[] = [
    ...(options.data?.bank ? ["bank"] : []),
    ...(options.data?.cardTopup ? ["card"] : []),
  ];
  const ready = options.isSuccess;
  const unavailable = ready && configured.length === 0;
  const selected = configured.includes(method) ? method : (configured[0] ?? "");
  useEffect(() => () => { if (previewRef.current) URL.revokeObjectURL(previewRef.current); }, []);
  const card = useMutation({
    mutationFn: () => api<{ url: string | null }>("/api/wallet/top-up/stripe", { method: "POST", body: JSON.stringify({ amountFen: yuanToFen(amount) }) }),
    onSuccess: (result) => {
      if (result.url) window.location.assign(result.url);
      else setError("Card checkout did not start.");
    },
    onError: (reason) => setError(reason instanceof ApiError ? reason.message : "Card top-up did not start."),
  });
  const bank = useMutation({
    mutationFn: () => {
      const body = new FormData();
      body.set("amountFen", String(yuanToFen(amount)));
      body.set("reference", reference.trim());
      body.set("proofNote", proofNote.trim());
      if (proof) body.set("proof", proof);
      return api<{ publicId: string }>("/api/wallet/bank-transfers", { method: "POST", body });
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["bank-transfers"] });
      toast({ title: `${result.publicId} is waiting for review. The balance does not change until it is approved.`, tone: "success" });
      navigate("/app/wallet");
    },
    onError: (reason) => setError(reason instanceof ApiError ? reason.message : "Could not submit the transfer."),
  });
  function chooseProof(file: File | undefined) {
    if (!file) return;
    if (!proofTypes.includes(file.type)) {
      setError("Upload a JPEG, PNG, or WebP screenshot.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("The screenshot must be under 5 MB.");
      return;
    }
    setError("");
    setProof(file);
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    const url = URL.createObjectURL(file);
    previewRef.current = url;
    setPreview(url);
  }

  const bankDetails = options.data?.bankDetails;
  const remitText = bankDetails
    ? [
        bankDetails.bankName,
        bankDetails.accountHolder,
        bankDetails.accountNumber,
        bankDetails.swift,
        bankDetails.country,
        bankDetails.currency,
        bankDetails.instructions,
      ].filter(Boolean).join("\n")
    : "";

  if (step === "remit" && bankDetails) {
    return (
      <div className="max-w-5xl">
        <PageHeader
          title="Bank transfer"
          subtitle={<>Pay <Money fen={yuanToFen(amount)} /> using the account below. The wallet is credited only after finance approves the transfer.</>}
          action={<Button type="button" variant="secondary" onClick={() => setStep("choose")}>Back</Button>}
        />
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <Card className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">Payment amount</div>
                <div className="mt-1 text-3xl font-semibold tracking-tight"><Money fen={yuanToFen(amount)} /></div>
              </div>
              <CopyButton value={remitText} label="Copy all" size="sm" toastTitle="Bank details copied." />
            </div>
            <div>
              <div className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">Transfer to</div>
              <div className="mt-1 flex items-center gap-2 font-medium text-ink"><Landmark size={16} aria-hidden="true" /> {bankDetails.bankName}</div>
            </div>
            <dl className="divide-y divide-slate-100 text-[13px]">
              <Detail label="Account holder" value={bankDetails.accountHolder} />
              <Detail label="Account number" value={bankDetails.accountNumber} />
              {bankDetails.swift ? <Detail label="SWIFT / BIC" value={bankDetails.swift} /> : null}
              <Detail label="Country" value={bankDetails.country} />
              <Detail label="Currency" value={bankDetails.currency} />
              {bankDetails.instructions ? <Detail label="Instructions" value={bankDetails.instructions} /> : null}
            </dl>
          </Card>
          <Card>
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                setError("");
                if (!reference.trim()) {
                  setError("Enter the account you paid from.");
                  return;
                }
                if (!proof) {
                  setError("Upload a screenshot of the transfer.");
                  return;
                }
                bank.mutate();
              }}
            >
              <div>
                <h2 className="text-[15px] font-semibold">Submit transfer proof</h2>
                <p className="mt-1 text-[13px] leading-5 text-slate-500">Upload one screenshot after you send the transfer. Finance reviews it before the wallet is credited.</p>
              </div>
              <Field label="Account you paid from">
                <input className={inputClass} value={reference} onChange={(event) => setReference(event.target.value)} placeholder="IBAN or account number" required />
              </Field>
              <Field label="Remark">
                <input className={inputClass} value={proofNote} onChange={(event) => setProofNote(event.target.value)} placeholder="Optional reference" />
              </Field>
              <div>
                <div className="mb-1.5 text-[13px] font-medium text-slate-800">Transfer screenshot</div>
                <label
                  className="flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center hover:border-slate-400"
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    chooseProof(event.dataTransfer.files[0]);
                  }}
                >
                  {preview ? <img src={preview} alt="Selected transfer screenshot" className="mb-3 max-h-40 rounded-lg border border-slate-200" /> : <Upload size={22} className="text-slate-400" aria-hidden="true" />}
                  <span className="mt-2 text-[13px] font-medium text-ink">{proof ? proof.name : "Drop a screenshot here or click to upload"}</span>
                  <span className="mt-1 text-[12px] text-slate-400">JPEG, PNG, or WebP · max 5 MB</span>
                  <input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" aria-label="Transfer screenshot" onChange={(event) => chooseProof(event.target.files?.[0])} />
                </label>
              </div>
              <Notice tone="info">The balance stays unchanged until this transfer is approved.</Notice>
              {error ? <Notice tone="danger">{error}</Notice> : null}
              <Button className="w-full" size="lg" type="submit" loading={bank.isPending}>Submit for review</Button>
            </form>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <PageHeader
        back={returnTo ? { to: returnTo, label: "Back to checkout" } : { to: "/app/wallet", label: "Wallet" }}
        title="Top up wallet"
        subtitle={wallet.data ? <>Current balance <Money fen={wallet.data.balanceFen} />. Pick an amount, then the payment method opened in Settings.</> : "Pick an amount, then the payment method opened in Settings."}
      />
      <Card className="space-y-5">
        <div>
          <div className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">Amount</div>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {presets.map((preset) => (
              <button
                key={preset}
                type="button"
                className={cn("rounded-xl border px-4 py-3 text-left", !custom && amount === preset ? "border-indigo-500 bg-indigo-50/60 ring-2 ring-indigo-100" : "border-slate-200 hover:border-slate-300")}
                aria-pressed={!custom && amount === preset}
                onClick={() => { setCustom(false); setAmount(preset); }}
              >
                <div className="text-lg font-semibold tabular-nums">{symbol}{preset}</div>
                <div className="text-[12px] text-slate-500">{t("Wallet credit {amount}", { amount: `${symbol}${preset}` })}</div>
              </button>
            ))}
            <button
              type="button"
              className={cn("rounded-xl border px-4 py-3 text-left", custom ? "border-indigo-500 bg-indigo-50/60 ring-2 ring-indigo-100" : "border-slate-200 hover:border-slate-300")}
              aria-pressed={custom}
              onClick={() => setCustom(true)}
            >
              <div className="text-[15px] font-semibold">Custom amount</div>
              <div className="text-[12px] text-slate-500">Enter an exact amount</div>
            </button>
          </div>
          {custom ? (
            <div className="relative mt-3 max-w-xs">
              <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-slate-400">{symbol}</span>
              <input className={cn(inputClass, "pl-7 tabular-nums")} value={amount} onChange={(event) => setAmount(event.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" aria-label={t("Custom amount in {currency}", { currency })} />
            </div>
          ) : null}
        </div>
        <div>
          <h2 className="text-[15px] font-semibold">Choose payment method</h2>
          <p className="mt-1 text-[13px] text-slate-500">Choose an amount first, then a method that is turned on for this account.</p>
          {options.isError ? <div className="mt-3"><Notice tone="danger">Could not load payment methods.</Notice></div> : null}
          {!ready && !options.isError ? <p className="mt-3 text-[13px] text-slate-500">Loading payment methods…</p> : null}
          {options.data?.bank && bankDetails ? (
            <div className="mt-4">
              <div className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">Bank transfer</div>
              <button
                type="button"
                className={cn("mt-2 flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left", selected === "bank" ? "border-indigo-500 bg-indigo-50/60 ring-2 ring-indigo-100" : "border-slate-200 hover:border-slate-300")}
                aria-pressed={selected === "bank"}
                onClick={() => setMethod("bank")}
              >
                <span className="flex items-center gap-3">
                  <Landmark size={18} className="text-slate-500" aria-hidden="true" />
                  <span>
                    <span className="block font-medium text-ink">{bankDetails.bankName}</span>
                    <span className="block text-[12px] text-slate-500">{bankDetails.currency} · reviewed before credit</span>
                  </span>
                </span>
                <ChevronRight size={16} className="text-slate-400" aria-hidden="true" />
              </button>
            </div>
          ) : null}
          {options.data?.cardTopup ? (
            <div className="mt-4">
              <div className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">Card</div>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                {[["card", "Card"]].map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    className={cn("rounded-xl border px-4 py-4 text-left", selected === id ? "border-indigo-500 bg-indigo-50/60 ring-2 ring-indigo-100" : "border-slate-200 hover:border-slate-300")}
                    aria-pressed={selected === id}
                    onClick={() => setMethod(id)}
                  >
                    <CreditCard size={18} className="text-slate-500" aria-hidden="true" />
                    <span className="mt-2 block font-medium">{label}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
        {selected === "card" ? <Notice tone="info">Card checkout does not add funds until the payment is confirmed.</Notice> : null}
        {unavailable ? <Notice tone="warning">No top-up method is turned on yet. Contact support to add funds.</Notice> : null}
        {error ? <Notice tone="danger">{error}</Notice> : null}
        {selected === "bank" ? (
          <Button className="w-full sm:w-auto" size="lg" disabled={!ready || invalid} onClick={() => { setError(""); if (!invalid) setStep("remit"); }}>
            Continue
          </Button>
        ) : null}
        {selected === "card" ? (
          <Button className="w-full sm:w-auto" size="lg" loading={card.isPending} disabled={invalid} onClick={() => { setError(""); if (!invalid) card.mutate(); }}>
            {t("Pay {amount} by card", { amount: invalid ? "" : format(Math.round(value * 100)) })}
          </Button>
        ) : null}
      </Card>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 py-2.5 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-medium break-words text-ink">{value}</dd>
    </div>
  );
}

function yuanToFen(value: string): number {
  const [whole = "0", frac = ""] = value.trim().split(".");
  return Number(whole || 0) * 100 + Number((frac + "00").slice(0, 2));
}
