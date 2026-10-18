import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Boxes, ChevronRight, Plus, Warehouse, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { countryName } from "../../domain/countries";
import { formatDate } from "../../domain/dates";
import type { Tone } from "../../domain/status";
import { Button, CopyButton, ErrorState, Money, PageHeader, StatusBadge, Weight } from "../../components/ui";
import { api } from "../../lib/api";
import { authClient } from "../../lib/auth";
import { cn } from "../../lib/utils";
import type { Dashboard } from "../../types/api";

const attentionDot: Record<Tone, string> = {
  danger: "bg-red-500",
  warning: "bg-amber-500",
  info: "bg-indigo-500",
  success: "bg-emerald-500",
  neutral: "bg-slate-300",
};

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export function DashboardPage() {
  const { data: session } = authClient.useSession();
  const dashboard = useQuery({ queryKey: ["dashboard"], queryFn: () => api<Dashboard>("/api/dashboard") });
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<{ isAdmin?: boolean; demoMode?: boolean }>("/api/me") });
  const storageKey = `hiobuy-onboarding-${session?.user.id ?? "guest"}`;
  const [hidden, setHidden] = useState(() => localStorage.getItem(storageKey) === "1");
  const data = dashboard.data;
  const firstName = (session?.user.name ?? "").trim().split(/\s+/)[0];

  if (dashboard.isLoading) return <DashboardSkeleton />;
  if (!data) return <ErrorState message="Could not load your dashboard." onRetry={() => void dashboard.refetch()} />;

  const tiles: { label: string; count: number; body: string; href: string; tone: "danger" | "warning" | "success" | "info" }[] = [
    { label: "Exceptions", count: data.counts.actionRequired, body: "Packages need your answer", href: "/app/packages?status=exception", tone: "danger" },
    { label: "To pay", count: data.counts.toPay, body: "Shipments with final freight", href: "/app/shipments?status=to_pay", tone: "warning" },
    { label: "Can consolidate", count: data.counts.ready, body: "Received packages with no exception", href: "/app/packages?status=received", tone: "success" },
    { label: "In transit", count: data.counts.inTransit, body: "Shipments on the way", href: "/app/shipments?status=in_transit", tone: "info" },
  ];

  return (
    <div>
      <PageHeader
        title={firstName ? `${greeting()}, ${firstName}` : "Dashboard"}
        subtitle={data.attention.length ? `${data.attention.length} ${data.attention.length === 1 ? "thing needs" : "things need"} your attention.` : "You're all caught up."}
        action={
          <>
            <Button variant="secondary" to="/app/packages/pre-alert">
              <Plus size={15} aria-hidden="true" /> Add Package
            </Button>
            <Button to="/app/consolidate">
              <Boxes size={15} aria-hidden="true" /> Consolidate & ship
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((tile) => (
          <Tile key={tile.label} {...tile} />
        ))}
      </div>

      {me.data?.demoMode ? (
        <section className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-[13px] font-semibold">Explore the operations workspace</h2>
            <p className="mt-0.5 text-[12px] text-slate-500">Sample customers, parcels, and freight. Nothing here is a live account.</p>
          </div>
          <Button variant="secondary" size="sm" to="/admin/demo">Explore Admin Demo</Button>
        </section>
      ) : null}

      {!hidden && session?.user.memberCode ? (
        <section className="relative mt-6 overflow-hidden rounded-2xl border border-indigo-100 bg-[linear-gradient(135deg,#eef2ff_0%,#ffffff_60%)] p-4 sm:p-5">
          <button
            type="button"
            className="absolute top-3 right-3 grid size-7 place-items-center rounded-md text-slate-400 hover:bg-white hover:text-slate-700"
            aria-label="Hide getting started"
            onClick={() => {
              localStorage.setItem(storageKey, "1");
              setHidden(true);
            }}
          >
            <X size={15} />
          </button>
          <h2 className="text-[15px] font-semibold tracking-tight">How forwarding works</h2>
          <ol className="mt-3 grid gap-3 sm:grid-cols-3">
            <Step n={1} title="Ship to our warehouse" body={data.warehouse.available ? `Use the warehouse address with your member code ${session.user.memberCode}.` : "The warehouse address isn't available until HioBuy is connected. Don't use a placeholder."}>
              {data.warehouse.available ? <CopyButton value={data.warehouse.fullAddress} label="Copy address" size="sm" toastTitle="Warehouse address copied." /> : <Button variant="secondary" size="sm" to="/app/warehouse">Warehouse address</Button>}
            </Step>
            <Step n={2} title="Add the package" body="Paste the domestic tracking number so we can match it on arrival.">
              <Button variant="secondary" size="sm" to="/app/packages/pre-alert">Add Package</Button>
            </Step>
            <Step n={3} title="Consolidate and pay" body="Combine ready parcels into one box. Pay freight after it's weighed.">
              <Button variant="secondary" size="sm" to="/app/consolidate">Consolidate</Button>
            </Step>
          </ol>
        </section>
      ) : null}

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold tracking-tight">Needs your attention</h2>
        <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-white">
          {data.attention.length === 0 ? (
            <p className="px-4 py-6 text-center text-[13px] text-slate-500">Nothing is waiting on you right now.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.attention.map((item) => (
                <li key={item.title + item.href}>
                  <Link to={item.href} className="group flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-slate-50">
                    <span className="flex min-w-0 items-start gap-3">
                      <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", attentionDot[item.tone])} aria-hidden="true" />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">{item.title}</span>
                        <span className="block truncate text-[13px] text-slate-500">{item.body}</span>
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1 text-[13px] font-medium text-slate-500 group-hover:text-ink">
                      Review <ChevronRight size={15} className="transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="mt-6 grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-slate-200/80 bg-white p-4 sm:p-5">
          <div className="flex items-center gap-1.5 text-[12px] text-slate-500">
            <Warehouse size={13} aria-hidden="true" /> {data.warehouse.available ? `${data.warehouse.name} · your member code` : "Warehouse address"}
          </div>
          <div className="mt-1.5 font-mono text-[1.65rem] leading-none font-semibold tracking-tight">{data.warehouse.memberCode}</div>
          <p className="mt-2 text-[13px] text-slate-500">{data.warehouse.available ? data.warehouse.street : "HioBuy isn't connected, so there is no warehouse address to copy."}</p>
          <div className="mt-3 flex items-center gap-1">
            {data.warehouse.available ? <CopyButton value={data.warehouse.fullAddress} label="Copy address" toastTitle="Warehouse address copied." /> : null}
            <Button variant="ghost" to="/app/warehouse">Address details</Button>
          </div>
        </div>
        <div className="rounded-xl border border-slate-200/80 bg-white p-4 sm:p-5">
          <div className="text-[12px] text-slate-500">Wallet balance</div>
          <div className="mt-1.5 text-[1.65rem] leading-none font-semibold tracking-tight">
            <Money fen={data.wallet.balanceFen} />
          </div>
          <p className={cn("mt-2 text-[13px]", data.wallet.lowBalance ? "font-medium text-amber-700" : "text-slate-500")}>
            {data.wallet.lowBalance ? "Low balance. Top up before your next freight payment." : "Used for freight and warehouse charges."}
          </p>
          <div className="mt-3 flex items-center gap-1">
            <Button variant="secondary" to="/app/wallet/top-up">
              <Plus size={14} aria-hidden="true" /> Top up
            </Button>
            <Button variant="ghost" to="/app/wallet">Activity</Button>
          </div>
        </div>
      </section>

      <section className="mt-6 grid gap-3 lg:grid-cols-3">
        <RecentList title="Recent packages" href="/app/packages" empty="No packages yet.">
          {data.recentPackages.map((item) => (
            <RecentRow key={item.id} to={`/app/packages/${item.id}`} title={item.publicId} meta={<Weight grams={item.weightGrams} />}>
              <StatusBadge label={item.displayStatus.label} tone={item.displayStatus.tone} statusKey={item.displayStatus.key} />
            </RecentRow>
          ))}
        </RecentList>
        <RecentList title="Recent shipments" href="/app/shipments" empty="No shipments yet.">
          {data.recentShipments.map((item) => (
            <RecentRow key={item.id} to={`/app/shipments/${item.id}`} title={item.publicId} meta={item.destination ? countryName(item.destination.countryCode) : "—"}>
              <StatusBadge label={item.displayStatus.label} tone={item.displayStatus.tone} statusKey={item.displayStatus.key} />
            </RecentRow>
          ))}
        </RecentList>
        <RecentList title="Wallet activity" href="/app/wallet" empty="No activity yet.">
          {data.recentTransactions.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px]">
              <span className="min-w-0">
                <span className="block truncate font-medium">{item.description}</span>
                <span className="block text-[12px] text-slate-400">{formatDate(item.createdAt)}</span>
              </span>
              <span className={cn("font-medium", item.amountFen > 0 && "text-emerald-700")}>
                <Money fen={item.amountFen} signed />
              </span>
            </li>
          ))}
        </RecentList>
      </section>
    </div>
  );
}

