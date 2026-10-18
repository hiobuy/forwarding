import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { COUNTRIES, countryName } from "../../domain/countries";
import { formatDate } from "../../domain/dates";
import { interceptionDisplay } from "../../domain/status";
import { useToast } from "../../components/toast";
import { Button, Dialog, ErrorState, Money, MoneyRange, Pagination, SearchInput, plural } from "../../components/ui";
import { Checkbox } from "../../components/ui/checkbox";
import { ApiError, api } from "../../lib/api";
import { cn } from "../../lib/utils";
import { AdminHeader, HiobuyStatus, ListEmpty, ListFrame, OwnerCell, RowsSkeleton, StatusMark, StatusTabs, TableShell, allows, filterControl, useAdminAccess, type AdminShipment } from "./shared";

const grid = "grid-cols-[1.25rem_minmax(0,1.05fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_5.5rem_4.75rem_7.5rem_8rem_6rem]";
const primary = [
  { key: "all", label: "All" },
  { key: "pending", label: "Processing" },
  { key: "wait_payment", label: "Awaiting Payment" },
  { key: "wait_ship", label: "Ready to Ship" },
  { key: "shipped", label: "Shipped" },
  { key: "signed", label: "Delivered" },
];
const more = [{ key: "cancelled", label: "Cancelled" }];
type SyncReport = { checked?: number; updated?: number; unchanged?: number; failed: number; needsReview: number; items: { id: string; publicId: string; outcome: string; message: string }[] };

type ShipmentPage = { items: AdminShipment[]; page: number; pageSize: number; total: number; counts: Record<string, number> };

