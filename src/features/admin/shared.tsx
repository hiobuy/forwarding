import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { formatDateTime } from "../../domain/dates";
import type { Tone } from "../../domain/status";
import { useToast } from "../../components/toast";
import { ApiError, api } from "../../lib/api";
import { usePageTitle } from "../../lib/brand";
import { cn } from "../../lib/utils";
import type { PackageItem, Shipment } from "../../types/api";

export type Owner = { id: string; name: string; email: string; memberCode: string } | null;
export type AdminPackage = Omit<PackageItem, "photos"> & {
  ownerId: string;
  owner: Owner;
  hiobuyStatus: string | null;
  hiobuySyncedAt: string | null;
  syncLabel?: string;
  syncRemoteId?: string | null;
  syncReason?: string | null;
  canSync?: boolean;
  canPull?: boolean;
};
export type ShipmentEarning = {
  status: "pending" | "provisional" | "finalized" | "adjusted" | "unavailable";
  fullyRefunded: boolean;
  customerChargedUsdFen: number | null;
  hiobuyCostCnyFen: number | null;
  hiobuyCostUsdFen: number | null;
  grossProfitUsdFen: number | null;
  markupBps: number | null;
  markupCnyFen: number | null;
  cnyPerUsdE4: number | null;
  paidAt: string | null;
  adjustments: { id: string; kind: "refund" | "extra_charge" | "cost"; usdFen: number | null; cnyFen: number | null; note: string; createdAt: string }[];
};

export type AdminShipment = Omit<Shipment, "photos"> & {
  ownerId: string;
  owner: Owner;
  hiobuyShipmentId: string | null;
  hiobuyStatus: string | null;
  hiobuyPaymentStatus: string | null;
  interceptionStatus: string | null;
  hiobuySyncedAt: string | null;
  syncLabel?: string;
  syncRemoteId?: string | null;
  fulfillment?: { key: string; label: string; tone: "success" | "warning" | "danger" | "info" | "neutral" };
  customerPayment?: string;
  hiobuyPayment?: string;
  canPull?: boolean;
  canPayHioBuy?: boolean;
  earning: ShipmentEarning;
};

export type AdminOverview = {
  users: { total: number; newLast7Days: number };
  packages: { total: number; inWarehouse: number; byStatus: { key: string; label: string; count: number }[] };
  shipments: { total: number; toPayFen: number; byStatus: { key: string; label: string; count: number }[] };
  wallet: { balanceFen: number; topUpsLast30DaysFen: number; paymentsLast30DaysFen: number };
  queues: {
    toReceive: number;
    servicesOpen: number;
    waitingOnCustomer: number;
    toPack: number;
    toDispatch: number;
    inTransit: number;
    unclaimed: number;
    unansweredQuestions: number;
    publishedAnswers: number;
    pendingTopups: number;
    hiobuyPaymentsPending: number;
  };
};

export type AdminUser = {
  id: string;
  name: string;
  email: string;
  memberCode: string;
  country: string | null;
  status: string;
  emailVerified: boolean;
  createdAt: string;
  isAdmin: boolean;
  staffRole?: string | null;
  balanceFen: number;
  packageCount: number;
  shipmentCount: number;
  toPayCount: number;
};

export type AdminAccess = {
  email: string;
  name: string;
  role: "owner" | "manager" | "support" | "demo";
  permissions: string[];
  mfaEnabled: boolean;
  hiobuyPay2fa?: boolean;
  githubUrl?: string | null;
};

export function useDemoPreview() {
  const access = useAdminAccess();
  return access.data?.role === "demo";
}

export function useAdminAccess(enabled = true) {
  return useQuery({
    queryKey: ["admin", "me"],
    queryFn: () => api<AdminAccess>("/api/admin/me"),
    enabled,
    staleTime: 30_000,
  });
}

export function allows(access: { permissions: string[] } | undefined, permission: string) {
  return Boolean(access?.permissions.includes(permission));
}

/** Every admin write refreshes the admin lists and the overview, then confirms with a toast. */
export function useAdminAction<TInput>(path: (input: TInput) => string, options: { method?: string; success: (input: TInput) => string; body?: (input: TInput) => unknown; onDone?: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (input: TInput) =>
      api(path(input), { method: options.method ?? "POST", body: options.body ? JSON.stringify(options.body(input)) : JSON.stringify({}) }),
    onSuccess: async (_data, input) => {
      await queryClient.invalidateQueries({ queryKey: ["admin"] });
      toast({ title: options.success(input), tone: "success" });
      options.onDone?.();
    },
    onError: (reason) => toast({ title: reason instanceof ApiError ? reason.message : "That didn't work. Try again.", tone: "danger" }),
  });
}