const tileTone = {
  danger: { ring: "border-red-200 bg-red-50/70", label: "text-red-700" },
  warning: { ring: "border-amber-200 bg-amber-50/70", label: "text-amber-800" },
  success: { ring: "border-emerald-200 bg-emerald-50/60", label: "text-emerald-700" },
  info: { ring: "border-sky-200 bg-sky-50/60", label: "text-sky-700" },
};

function Tile({ label, count, body, href, tone }: { label: string; count: number; body: string; href: string; tone: keyof typeof tileTone }) {
  const active = count > 0;
  return (
    <Link
      to={href}
      className={cn(
        "group relative rounded-xl border px-4 py-3.5 transition-[border-color,box-shadow] hover:shadow-[0_4px_12px_-4px_rgba(16,24,40,0.12)]",
        active ? tileTone[tone].ring : "border-slate-200/80 bg-white",
      )}
    >
      <div className={cn("text-[13px] font-medium", active ? tileTone[tone].label : "text-slate-500")}>{label}</div>
      <div className={cn("mt-1 text-[1.85rem] leading-none font-semibold tracking-tight tabular-nums", !active && "text-slate-300")}>{count}</div>
      <div className="mt-1.5 text-[12px] text-slate-500">{body}</div>
      <ArrowUpRight size={15} className="absolute top-3.5 right-3.5 text-slate-300 transition group-hover:text-slate-500" aria-hidden="true" />
    </Link>
  );
}

