import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { ErrorState, Money } from "../../components/ui";
import { api } from "../../lib/api";
import { cn } from "../../lib/utils";
import { AdminHeader, Panel, allows, useAdminAccess, type AdminOverview as Overview } from "./shared";

export function AdminOverview() {
  const query = useQuery({ queryKey: ["admin", "overview"], queryFn: () => api<Overview>("/api/admin/overview") });
  if (query.isLoading) return <OverviewSkeleton />;
  if (query.isError || !query.data) return <ErrorState message="Could not load the overview." onRetry={() => void query.refetch()} />;
  return <OverviewScreen data={query.data} />;
}

function OverviewScreen({ data }: { data: Overview }) {
  const toPayCount = data.shipments.byStatus.find((item) => item.key === "to_pay")?.count ?? 0;
  const needsYou = [
    { label: "Waiting on customers", body: "Exceptions still unanswered", count: data.queues.waitingOnCustomer, href: "/admin/packages?condition=exception" },
    { label: "Unclaimed parcels", body: "Arrived without a member code", count: data.queues.unclaimed, href: "/admin/packages" },
    { label: "Unanswered questions", body: "Assistant has no published answer", count: data.queues.unansweredQuestions, href: "/admin/assistant" },
    { label: "HioBuy payments pending", body: "Customer paid, HioBuy still waiting for payment", count: data.queues.hiobuyPaymentsPending, href: "/admin/shipments?status=wait_payment" },
  ];
  const pipeline = [
    { label: "Pending", count: data.queues.toReceive, href: "/admin/packages?status=pending", title: "Waiting for the warehouse to receive the parcel. An inbound notice is not a receipt." },
    { label: "Services", count: data.queues.servicesOpen, href: "/admin/packages?vas=open", title: "Photos, inspections, and repacking at HioBuy." },
    { label: "Packing", count: data.queues.toPack, href: "/admin/shipments?status=pending", title: "HioBuy is still processing these shipments." },
    { label: "Dispatch", count: data.queues.toDispatch, href: "/admin/shipments?status=wait_ship", title: "Ready for the warehouse to hand them to the carrier." },
    { label: "Shipped", count: data.queues.inTransit, href: "/admin/shipments?status=shipped", title: "Left the warehouse." },
  ];
  const open = needsYou.reduce((sum, item) => sum + item.count, 0);

  return (
    <div className="space-y-4">
      <AdminHeader title="Overview" />
      <SetupRequired />

      <Panel className="bg-slate-100">
        <ul className="grid grid-cols-2 gap-px lg:grid-cols-4">
          <Metric href="/admin/users" label="Customers" value={data.users.total.toLocaleString()} note={`${data.users.newLast7Days} joined in 7 days`} />
          <Metric href="/admin/packages" label="In warehouse" value={data.packages.inWarehouse.toLocaleString()} note={`${data.packages.total} on record`} />
          <Metric href="/admin/shipments?status=wait_payment" label="Freight due" value={<Money fen={data.shipments.toPayFen} />} note={`${toPayCount} unpaid`} />
          <Metric href="/admin/users" label="Customer wallets" value={<Money fen={data.wallet.balanceFen} />} note="Held for customers" />
        </ul>
      </Panel>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(280px,0.85fr)]">
        <Panel>
          <div className="flex items-baseline justify-between gap-3 border-b border-slate-100 px-4 py-3">
            <h2 className="text-[13px] font-semibold tracking-tight">Needs attention</h2>
            <span className={cn("text-[12px] tabular-nums", open ? "font-medium text-ink" : "text-slate-400")}>{open ? `${open} open` : "Clear"}</span>
          </div>
          <ul>
            {needsYou.map((item) => (
              <li key={item.label} className="border-b border-slate-100 last:border-b-0">
                <Link to={item.href} className="group grid grid-cols-[2.75rem_minmax(0,1fr)_1rem] items-center gap-3 px-4 py-3 hover:bg-slate-50">
                  <span className={cn("text-[22px] leading-none font-semibold tracking-tight tabular-nums", item.count ? "text-ink" : "text-slate-200")}>{item.count}</span>
                  <span className="min-w-0">
                    <span className={cn("block truncate text-[13px]", item.count ? "font-medium text-ink" : "text-slate-500")}>{item.label}</span>
                    {item.count ? <span className="mt-0.5 block truncate text-[12px] text-slate-500">{item.body}</span> : null}
                  </span>
                  <ChevronRight size={15} aria-hidden="true" className={cn("justify-self-end", item.count ? "text-slate-400 group-hover:text-ink" : "text-slate-200")} />
                </Link>
              </li>
            ))}
          </ul>
        </Panel>

        <EarningsSummary />
      </div>

      <Panel>
        <div className="border-b border-slate-100 px-4 py-3">
          <h2 className="text-[13px] font-semibold tracking-tight">Fulfillment</h2>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5">
          {pipeline.map((item) => (
            <Link
              key={item.label}
              to={item.href}
              title={item.title}
              className={cn(
                "border-b border-slate-100 px-4 py-3.5 hover:bg-slate-50",
                "max-sm:odd:border-r max-sm:last:col-span-2 max-sm:last:border-r-0 max-sm:last:border-b-0",
                "sm:border-r sm:border-b-0 sm:last:border-r-0",
              )}
            >
              <span className={cn("block text-[22px] leading-none font-semibold tracking-tight tabular-nums", !item.count && "text-slate-200")}>{item.count}</span>
              <span className="mt-1.5 block text-[12px] text-slate-500">{item.label}</span>
            </Link>
          ))}
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <StatusBars title="Packages by status" total={data.packages.total} rows={data.packages.byStatus} hrefBase="/admin/packages?status=" empty="No packages yet." />
        <StatusBars title="Shipments by status" total={data.shipments.total} rows={data.shipments.byStatus} hrefBase="/admin/shipments?status=" empty="No shipments yet." />
      </div>
    </div>
  );
}

