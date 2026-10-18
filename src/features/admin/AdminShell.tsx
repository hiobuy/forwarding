import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { ArrowUpRight, BookOpen, Boxes, Calculator, CreditCard, LayoutGrid, Menu, MessageSquare, Package, PanelLeft, PanelLeftClose, Settings, ShieldAlert, Users, Wallet, X, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router";
import { Button } from "../../components/ui";
import { formatCnyFen } from "../../domain/freight";
import { ApiError, adminHref, api, holdDemoScope } from "../../lib/api";
import { useBrand } from "../../lib/brand";
import { authClient } from "../../lib/auth";
import { cn } from "../../lib/utils";
import { allows, useAdminAccess, type AdminOverview } from "./shared";

const STORAGE_KEY = "hiobuy.admin.sidebar";
const iconProps = { size: 16, strokeWidth: 1.75, "aria-hidden": true as const };

const links: { to: string; label: string; icon: LucideIcon; end?: boolean; count?: (overview: AdminOverview) => number }[] = [
  { to: "/admin", label: "Overview", icon: LayoutGrid, end: true },
  { to: "/admin/packages", label: "Packages", icon: Package },
  { to: "/admin/shipments", label: "Shipments", icon: Boxes },
  { to: "/admin/users", label: "Customers", icon: Users },
  { to: "/admin/payments", label: "Payments", icon: CreditCard, count: (overview) => overview.queues.pendingTopups },
  { to: "/admin/assistant", label: "Assistant", icon: MessageSquare, count: (overview) => overview.queues.unansweredQuestions },
  { to: "/admin/calculator", label: "Calculator", icon: Calculator },
];

const settingsLink = { to: "/admin/settings", label: "Settings", icon: Settings };

function readCollapsed() {
  try {
    return localStorage.getItem(STORAGE_KEY) === "collapsed";
  } catch {
    return false;
  }
}

/** Signed-in admins only. Everyone else gets a clear explanation instead of a blank page. */
export function RequireAdmin() {
  const { data: session, isPending } = authClient.useSession();
  const me = useAdminAccess(Boolean(session));
  if (isPending || (session && me.isLoading)) return <FullScreen>Loading…</FullScreen>;
  if (!session) return <Navigate to="/auth/login" replace />;
  if (me.isLoading) return <FullScreen>Checking admin access…</FullScreen>;
  if (me.error) {
    const forbidden = me.error instanceof ApiError && me.error.status === 403;
    return (
      <FullScreen>
        <div className="max-w-sm text-center">
          <span className="mx-auto grid size-12 place-items-center rounded-full bg-amber-50 text-amber-600">
            <ShieldAlert size={22} aria-hidden="true" />
          </span>
          <h1 className="mt-4 text-lg font-semibold text-ink">{forbidden ? "No admin access" : "Couldn't open the admin area"}</h1>
          <p className="mt-1.5 text-[13px] leading-5 text-slate-500">{me.error.message}</p>
          <Button className="mt-5" variant="secondary" to="/app/dashboard">
            Back to the customer app
          </Button>
        </div>
      </FullScreen>
    );
  }
  return <AdminShell email={session.user.email} />;
}

/** Signed-in customers on a demo instance. Staff permissions are not granted. */
export function RequireDemo() {
  const { data: session, isPending } = authClient.useSession();
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } }));
  const [release] = useState(holdDemoScope);
  useEffect(() => release, [release]);
  if (isPending) return <FullScreen>Loading…</FullScreen>;
  if (!session) return <Navigate to="/auth/login?next=/admin/demo" replace />;
  return (
    <QueryClientProvider client={client}>
      <DemoGate email={session.user.email} />
    </QueryClientProvider>
  );
}

function DemoGate({ email }: { email: string }) {
  const me = useAdminAccess(true);
  if (me.isLoading) return <FullScreen>Checking demo access…</FullScreen>;
  if (me.error) {
    const missing = me.error instanceof ApiError && (me.error.status === 404 || me.error.status === 403);
    return (
      <FullScreen>
        <div className="max-w-sm text-center">
          <span className="mx-auto grid size-12 place-items-center rounded-full bg-slate-100 text-slate-500">
            <ShieldAlert size={22} aria-hidden="true" />
          </span>
          <h1 className="mt-4 text-lg font-semibold text-ink">{missing ? "Demo Admin is off" : "Couldn't open the demo"}</h1>
          <p className="mt-1.5 text-[13px] leading-5 text-slate-500">{missing ? "This workspace is not running in demo mode." : me.error.message}</p>
          <Button className="mt-5" variant="secondary" to="/app/dashboard">Back to Customer Center</Button>
        </div>
      </FullScreen>
    );
  }
  return <AdminShell email={email} demo />;
}

function FullScreen({ children }: { children: React.ReactNode }) {
  return <div className="grid min-h-dvh place-items-center bg-white p-6 text-sm text-slate-500">{children}</div>;
}