export function AdminShipments() {
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [selected, setSelected] = useState<string[]>([]);
  const [report, setReport] = useState<SyncReport | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const access = useAdminAccess();
  const canPay = allows(access.data, "shipments.pay");
  const canOperate = allows(access.data, "shipments.write");
  const status = params.get("status") ?? "all";
  const q = params.get("q") ?? "";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const country = params.get("country") ?? "";
  const link = params.get("link") ?? "all";
  const page = Number(params.get("page") ?? 1);
  const query = useQuery({
    queryKey: ["admin", "shipments", status, q, from, to, country, link, page],
    queryFn: () => api<ShipmentPage>(`/api/admin/shipments?${listQuery({ status, q, from, to, country, link, page })}`),
    placeholderData: keepPreviousData,
  });
  const filtered = Boolean(q || from || to || country || (link && link !== "all"));
  const items = query.data?.items ?? [];
  const pullable = items.filter((item) => item.canPull);
  const pull = useMutation({
    mutationFn: (scope: "selected" | "linked") => {
      const ids = selected.filter((id) => items.some((item) => item.id === id && item.canPull));
      return api<SyncReport>("/api/admin/shipments/pull", { method: "POST", body: JSON.stringify(scope === "linked" ? { scope } : { scope, ids }) });
    },
    onSuccess: async (result) => {
      setSelected([]);
      setReport(result);
      await queryClient.invalidateQueries({ queryKey: ["admin", "shipments"] });
      toast({ title: `${result.checked ?? 0} checked, ${result.updated ?? 0} updated, ${result.unchanged ?? 0} unchanged, ${result.failed} failed, ${result.needsReview} need review.`, tone: result.failed || result.needsReview ? "danger" : "success" });
    },
    onError: (reason) => toast({ title: reason instanceof ApiError ? reason.message : "Could not pull shipment status.", tone: "danger" }),
  });
  const payable = items.filter((item) => item.canPayHioBuy);
  const payIds = selected.filter((id) => payable.some((item) => item.id === id));
  const pay = useMutation({
    mutationFn: () => api<{ paid: number; failed: number; skipped: number; items: { id: string; ok: boolean; message: string }[] }>("/api/admin/shipments/hiobuy-pay", { method: "POST", body: JSON.stringify({ ids: payIds }) }),
    onSuccess: async (result) => {
      setPayOpen(false);
      setSelected([]);
      await queryClient.invalidateQueries({ queryKey: ["admin", "shipments"] });
      await queryClient.invalidateQueries({ queryKey: ["admin", "overview"] });
      toast({ title: `${result.paid} paid, ${result.failed} failed, ${result.skipped} not attempted.`, tone: result.failed || result.skipped ? "danger" : "success" });
    },
    onError: (reason) => toast({ title: reason instanceof ApiError ? reason.message : "Could not pay HioBuy.", tone: "danger" }),
  });
  const pageIds = items.map((item) => item.id).join(",");
  useEffect(() => {
    const visible = new Set(pageIds ? pageIds.split(",") : []);
    setSelected((current) => current.filter((id) => visible.has(id)));
  }, [pageIds]);

  function update(patch: Record<string, string>) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (!value || value === "all") next.delete(key);
      else next.set(key, value);
    }
    next.delete("page");
    setParams(next);
  }

  function withCounts(items: { key: string; label: string }[]) {
    return items.map((item) => ({ ...item, count: query.data?.counts[item.key] ?? 0 }));
  }

  return (
    <div>
      <AdminHeader title="Shipments" action={canOperate ? <Button size="sm" loading={pull.isPending && pull.variables === "linked"} onClick={() => pull.mutate("linked")}>Sync from HioBuy</Button> : undefined} />
      {report ? <p className="mb-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-[13px]">{report.checked ?? 0} checked · {report.updated ?? 0} updated · {report.unchanged ?? 0} unchanged · {report.failed} failed · {report.needsReview} need review</p> : null}
      <Dialog
        open={payOpen}
        title="Pay HioBuy for selected shipments"
        description={access.data?.hiobuyPay2fa ? "Authenticator codes are required. Open each shipment and confirm it on its own." : "Each shipment is paid on its own. A customer wallet is not charged. If one payment does not confirm, the rest are left unpaid."}
        onClose={() => { if (!pay.isPending) setPayOpen(false); }}
        footer={
          <>
            <Button variant="secondary" disabled={pay.isPending} onClick={() => setPayOpen(false)}>Cancel</Button>
            <Button loading={pay.isPending} disabled={!payIds.length || access.data?.hiobuyPay2fa} onClick={() => pay.mutate()}>Pay {payIds.length}</Button>
          </>
        }
      >
        <ul className="max-h-64 space-y-2 overflow-auto text-[13px]">
          {payable.filter((item) => payIds.includes(item.id)).map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-3">
              <span className="font-medium">{item.publicId}</span>
              <span className="text-slate-500">{item.customerPayment} · {item.hiobuyPayment}</span>
            </li>
          ))}
        </ul>
        {selected.length > payIds.length ? <p className="mt-3 text-[12px] text-slate-500">{selected.length - payIds.length} selected shipment{selected.length - payIds.length === 1 ? "" : "s"} cannot be paid and will be skipped.</p> : null}
      </Dialog>
      <StatusTabs value={status} primary={withCounts(primary)} more={withCounts(more)} onChange={(key) => update({ status: key })} />
      <ListFrame
        toolbar={
          <>
            <SearchInput className="mb-0 w-full sm:min-w-[14rem] sm:flex-1" size="sm" defaultValue={q} placeholder="Shipment, tracking, or customer" label="Search shipments" onSearch={(next) => update({ q: next })} />
            <div className={cn("flex h-8 items-center gap-1 rounded-md border bg-white px-2", from || to ? "border-slate-400" : "border-slate-200")}>
              <input className="h-7 w-[7.6rem] bg-transparent text-[13px] text-slate-700 outline-none" type="date" aria-label="Created from" value={from} onChange={(event) => update({ from: event.target.value })} />
              <span className="text-slate-300" aria-hidden="true">–</span>
              <input className="h-7 w-[7.6rem] bg-transparent text-[13px] text-slate-700 outline-none" type="date" aria-label="Created to" value={to} onChange={(event) => update({ to: event.target.value })} />
            </div>
            <select className={cn(filterControl, "w-40", country && "border-slate-400")} aria-label="Destination" value={country} onChange={(event) => update({ country: event.target.value })}>
              <option value="">Any country</option>
              {COUNTRIES.map((item) => (
                <option key={item.code} value={item.code}>{item.name}</option>
              ))}
            </select>
            <select className={cn(filterControl, "w-32", link !== "all" && "border-slate-400")} aria-label="HioBuy status" value={link} onChange={(event) => update({ link: event.target.value })}>
              <option value="all">Any sync</option>
              <option value="linked">Synced</option>
              <option value="unlinked">Not linked</option>
            </select>
            {filtered ? <Button variant="ghost" size="sm" onClick={() => update({ q: "", from: "", to: "", country: "", link: "all" })}>Clear</Button> : null}
          </>
        }
      >
        {selected.length ? (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2">
            <p className="text-[13px] text-slate-600">{selected.length} selected</p>
            <div className="flex flex-wrap gap-2">
              {canOperate ? <Button size="sm" variant="secondary" loading={pull.isPending && pull.variables === "selected"} disabled={!selected.some((id) => pullable.some((item) => item.id === id))} onClick={() => pull.mutate("selected")}>Sync selected</Button> : null}
              {canPay ? <Button size="sm" disabled={!payIds.length} onClick={() => setPayOpen(true)}>Pay HioBuy</Button> : null}
            </div>
          </div>
        ) : null}
        {query.isLoading ? <RowsSkeleton /> : null}
        {query.error ? <div className="p-4"><ErrorState message="Could not load shipments." onRetry={() => void query.refetch()} /></div> : null}
        {query.data && query.data.items.length === 0 ? <ListEmpty title="Nothing in this view" body="Try another status or a wider date range." /> : null}
        {query.data && query.data.items.length > 0 ? (
          <div className={cn("transition-opacity", query.isPlaceholderData && "opacity-60")}>
            <ul className="divide-y divide-slate-100 md:hidden">
              {query.data.items.map((item) => (
                <li key={item.id}>
                  <Link to={`/admin/shipments/${item.id}`} className="block px-4 py-3 hover:bg-slate-50">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium text-ink">{item.publicId}</div>
                        <div className="truncate text-[12px] text-slate-400">{item.owner ? `${item.owner.name} · ${item.owner.memberCode}` : "Unknown"}</div>
                        <div className="mt-1 truncate text-[12px] text-slate-500">{item.destination ? `${item.destination.city}, ${countryName(item.destination.countryCode)}` : "No destination"}</div>
                        {item.trackingNumber && (item.hiobuyStatus === "SHIPPED" || item.hiobuyStatus === "SIGNED") ? <div className="mt-1 truncate font-mono text-[12px] text-slate-500">{item.trackingNumber}</div> : null}
                      </div>
                      <Freight item={item} />
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <StatusMark label={item.fulfillment?.label ?? item.displayStatus.label} tone={item.fulfillment?.tone ?? item.displayStatus.tone} />
                      <HiobuyStatus status={item.hiobuyStatus} syncedAt={item.hiobuySyncedAt} syncLabel={item.syncLabel} compact />
                      <Profit item={item} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
            <div className="hidden md:block">
              <TableShell
                bare
                grid={grid}
                head={["Shipment", "Customer", "Destination", ">Freight", ">Profit", "Status", "Payment", "Sync"]}
                leading={<Checkbox aria-label="Select linked shipments on this page" checked={pullable.length > 0 && pullable.every((item) => selected.includes(item.id))} disabled={!pullable.length} onCheckedChange={(checked) => setSelected(checked === true ? pullable.map((item) => item.id) : [])} />}
              >
                {query.data.items.map((item) => (
                  <li key={item.id} className={`relative grid ${grid} items-center gap-x-4 px-4 py-2 text-[13px] hover:bg-slate-50`}>
                    <Link to={`/admin/shipments/${item.id}`} className="absolute inset-0" aria-label={`Open ${item.publicId}`} />
                    <Checkbox className="relative z-10" aria-label={`Select ${item.publicId}`} checked={selected.includes(item.id)} disabled={!item.canPull} onCheckedChange={(checked) => setSelected((current) => (checked === true ? [...current, item.id] : current.filter((id) => id !== item.id)))} />
                    <div className="min-w-0">
                      <div className="truncate font-medium text-ink">{item.publicId}</div>
                      <div className="truncate text-[12px] text-slate-400">{plural(item.packageCount, "package")} · {formatDate(item.createdAt)}</div>
                      {item.trackingNumber && (item.hiobuyStatus === "SHIPPED" || item.hiobuyStatus === "SIGNED") ? <div className="truncate font-mono text-[12px] text-slate-500">{item.trackingNumber}</div> : null}
                    </div>
                    <OwnerCell owner={item.owner} />
                    <div className="min-w-0">
                      <div className="truncate text-slate-700">{item.destination ? `${item.destination.city}, ${countryName(item.destination.countryCode)}` : "—"}</div>
                      <div className="truncate text-[12px] text-slate-400">{item.shippingMethod?.routeName}</div>
                    </div>
                    <Freight item={item} />
                    <Profit item={item} />
                    <div>
                      <StatusMark label={item.fulfillment?.label ?? item.displayStatus.label} tone={item.fulfillment?.tone ?? item.displayStatus.tone} />
                      {interceptionDisplay(item.interceptionStatus) ? <div className="mt-1 text-[11px] text-amber-800">{interceptionDisplay(item.interceptionStatus)?.label}</div> : null}
                    </div>
                    <div className="relative z-10 min-w-0 text-[12px] leading-4 text-slate-600">
                      <div>{item.customerPayment}</div>
                      <div className="text-slate-400">{item.hiobuyPayment}</div>
                      {canPay && item.canPayHioBuy ? <Link to={`/admin/shipments/${item.id}?pay=1`} className="font-medium text-indigo-700 hover:underline">Pay HioBuy</Link> : null}
                    </div>
                    <HiobuyStatus status={item.hiobuyStatus} syncedAt={item.hiobuySyncedAt} syncLabel={item.syncLabel} compact />
                  </li>
                ))}
              </TableShell>
            </div>
            <div className="border-t border-slate-100 px-4 py-2">
              <Pagination
                className="mt-0"
                page={query.data.page}
                pageSize={query.data.pageSize}
                total={query.data.total}
                onChange={(next) => {
                  const nextParams = new URLSearchParams(params);
                  nextParams.set("page", String(next));
                  setParams(nextParams);
                }}
              />
            </div>
          </div>
        ) : null}
      </ListFrame>
    </div>
  );
}

function Freight({ item }: { item: AdminShipment }) {
  if (item.status === "CONSOLIDATING" || item.status === "WAITING_FOR_WEIGHT") {
    return (
      <div className="text-right">
        <div className="font-medium text-slate-700">{item.shippingMethod ? <MoneyRange min={item.shippingMethod.estimatedMinFen} max={item.shippingMethod.estimatedMaxFen} /> : "—"}</div>
        <div className="text-[11px] text-slate-400">Estimate</div>
      </div>
    );
  }
  if (item.status === "CANCELLED") return <div className="text-right text-[13px] text-slate-300">—</div>;
  const amount = item.status === "TO_PAY" ? item.amountFen : item.earning.customerChargedUsdFen ?? item.amountFen;
  const due = item.status === "TO_PAY";
  return (
    <div className="text-right">
      <div className="font-semibold text-ink tabular-nums"><Money fen={amount} /></div>
      <div className={cn("text-[11px]", due ? "font-medium text-amber-700" : "text-slate-400")}>{due ? "Due" : "Paid"}</div>
    </div>
  );
}

function Profit({ item }: { item: AdminShipment }) {
  const earning = item.earning;
  if (earning.status === "pending" || earning.status === "unavailable" || earning.grossProfitUsdFen == null) {
    return <div className="text-right text-[13px] text-slate-300">—</div>;
  }
  return (
    <div className="text-right">
      <div className={cn("font-medium tabular-nums", earning.grossProfitUsdFen < 0 ? "text-red-700" : "text-slate-700")}><Money fen={earning.grossProfitUsdFen} /></div>
      <div className="text-[11px] text-slate-400">{earning.status === "finalized" ? "Final" : earning.status === "adjusted" ? "Adjusted" : "Provisional"}</div>
    </div>
  );
}

function listQuery(input: { status: string; q: string; from: string; to: string; country: string; link: string; page: number }) {
  const query = new URLSearchParams();
  if (input.status !== "all") query.set("status", input.status);
  if (input.q) query.set("q", input.q);
  if (input.from) query.set("from", input.from);
  if (input.to) query.set("to", input.to);
  if (input.country) query.set("country", input.country);
  if (input.link !== "all") query.set("link", input.link);
  query.set("page", String(input.page));
  return query.toString();
}