function SetupRequired() {
  const settings = useQuery({
    queryKey: ["admin", "settings"],
    queryFn: () => api<{ connected: boolean; connection: { configured: boolean } }>("/api/admin/settings"),
  });
  if (!settings.data || (settings.data.connected && settings.data.connection.configured)) return null;
  return (
    <Link to="/admin/settings" className="flex items-center justify-between gap-3 rounded-lg border border-line px-4 py-3 hover:bg-slate-50">
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-ink">Setup required</span>
        <span className="mt-0.5 block text-[12px] text-slate-500">Connect HioBuy before warehouse fulfillment can run.</span>
      </span>
      <ChevronRight size={15} className="shrink-0 text-slate-400" aria-hidden="true" />
    </Link>
  );
}

function Metric({ href, label, value, note }: { href: string; label: string; value: ReactNode; note: string }) {
  return (
    <li className="bg-white">
      <Link to={href} className="block h-full px-4 py-3.5 hover:bg-slate-50">
        <span className="block truncate text-[12px] text-slate-500">{label}</span>
        <span className="mt-1.5 block truncate text-[22px] leading-none font-semibold tracking-tight tabular-nums">{value}</span>
        <span className="mt-1.5 block truncate text-[12px] text-slate-400">{note}</span>
      </Link>
    </li>
  );
}