function AdminShell({ email, demo = false }: { email: string; demo?: boolean }) {
  const overview = useQuery({ queryKey: ["admin", "overview"], queryFn: () => api<AdminOverview>("/api/admin/overview") });
  const location = useLocation();
  const navigate = useNavigate();
  const main = useRef<HTMLElement>(null);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, collapsed ? "collapsed" : "expanded");
    } catch {
      /* private mode */
    }
  }, [collapsed]);

  useEffect(() => {
    main.current?.scrollTo({ top: 0 });
    setDrawerOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!demo) return;
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href?.startsWith("/admin") || href.startsWith("/admin/demo")) return;
      event.preventDefault();
      navigate(`/admin/demo${href.slice("/admin".length)}`);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [demo, navigate]);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  return (
    <div className="flex h-dvh bg-white">
      <aside
        className={cn(
          "hidden shrink-0 flex-col border-r border-line bg-white transition-[width] duration-200 ease-out md:flex",
          collapsed ? "w-16" : "w-56",
        )}
      >
        <SideNav email={email} collapsed={collapsed} overview={overview.data} demo={demo} onToggle={() => setCollapsed((value) => !value)} />
      </aside>

      {drawerOpen ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <button type="button" className="dialog-backdrop absolute inset-0 bg-slate-950/40" aria-label="Close menu" onClick={() => setDrawerOpen(false)} />
          <div className="drawer-in relative flex h-full w-56 flex-col border-r border-line bg-white" role="dialog" aria-modal="true" aria-label="Admin menu">
            <SideNav email={email} collapsed={false} overview={overview.data} demo={demo} onNavigate={() => setDrawerOpen(false)} onClose={() => setDrawerOpen(false)} />
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-3 md:hidden">
          <button type="button" className="grid size-8 place-items-center rounded-md text-slate-600 hover:bg-slate-100" aria-label="Open menu" onClick={() => setDrawerOpen(true)}>
            <Menu {...iconProps} />
          </button>
          <Link to={demo ? "/admin/demo" : "/admin"} className="flex min-w-0 items-center gap-2">
            <Mark />
            <BrandName />
          </Link>
        </header>
        <main ref={main} className="scroll-area min-h-0 flex-1 overflow-y-auto">
          {demo ? <DemoBanner /> : null}
          <div className="mx-auto w-full max-w-[1440px] px-4 pt-5 pb-16 sm:px-6 lg:px-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

function SideNav({
  email,
  collapsed,
  overview,
  demo = false,
  onToggle,
  onNavigate,
  onClose,
}: {
  email: string;
  collapsed: boolean;
  overview?: AdminOverview;
  demo?: boolean;
  onToggle?: () => void;
  onNavigate?: () => void;
  onClose?: () => void;
}) {
  const access = useAdminAccess();
  const permissions = access.data?.permissions ?? [];
  const visibleLinks = links.filter((link) => (link.to === "/admin/payments" ? allows(access.data, "payments.read") : true));
  const showSettings = allows(access.data, "settings.read") || allows(access.data, "team.manage");
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className={cn("flex shrink-0 items-center", collapsed ? "flex-col gap-1 px-2 pt-3" : "h-12 gap-2 px-3")}>
        <Link to={demo ? "/admin/demo" : "/admin"} className="flex min-w-0 items-center gap-2" onClick={onNavigate}>
          <Mark />
          {collapsed ? null : <BrandName />}
        </Link>
        {onClose ? (
          <button type="button" className="ml-auto grid size-8 place-items-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-ink" aria-label="Close menu" onClick={onClose}>
            <X {...iconProps} />
          </button>
        ) : null}
        {onToggle ? (
          <button
            type="button"
            className={cn("grid size-8 shrink-0 place-items-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-ink", !collapsed && "ml-auto")}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            onClick={onToggle}
          >
            {collapsed ? <PanelLeft {...iconProps} /> : <PanelLeftClose {...iconProps} />}
          </button>
        ) : null}
      </div>

      <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2" aria-label="Admin">
        {visibleLinks.map((link) => (
          <SideLink key={link.to} to={adminHref(link.to)} label={link.label} icon={link.icon} end={link.end} collapsed={collapsed} count={overview && link.count ? link.count(overview) : 0} onNavigate={onNavigate} />
        ))}
        <div className="mt-auto pt-2">
          {allows({ permissions }, "wallet.read") ? <SidebarWallet collapsed={collapsed} onNavigate={onNavigate} /> : null}
          <SideLink to={adminHref("/admin/guide")} label="Developer Guide" icon={BookOpen} collapsed={collapsed} onNavigate={onNavigate} />
          {showSettings ? <SideLink to={adminHref(settingsLink.to)} label={settingsLink.label} icon={settingsLink.icon} collapsed={collapsed} onNavigate={onNavigate} /> : null}
        </div>
      </nav>

      <div className="shrink-0 space-y-0.5 border-t border-slate-100 p-2">
        <Link
          to="/app/dashboard"
          title={demo ? "Back to Customer Center" : "Customer app"}
          onClick={onNavigate}
          className={cn(
            "flex h-8 items-center gap-2 rounded-md text-[13px] text-slate-600 hover:bg-slate-50 hover:text-ink",
            collapsed ? "justify-center" : "px-2",
          )}
        >
          <ArrowUpRight {...iconProps} />
          {collapsed ? <span className="sr-only">{demo ? "Back to Customer Center" : "Customer app"}</span> : <span className="truncate">{demo ? "Back to Customer Center" : "Customer app"}</span>}
        </Link>
        <div className={cn("flex h-8 items-center gap-2", collapsed ? "justify-center" : "px-2")} title={email}>
          <span className="grid size-6 shrink-0 place-items-center rounded-full bg-slate-100 text-[11px] font-medium text-slate-600">{email.slice(0, 1).toUpperCase()}</span>
          {collapsed ? <span className="sr-only">{email}</span> : <span className="min-w-0 truncate text-[12px] text-slate-500">{access.data?.role ? `${access.data.role} · ${email}` : email}</span>}
        </div>
      </div>
    </div>
  );
}

function SidebarWallet({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const query = useQuery({
    queryKey: ["admin", "hiobuy-wallet"],
    queryFn: () => api<{ balance: { availableFen: number } }>("/api/admin/settings/hiobuy-wallet"),
    retry: false,
  });
  const disconnected = query.error instanceof ApiError && query.error.status === 409;
  const amount = query.data ? formatCnyFen(query.data.balance.availableFen) : disconnected ? "Not connected" : query.isError ? "Unavailable" : "…";
  return (
    <Link
      to={adminHref("/admin/settings?tab=wallet")}
      title={`HioBuy wallet ${amount}`}
      onClick={onNavigate}
      className={cn("mb-1 flex items-center gap-2 rounded-md py-1.5 text-slate-600 hover:bg-slate-50 hover:text-ink", collapsed ? "justify-center" : "px-2")}
    >
      <Wallet {...iconProps} />
      {collapsed ? <span className="sr-only">HioBuy wallet {amount}</span> : (
        <span className="min-w-0">
          <span className="block text-[11px] leading-4 text-slate-400">HioBuy wallet</span>
          <span className="block truncate text-[13px] font-medium tabular-nums text-ink">{amount}</span>
        </span>
      )}
    </Link>
  );
}

function SideLink({
  to,
  label,
  icon: Icon,
  end,
  collapsed,
  count = 0,
  onNavigate,
}: {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  collapsed: boolean;
  count?: number;
  onNavigate?: () => void;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      title={collapsed ? label : undefined}
      aria-label={count ? `${label}, ${count} open` : label}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          "relative flex h-8 items-center gap-2 rounded-md text-[13px]",
          collapsed ? "justify-center" : "px-2",
          isActive ? "bg-slate-100 font-medium text-ink" : "text-slate-600 hover:bg-slate-50 hover:text-ink",
        )
      }
    >
      <Icon {...iconProps} />
      {collapsed ? null : <span className="min-w-0 flex-1 truncate">{label}</span>}
      {count ? (
        collapsed ? (
          <span className="absolute top-0.5 right-1 grid h-4 min-w-4 place-items-center rounded-full bg-ink px-1 text-[10px] font-medium text-white tabular-nums">{count}</span>
        ) : (
          <span className="min-w-5 rounded-full bg-slate-200/80 px-1.5 text-center text-[11px] leading-4 font-medium text-ink tabular-nums">{count}</span>
        )
      ) : null}
    </NavLink>
  );
}