export function HiobuyStatus({ status, syncedAt, syncLabel, remoteId, compact = false }: { status: string | null; syncedAt: string | null; syncLabel?: string; remoteId?: string | null; compact?: boolean }) {
  if (syncLabel && syncLabel !== "Not linked") {
    if (compact) return <span className="text-[12px] text-slate-600">{syncLabel}</span>;
    return (
      <span className="block min-w-0">
        <span className="block text-[13px] font-medium text-ink">{syncLabel}</span>
        {remoteId ? <span className="block truncate font-mono text-[11px] text-slate-400">{remoteId}</span> : null}
        {status && syncedAt ? <span className="block truncate text-[11px] text-slate-400">{status} · {formatDateTime(syncedAt)}</span> : <span className="block text-[11px] text-slate-400">Open Sync Center for the log</span>}
      </span>
    );
  }
  if (!status || !syncedAt) {
    if (compact) return <span className="text-[12px] text-slate-300">—</span>;
    return (
      <span className="block min-w-0">
        <span className="block text-[13px] text-slate-400">Not linked</span>
        <span className="block text-[11px] text-slate-300">No HioBuy sync yet</span>
      </span>
    );
  }
  if (compact) {
    return (
      <span className="block truncate text-[12px] text-slate-500" title={`${status} · ${formatDateTime(syncedAt)}`}>
        {status}
      </span>
    );
  }
  return (
    <span className="block min-w-0">
      <span className="block truncate font-mono text-[12px] font-medium text-ink">{status}</span>
      <span className="block truncate text-[11px] text-slate-400">{formatDateTime(syncedAt)}</span>
    </span>
  );
}

export function OwnerCell({ owner }: { owner: Owner }) {
  if (!owner) return <span className="text-slate-400">Unknown</span>;
  return (
    <span className="block min-w-0">
      <span className="block truncate text-[13px] font-medium text-ink">{owner.name}</span>
      <span className="block truncate font-mono text-[11px] text-slate-400">{owner.memberCode}</span>
    </span>
  );
}

