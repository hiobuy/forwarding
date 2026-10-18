import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { formatDate, formatDateTime } from "../../domain/dates";
import { CARGO_ATTRIBUTES, cargoLabel, type CargoAttribute } from "../../domain/status";
import { useToast } from "../../components/toast";
import { Button, Dialog, Dimensions, ErrorState, Pagination, SearchInput, Weight } from "../../components/ui";
import { Checkbox } from "../../components/ui/checkbox";
import { ApiError, api } from "../../lib/api";
import { cn } from "../../lib/utils";
import { AdminHeader, ListEmpty, ListFrame, OwnerCell, RowsSkeleton, StatusMark, StatusTabs, TableShell, filterControl, useDemoPreview, type AdminPackage } from "./shared";

const grid = "grid-cols-[1.25rem_minmax(0,1.15fr)_minmax(0,0.9fr)_4.75rem_5.75rem_7.25rem_6.25rem_7rem]";
const primary = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "received", label: "Received" },
  { key: "consolidated", label: "Consolidated" },
  { key: "shipped", label: "Shipped" },
  { key: "delivered", label: "Delivered" },
];
const more = [
  { key: "transferring", label: "Transferring" },
  { key: "discarded", label: "Discarded" },
  { key: "unclaimed", label: "Unclaimed" },
  { key: "archived", label: "Archived" },
];

type PackagePage = { items: AdminPackage[]; page: number; pageSize: number; total: number; counts: Record<string, number> };
type SyncLog = {
  label: string;
  canRetry: boolean;
  remoteId: string | null;
  externalRef: string | null;
  reason: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  attemptCount: number;
  requestId: string | null;
  updatedAt: string | null;
  history: { id: string; attempt: number; httpStatus: number | null; outcome: string; errorCode: string | null; errorMessage: string | null; requestId: string | null; createdAt: string }[];
};
type SyncReport = {
  synced?: number;
  checked?: number;
  updated?: number;
  unchanged?: number;
  failed: number;
  skipped?: number;
  needsReview: number;
  items: { id: string; publicId: string; outcome: string; message: string }[];
};

const syncTone: Record<string, string> = {
  "Not Connected": "bg-slate-100 text-slate-600",
  Pending: "bg-amber-50 text-amber-800",
  Syncing: "bg-sky-50 text-sky-800",
  Synced: "bg-emerald-50 text-emerald-800",
  Failed: "bg-red-50 text-red-700",
  "Needs review": "bg-orange-50 text-orange-800",
  "Not synced": "bg-white text-slate-600 ring-1 ring-slate-200",
};