function DemoBanner() {
  const access = useAdminAccess();
  const github = access.data?.githubUrl;
  return (
    <div className="border-b border-slate-200 bg-slate-50">
      <div className="mx-auto flex w-full max-w-[1440px] flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-[12px] text-slate-600 sm:px-6 lg:px-8">
        <p className="min-w-0">Demo Mode — Sample data only. Changes are not saved.</p>
        <span className="ml-auto flex flex-wrap items-center gap-3">
          <Link to="/app/dashboard" className="font-medium text-ink hover:underline">Back to Customer Center</Link>
          {github ? <a href={github} target="_blank" rel="noreferrer" className="font-medium text-ink hover:underline">View GitHub Repository</a> : null}
        </span>
      </div>
    </div>
  );
}

function Mark() {
  const brand = useBrand();
  const initial = brand.name.trim().charAt(0).toUpperCase() || "F";
  if (brand.logos.square || brand.logos.primary) {
    const kind = brand.logos.square ? "square" : "primary";
    return <img src={`/api/branding/assets/${kind}?v=${brand.updatedAt}`} alt="" className="size-6 shrink-0 rounded-[5px] bg-white object-contain" />;
  }
  return (
    <span className="grid size-6 shrink-0 place-items-center rounded-[5px] text-[11px] font-semibold text-white" style={{ backgroundColor: brand.primaryColor }}>
      {initial}
    </span>
  );
}

function BrandName() {
  const brand = useBrand();
  return <span className="truncate text-[13px] font-semibold tracking-tight">{brand.name}</span>;
}