function Step({ n, title, body, children }: { n: number; title: string; body: string; children: ReactNode }) {
  return (
    <li className="flex gap-3 rounded-xl bg-white/80 p-3.5 ring-1 ring-indigo-100/80 sm:flex-col sm:gap-0">
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-brand text-[12px] font-semibold text-white">{n}</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-[13px] font-semibold sm:mt-2">{title}</span>
        <span className="mt-0.5 flex-1 text-[12px] leading-[18px] text-slate-500">{body}</span>
        <span className="mt-2.5">{children}</span>
      </span>
    </li>
  );
}

function RecentList({ title, href, empty, children }: { title: string; href: string; empty: string; children: ReactNode[] }) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200/80 bg-white">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
        <h2 className="text-[13px] font-semibold">{title}</h2>
        <Link to={href} className="text-[12px] font-medium text-slate-500 hover:text-ink">
          View all
        </Link>
      </div>
      {children.length ? <ul className="divide-y divide-slate-100">{children}</ul> : <p className="px-4 py-6 text-center text-[13px] text-slate-400">{empty}</p>}
    </section>
  );
}

function RecentRow({ to, title, meta, children }: { to: string; title: string; meta: ReactNode; children: ReactNode }) {
  return (
    <li>
      <Link to={to} className="flex items-center justify-between gap-2 px-4 py-2.5 text-[13px] transition-colors hover:bg-slate-50">
        <span className="min-w-0">
          <span className="block font-medium">{title}</span>
          <span className="block text-[12px] text-slate-400">{meta}</span>
        </span>
        {children}
      </Link>
    </li>
  );
}

function DashboardSkeleton() {
  return (
    <div role="status" aria-label="Loading dashboard">
      <div className="mb-6 h-9 w-64 animate-pulse rounded-lg bg-slate-200" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="h-[104px] animate-pulse rounded-xl bg-white ring-1 ring-slate-200/80" />
        ))}
      </div>
      <div className="mt-6 h-48 animate-pulse rounded-xl bg-white ring-1 ring-slate-200/80" />
    </div>
  );
}