export function StatusTabs({
  value,
  primary,
  more = [],
  onChange,
}: {
  value: string;
  primary: { key: string; label: string; count?: number }[];
  more?: { key: string; label: string; count?: number }[];
  onChange: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  const selectedMore = more.find((item) => item.key === value);
  useEffect(() => {
    if (!open) return;
    function close(event: MouseEvent) {
      if (!menu.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  return (
    <div className="mb-3 flex items-end gap-1 border-b border-line">
      <div className="flex min-w-0 flex-1 gap-0.5 overflow-x-auto" role="tablist">
        {primary.map((item) => (
          <TabButton key={item.key} item={item} selected={value === item.key} onClick={() => onChange(item.key)} />
        ))}
      </div>
      {more.length ? (
        <div className="relative shrink-0" ref={menu}>
          <button
            type="button"
            className={cn(tabClass(Boolean(selectedMore)), "gap-1")}
            aria-expanded={open}
            aria-haspopup="menu"
            onClick={() => setOpen((current) => !current)}
          >
            {selectedMore ? selectedMore.label : "More"}
            {selectedMore ? <Count count={selectedMore.count} selected /> : null}
            <ChevronDown size={14} aria-hidden="true" />
          </button>
          {open ? (
            <div className="absolute right-0 z-20 mt-1 w-48 rounded-md border border-line bg-white py-1 shadow-[0_8px_24px_rgba(16,24,40,0.08)]" role="menu">
              {more.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  role="menuitem"
                  className={cn("flex w-full items-center justify-between px-3 py-1.5 text-left text-[13px]", item.key === value ? "font-medium text-ink" : "text-slate-600 hover:bg-slate-50")}
                  onClick={() => {
                    onChange(item.key);
                    setOpen(false);
                  }}
                >
                  {item.label}
                  <Count count={item.count} selected={item.key === value} />
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function TabButton({ item, selected, onClick }: { item: { key: string; label: string; count?: number }; selected: boolean; onClick: () => void }) {
  return (
    <button type="button" role="tab" aria-selected={selected} className={tabClass(selected)} onClick={onClick}>
      {item.label}
      <Count count={item.count} selected={selected} />
    </button>
  );
}

function tabClass(selected: boolean) {
  return cn("-mb-px inline-flex shrink-0 items-center border-b-2 px-2.5 py-2 text-[13px] whitespace-nowrap", selected ? "border-ink font-medium text-ink" : "border-transparent text-slate-500 hover:text-ink");
}

function Count({ count, selected }: { count?: number; selected?: boolean }) {
  if (count == null) return null;
  return <span className={cn("ml-1.5 text-[12px] tabular-nums", selected ? "text-ink" : count ? "text-slate-400" : "text-slate-300")}>{count}</span>;
}

const statusDot: Record<Tone, string> = {
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  danger: "bg-red-500",
  info: "bg-slate-400",
  neutral: "bg-slate-300",
};

/** Status as text plus a dot. Color stays on the dot so a table is not a row of pills. */
export function StatusMark({ label, tone }: { label: string; tone: Tone; statusKey?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] font-medium text-slate-700">
      <span className={cn("size-1.5 shrink-0 rounded-full", statusDot[tone])} aria-hidden="true" />
      {label}
    </span>
  );
}

export function AdminHeader({
  title,
  meta,
  action,
  back,
  badge,
}: {
  title: string;
  meta?: ReactNode;
  action?: ReactNode;
  back?: { to: string; label: string };
  badge?: ReactNode;
}) {
  usePageTitle(title);
  return (
    <header className="mb-5">
      {back ? (
        <Link to={back.to} className="mb-2 inline-flex items-center gap-1 text-[12px] font-medium text-slate-500 hover:text-ink">
          <ArrowLeft size={13} aria-hidden="true" />
          {back.label}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <h1 className="truncate text-[20px] leading-7 font-semibold tracking-tight text-ink">{title}</h1>
          {badge}
        </div>
        {action ? <div className="flex flex-wrap items-center gap-2">{action}</div> : null}
      </div>
      {meta ? <div className="mt-1 max-w-3xl text-[13px] leading-5 text-slate-500">{meta}</div> : null}
    </header>
  );
}

export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn("overflow-hidden rounded-lg border border-line bg-white", className)}>{children}</section>;
}

export function ListFrame({ toolbar, children }: { toolbar?: ReactNode; children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-white">
      {toolbar ? <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center">{toolbar}</div> : null}
      {children}
    </div>
  );
}

export function ListEmpty({ title, body }: { title: string; body: string }) {
  return (
    <div className="px-4 py-16 text-center">
      <p className="text-[13px] font-medium text-ink">{title}</p>
      <p className="mt-1 text-[13px] text-slate-500">{body}</p>
    </div>
  );
}

export function RowsSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">Loading</span>
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="flex items-center gap-8 border-b border-slate-100 px-4 py-3 last:border-b-0">
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="h-3 w-28 animate-pulse rounded bg-slate-200/70" />
            <div className="h-2.5 w-44 max-w-full animate-pulse rounded bg-slate-100" />
          </div>
          <div className="h-3 w-14 animate-pulse rounded bg-slate-100" />
        </div>
      ))}
    </div>
  );
}

/** Compact controls for list toolbars. Taller form fields stay on `inputClass`. */
export const filterControl =
  "h-8 rounded-md border border-slate-200 bg-white px-2 text-[13px] text-slate-700 outline-none transition-colors hover:border-slate-300 focus:border-slate-400 focus:ring-2 focus:ring-slate-100";

export function TableShell({ head, children, grid, minWidth = 0, bare = false, leading }: { head: string[]; children: ReactNode; grid: string; minWidth?: number; bare?: boolean; leading?: ReactNode }) {
  const width = minWidth ? { minWidth } : undefined;
  return (
    <div className={cn("overflow-x-auto", !bare && "overflow-hidden rounded-lg border border-line bg-white")}>
      <div className={cn("grid h-9 items-center gap-x-4 border-b border-slate-100 px-4", grid)} style={width}>
        {leading}
        {head.map((label, index) => (
          <span key={`${label}-${index}`} className={cn("truncate text-[12px] font-medium text-slate-500", label.startsWith(">") && "text-right")}>
            {label.replace(/^>/, "")}
          </span>
        ))}
      </div>
      <ul className="divide-y divide-slate-100" style={width}>{children}</ul>
    </div>
  );
}

/** Parse "1.25" (kg) or "32.5" (cm) into integer grams / millimetres. */
export function toInt(value: string, factor: number): number | null {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return Math.round(number * factor);
}

export function dollarsToFen(value: string): number | null {
  const trimmed = value.trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const negative = trimmed.startsWith("-");
  const [whole = "0", frac = ""] = trimmed.replace("-", "").split(".");
  const fen = Number(whole) * 100 + Number((frac + "00").slice(0, 2));
  return negative ? -fen : fen;
}