export function AdminPackages() {
  const demo = useDemoPreview();
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [selected, setSelected] = useState<string[]>([]);
  const [logId, setLogId] = useState<string | null>(null);
  const [report, setReport] = useState<SyncReport | null>(null);
  const status = params.get("status") ?? "all";
  const q = params.get("q") ?? "";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const cargo = params.get("cargo") ?? "";
  const link = params.get("link") ?? "all";
  const condition = params.get("condition") ?? "all";
  const page = Number(params.get("page") ?? 1);
  const query = useQuery({
    queryKey: ["admin", "packages", status, q, from, to, cargo, link, condition, page],
    queryFn: () => api<PackagePage>(`/api/admin/packages?${listQuery({ status, q, from, to, cargo, link, condition, page })}`),
    placeholderData: keepPreviousData,
  });
  const filtered = Boolean(q || from || to || cargo || (link && link !== "all") || (condition && condition !== "all"));
  const items = query.data?.items ?? [];
  const eligible = items.filter((pkg) => pkg.canSync || pkg.canPull);
  const allEligibleSelected = eligible.length > 0 && eligible.every((pkg) => selected.includes(pkg.id));
  const someSelected = eligible.some((pkg) => selected.includes(pkg.id));
  const log = useQuery({
    queryKey: ["admin", "package-sync", logId],
    queryFn: () => api<SyncLog>(`/api/admin/packages/${logId}/sync`),
    enabled: Boolean(logId),
  });
  const syncSelected = useMutation({
    mutationFn: () => api<SyncReport>("/api/admin/packages/sync", { method: "POST", body: JSON.stringify({ ids: selected }) }),
    onSuccess: async (result) => {
      setSelected([]);
      setReport(result);
      await queryClient.invalidateQueries({ queryKey: ["admin", "packages"] });
      await queryClient.invalidateQueries({ queryKey: ["admin", "fulfillment-sync"] });
      await queryClient.invalidateQueries({ queryKey: ["admin", "package-sync"] });
      toast({ title: `${result.synced ?? 0} notices submitted, ${result.failed} failed, ${result.needsReview} need review.`, tone: result.failed || result.needsReview ? "danger" : "success" });
    },
    onError: (reason) => toast({ title: reason instanceof ApiError ? reason.message : "Could not submit the selected notices.", tone: "danger" }),
  });
  const pullSelected = useMutation({
    mutationFn: (scope: "selected" | "linked") => {
      const ids = selected.filter((id) => items.some((pkg) => pkg.id === id && pkg.canPull));
      return api<SyncReport>("/api/admin/packages/pull", { method: "POST", body: JSON.stringify(scope === "linked" ? { scope } : { scope, ids }) });
    },
    onSuccess: async (result) => {
      setSelected([]);
      setReport(result);
      await queryClient.invalidateQueries({ queryKey: ["admin", "packages"] });
      await queryClient.invalidateQueries({ queryKey: ["admin", "package-sync"] });
      toast({ title: `${result.checked ?? 0} checked, ${result.updated ?? 0} updated, ${result.unchanged ?? 0} unchanged, ${result.failed} failed, ${result.needsReview} need review.`, tone: result.failed || result.needsReview ? "danger" : "success" });
    },
    onError: (reason) => toast({ title: reason instanceof ApiError ? reason.message : "Could not pull status from HioBuy.", tone: "danger" }),
  });

  const pageIds = items.map((pkg) => pkg.id).join(",");
  useEffect(() => {
    const visible = new Set(pageIds ? pageIds.split(",") : []);
    setSelected((current) => {
      const next = current.filter((id) => visible.has(id));
      return next.length === current.length ? current : next;
    });
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

  function toggle(id: string, on: boolean) {
    setSelected((current) => (on ? (current.includes(id) ? current : [...current, id]) : current.filter((item) => item !== id)));
  }

  function withCounts(tabs: { key: string; label: string }[]) {
    return tabs.map((item) => ({ ...item, count: query.data?.counts[item.key] ?? 0 }));
  }

  return (
    <div>
      <AdminHeader
        title="Packages"
        action={<Button size="sm" disabled={demo} title={demo ? "HioBuy sync is off in demo" : undefined} loading={pullSelected.isPending && pullSelected.variables === "linked"} onClick={() => pullSelected.mutate("linked")}>Sync from HioBuy</Button>}
      />
      {report ? (
        <div className="mb-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-[13px]">
          <p className="font-medium text-ink">{report.checked != null ? `${report.checked} checked · ${report.updated ?? 0} updated · ${report.unchanged ?? 0} unchanged · ${report.failed} failed · ${report.needsReview} need review` : `${report.synced ?? 0} notices submitted · ${report.failed} failed · ${report.needsReview} need review · ${report.skipped ?? 0} skipped`}</p>
          <ul className="mt-2 space-y-1 text-slate-600">
            {report.items.map((item) => (
              <li key={item.id}><span className="font-medium text-ink">{item.publicId}</span> · {item.outcome === "needs_review" ? "Needs review" : item.outcome} — {item.message}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <StatusTabs value={status} primary={withCounts(primary)} more={withCounts(more)} onChange={(key) => update({ status: key })} />
      <ListFrame
        toolbar={
          <>
            <SearchInput className="mb-0 w-full sm:min-w-[14rem] sm:flex-1" size="sm" defaultValue={q} placeholder="Package, tracking, or customer" label="Search packages" onSearch={(next) => update({ q: next })} />
            <div className={cn("flex h-8 items-center gap-1 rounded-md border bg-white px-2", from || to ? "border-slate-400" : "border-slate-200")}>
              <input className="h-7 w-[7.6rem] bg-transparent text-[13px] text-slate-700 outline-none" type="date" aria-label="Created from" value={from} onChange={(event) => update({ from: event.target.value })} />
              <span className="text-slate-300" aria-hidden="true">–</span>
              <input className="h-7 w-[7.6rem] bg-transparent text-[13px] text-slate-700 outline-none" type="date" aria-label="Created to" value={to} onChange={(event) => update({ to: event.target.value })} />
            </div>
            <select className={cn(filterControl, "w-36", cargo && "border-slate-400")} aria-label="Cargo type" value={cargo} onChange={(event) => update({ cargo: event.target.value })}>
              <option value="">Any cargo</option>
              {CARGO_ATTRIBUTES.map((item) => (
                <option key={item} value={item}>{cargoLabel(item)}</option>
              ))}
            </select>
            <select className={cn(filterControl, "w-36", condition !== "all" && "border-slate-400")} aria-label="Condition" value={condition} onChange={(event) => update({ condition: event.target.value })}>
              <option value="all">Any condition</option>
              <option value="exception">Exceptions</option>
              <option value="normal">Normal</option>
            </select>
            <select className={cn(filterControl, "w-36", link !== "all" && "border-slate-400")} aria-label="HioBuy sync" value={link} onChange={(event) => update({ link: event.target.value })}>
              <option value="all">Any sync</option>
              <option value="synced">Synced</option>
              <option value="pending">Pending</option>
              <option value="failed">Failed</option>
              <option value="needs_review">Needs review</option>
              <option value="not_synced">Not linked</option>
            </select>
            {filtered ? <Button variant="ghost" size="sm" onClick={() => update({ q: "", from: "", to: "", cargo: "", link: "all", condition: "all" })}>Clear</Button> : null}
          </>
        }
      >
        {selected.length ? (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2">
            <p className="text-[13px] text-slate-600">{selected.length} selected on this page</p>
            <div className="flex items-center gap-2">
              <Button size="sm" loading={pullSelected.isPending && pullSelected.variables === "selected"} disabled={!selected.some((id) => items.some((pkg) => pkg.id === id && pkg.canPull))} onClick={() => pullSelected.mutate("selected")}>Sync selected</Button>
              <Button variant="secondary" size="sm" loading={syncSelected.isPending} disabled={!selected.some((id) => items.some((pkg) => pkg.id === id && pkg.canSync))} onClick={() => syncSelected.mutate()}>Submit notice</Button>
              <Button variant="ghost" size="sm" onClick={() => setSelected([])}>Clear selection</Button>
            </div>
          </div>
        ) : null}
        {query.isLoading ? <RowsSkeleton /> : null}
        {query.error ? <div className="p-4"><ErrorState message="Could not load packages." onRetry={() => void query.refetch()} /></div> : null}
        {query.data && query.data.items.length === 0 ? <ListEmpty title="Nothing in this view" body="Try another status, a wider date range, or clear the search." /> : null}
        {query.data && query.data.items.length > 0 ? (
          <div className={cn("transition-opacity", query.isPlaceholderData && "opacity-60")}>
            <ul className="divide-y divide-slate-100 md:hidden">
              {query.data.items.map((pkg) => (
                <li key={pkg.id} className="flex items-start gap-3 px-4 py-3">
                  <Checkbox className="mt-1" aria-label={`Select ${pkg.publicId}`} checked={selected.includes(pkg.id)} disabled={!pkg.canSync && !pkg.canPull} onCheckedChange={(checked) => toggle(pkg.id, checked === true)} />
                  <Link to={`/admin/packages/${pkg.id}`} className="min-w-0 flex-1 hover:bg-slate-50">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium text-ink">{pkg.publicId}</div>
                        <div className="truncate font-mono text-[12px] text-slate-400">{pkg.domesticTrackingNumber}</div>
                        <div className="mt-1 truncate text-[12px] text-slate-500">{pkg.owner ? `${pkg.owner.name} · ${pkg.owner.memberCode}` : "Unknown"}</div>
                      </div>
                      <StatusMark label={pkg.displayStatus.label} tone={pkg.displayStatus.tone} />
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-3 text-[12px] text-slate-500">
                      <span>{pkg.weightGrams != null ? <Weight grams={pkg.weightGrams} /> : "—"} · <CargoLine attributes={pkg.cargoAttributes} /></span>
                      <ConditionMark status={pkg.conditionStatus} />
                    </div>
                  </Link>
                  <SyncBadge label={pkg.syncLabel} problem={Boolean(pkg.syncReason)} onOpen={() => setLogId(pkg.id)} />
                </li>
              ))}
            </ul>
            <div className="hidden md:block">
              <TableShell
                bare
                grid={grid}
                head={["Package", "Customer", "Cargo", "Weight", "Package status", "Condition", "HioBuy sync"]}
                leading={
                  <Checkbox
                    aria-label="Select packages on this page"
                    checked={allEligibleSelected ? true : someSelected ? "indeterminate" : false}
                    disabled={!eligible.length}
                    onCheckedChange={(checked) => setSelected(checked === true ? eligible.map((pkg) => pkg.id) : [])}
                  />
                }
              >
                {query.data.items.map((pkg) => (
                  <li key={pkg.id} className={`relative grid ${grid} items-center gap-x-4 px-4 py-2 text-[13px] hover:bg-slate-50`}>
                    <Link to={`/admin/packages/${pkg.id}`} className="absolute inset-0" aria-label={`Open ${pkg.publicId}`} />
                    <Checkbox className="relative z-10" aria-label={`Select ${pkg.publicId}`} checked={selected.includes(pkg.id)} disabled={!pkg.canSync && !pkg.canPull} onCheckedChange={(checked) => toggle(pkg.id, checked === true)} />
                    <div className="min-w-0">
                      <div className="truncate font-medium text-ink">{pkg.publicId}</div>
                      <div className="truncate font-mono text-[12px] text-slate-400">{pkg.domesticTrackingNumber}</div>
                    </div>
                    <OwnerCell owner={pkg.owner} />
                    <CargoLine attributes={pkg.cargoAttributes} />
                    <div className="min-w-0">
                      {pkg.weightGrams != null ? (
                        <>
                          <div className="font-medium text-ink"><Weight grams={pkg.weightGrams} /></div>
                          <div className="truncate text-[12px] text-slate-400"><Dimensions length={pkg.lengthMm} width={pkg.widthMm} height={pkg.heightMm} /></div>
                        </>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </div>
                    <span title={pkg.receivedAt ? `In since ${formatDate(pkg.receivedAt)}` : undefined}>
                      <StatusMark label={pkg.displayStatus.label} tone={pkg.displayStatus.tone} />
                    </span>
                    <ConditionMark status={pkg.conditionStatus} />
                    <SyncBadge label={pkg.syncLabel} problem={Boolean(pkg.syncReason)} onOpen={() => setLogId(pkg.id)} />
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
      <Dialog open={logId != null} title={log.data?.reason ? "Sync problem" : "Latest sync"} description={log.data?.reason ? undefined : "This is the most recent attempt for this package."} onClose={() => setLogId(null)}>
        {log.isLoading ? <p className="text-[13px] text-slate-500">Loading the latest attempt.</p> : null}
        {log.data ? (
          <div className="space-y-2 text-[13px] text-slate-600">
            {log.data.reason ? <p className="font-medium text-red-700">{log.data.reason}</p> : null}
            <p><span className="font-medium text-ink">{log.data.label}</span>{log.data.updatedAt ? <span> · {formatDateTime(log.data.updatedAt)}</span> : null}</p>
            <p>HioBuy reference {log.data.externalRef ?? "—"}{log.data.remoteId ? ` · remote ${log.data.remoteId}` : ""}</p>
            <p>Attempts {log.data.attemptCount}{log.data.requestId ? ` · request ${log.data.requestId}` : ""}{log.data.errorCode ? ` · ${log.data.errorCode}` : ""}</p>
            {log.data.history.length ? (
              <ul className="space-y-1">
                {log.data.history.map((attempt) => (
                  <li key={attempt.id}>Attempt {attempt.attempt}: {attempt.outcome}{attempt.httpStatus ? ` · HTTP ${attempt.httpStatus}` : ""}{attempt.errorMessage ? ` — ${attempt.errorMessage}` : ""}</li>
                ))}
              </ul>
            ) : (
              <p>No sync attempt yet. The local package is still saved.</p>
            )}
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}

function SyncBadge({ label, problem, onOpen }: { label?: string; problem?: boolean; onOpen: () => void }) {
  const text = label || "Not Connected";
  return (
    <button type="button" className={cn("relative z-20 inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium", syncTone[text] ?? "bg-slate-100 text-slate-600")} onClick={(event) => { event.preventDefault(); event.stopPropagation(); onOpen(); }}>
      <span className="truncate">{text}</span>
      {problem ? <span className="inline-flex size-3.5 shrink-0 items-center justify-center rounded-full bg-red-600 text-[9px] leading-none font-bold text-white" aria-label="Problem">!</span> : null}
    </button>
  );
}

function ConditionMark({ status }: { status: string }) {
  if (status === "EXCEPTION") return <span className="inline-flex w-fit items-center rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700 ring-1 ring-red-600/15 ring-inset">Exception</span>;
  return <span className="text-[12px] text-slate-400">Normal</span>;
}

function CargoLine({ attributes }: { attributes: CargoAttribute[] }) {
  if (attributes.length === 0) return <span className="text-[12px] text-slate-300">—</span>;
  const special = attributes.some((item) => item !== "GENERAL");
  return <span className={cn("block truncate text-[12px]", special ? "font-medium text-amber-800" : "text-slate-500")}>{attributes.map(cargoLabel).join(", ")}</span>;
}

function listQuery(input: { status: string; q: string; from: string; to: string; cargo: string; link: string; condition: string; page: number }) {
  const query = new URLSearchParams();
  if (input.status !== "all") query.set("status", input.status);
  if (input.q) query.set("q", input.q);
  if (input.from) query.set("from", input.from);
  if (input.to) query.set("to", input.to);
  if (input.cargo) query.set("cargo", input.cargo);
  if (input.link !== "all") query.set("link", input.link);
  if (input.condition !== "all") query.set("condition", input.condition);
  query.set("page", String(input.page));
  return query.toString();
}