function StatusBars({ title, total, rows, hrefBase, empty }: { title: string; total: number; rows: { key: string; label: string; count: number }[]; hrefBase: string; empty: string }) {
  const max = Math.max(1, ...rows.map((row) => row.count));
  return (
    <Panel>
      <div className="flex items-baseline justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <h2 className="text-[13px] font-semibold tracking-tight">{title}</h2>
        <span className="text-[12px] text-slate-400 tabular-nums">{total}</span>
      </div>
      {rows.length === 0 ? <p className="px-4 py-6 text-[13px] text-slate-400">{empty}</p> : null}
      <ul className="px-2 py-1.5">
        {rows.map((row) => (
          <li key={row.key}>
            <Link
              to={`${hrefBase}${filterKey(row.key)}`}
              className="grid grid-cols-[max-content_minmax(4rem,1fr)_2rem] items-center gap-3 rounded-md px-2 py-1.5 hover:bg-slate-50"
              title={`${row.label}: ${row.count} of ${total}`}
            >
              <span className="text-[13px] whitespace-nowrap text-slate-600">{row.label}</span>
              <span className="relative h-1 rounded-full bg-slate-100">
                <span className="absolute inset-y-0 left-0 rounded-full bg-ink" style={{ width: row.count ? `max(3px, ${(row.count / max) * 100}%)` : 0 }} />
              </span>
              <span className={cn("text-right text-[13px] tabular-nums", row.count ? "font-medium text-ink" : "text-slate-300")}>{row.count}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function filterKey(key: string) {
  if (key === "waiting_for_weight") return "consolidating";
  if (key === "delivered") return "completed";
  return key;
}

type EarningsReport = {
  range: "today" | "7d" | "30d";
  label: string;
  revenueUsdFen: number;
  costUsdFen: number;
  grossProfitUsdFen: number;
  paidShipments: number;
  excludedShipments: number;
  untimedShipments: number;
  grossMarginBps: number | null;
  averageProfitUsdFen: number | null;
};

function EarningsSummary() {
  const access = useAdminAccess();
  const allowed = allows(access.data, "earnings.read");
  const [range, setRange] = useState<EarningsReport["range"]>("30d");
  const query = useQuery({ queryKey: ["admin", "earnings", range], queryFn: () => api<EarningsReport>(`/api/admin/earnings?range=${range}`), enabled: allowed });
  if (!allowed) return null;
  const data = query.data;
  return (
    <Panel>
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <h2 className="text-[13px] font-semibold tracking-tight">Gross profit</h2>
        <div className="flex items-center" role="tablist" aria-label="Earnings period">
          {([["today", "Today"], ["7d", "7d"], ["30d", "30d"]] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={range === id}
              className={cn("rounded-md px-2 py-1 text-[12px]", range === id ? "bg-slate-100 font-medium text-ink" : "text-slate-500 hover:text-ink")}
              onClick={() => setRange(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="px-4 py-3.5">
        {query.isLoading ? <div className="h-16 animate-pulse rounded bg-slate-100" /> : null}
        {query.isError ? <ErrorState message="Could not load gross profit." onRetry={() => void query.refetch()} /> : null}
        {data ? (
          <>
            <p className="text-[28px] leading-none font-semibold tracking-tight tabular-nums">
              <Money fen={data.grossProfitUsdFen} />
            </p>
            <p className="mt-2 text-[12px] leading-5 text-slate-500">
              {data.paidShipments === 0 ? (
                "No paid shipments in this period"
              ) : (
                <>
                  {data.grossMarginBps == null ? "—" : `${(data.grossMarginBps / 100).toFixed(1)}% margin`}
                  <span className="px-1.5 text-slate-300">·</span>
                  {data.averageProfitUsdFen == null ? "—" : <><Money fen={data.averageProfitUsdFen} /> avg</>}
                </>
              )}
            </p>
            <p className="mt-0.5 text-[12px] text-slate-400">{data.label}</p>
            <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-slate-100 pt-3">
              <div>
                <dt className="text-[12px] text-slate-500">Revenue</dt>
                <dd className="mt-0.5 text-[13px] font-medium tabular-nums"><Money fen={data.revenueUsdFen} /></dd>
              </div>
              <div>
                <dt className="text-[12px] text-slate-500">HioBuy cost</dt>
                <dd className="mt-0.5 text-[13px] font-medium tabular-nums"><Money fen={data.costUsdFen} /></dd>
              </div>
              <div>
                <dt className="text-[12px] text-slate-500">Paid</dt>
                <dd className="mt-0.5 text-[13px] font-medium tabular-nums">{data.paidShipments}</dd>
              </div>
            </dl>
            {data.excludedShipments || data.untimedShipments ? (
              <p className="mt-3 text-[12px] leading-5 text-slate-400">
                {data.excludedShipments ? `${data.excludedShipments} excluded, missing a cost snapshot.` : ""}
                {data.excludedShipments && data.untimedShipments ? " " : ""}
                {data.untimedShipments ? `${data.untimedShipments} excluded, no payment time.` : ""}
              </p>
            ) : null}
          </>
        ) : null}
      </div>
    </Panel>
  );
}

function OverviewSkeleton() {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">Loading overview</span>
      <div className="mb-5 h-7 w-32 animate-pulse rounded bg-slate-100" />
      <div className="h-24 animate-pulse rounded-lg border border-line bg-slate-50" />
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="h-48 animate-pulse rounded-lg border border-line bg-slate-50" />
        <div className="h-48 animate-pulse rounded-lg border border-line bg-slate-50" />
      </div>
    </div>
  );
}
