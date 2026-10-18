import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  BellOff,
  Boxes,
  Calculator,
  LayoutDashboard,
  LogOut,
  MapPin,
  Menu,
  Package,
  PackageSearch,
  ReceiptText,
  PanelLeftClose,
  PanelLeftOpen,
  ShieldCheck,
  Truck,
  UserRound,
  Wallet,
  Warehouse,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { AssistantSidebar, AssistantToggle } from "../features/assistant/AssistantPanel";
import { formatDateTime } from "../domain/dates";
import { api } from "../lib/api";
import { brandHomeHref } from "../domain/site";
import { BrandLockup, useBrand, useSiteMode } from "../lib/brand";
import { authClient } from "../lib/auth";

const storageKey = "hiobuy-sidebar-collapsed";

const groups = [
  {
    label: "Workspace",
    links: [
      { to: "/app/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { to: "/app/packages", label: "My Packages", icon: Package },
      { to: "/app/claim-packages", label: "Claim Packages", icon: PackageSearch, badge: "claims" as const },
      { to: "/app/consolidate", label: "Consolidate & Ship", icon: Boxes },
      { to: "/app/shipments", label: "Shipments", icon: Truck, badge: "unpaid" as const },
    ],
  },
  {
    label: "Tools",
    links: [
      { to: "/app/shipping-calculator", label: "Shipping Calculator", icon: Calculator },
      { to: "/app/warehouse", label: "Warehouse Address", icon: Warehouse },
    ],
  },
  {
    label: "Account",
    links: [
      { to: "/app/wallet", label: "Wallet", icon: Wallet },
      { to: "/app/addresses", label: "Addresses", icon: MapPin },
      { to: "/app/invoice-details", label: "Invoice details", icon: ReceiptText },
      { to: "/app/account", label: "Account", icon: UserRound },
    ],
  },
];

export function AppShell() {
  const [open, setOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(storageKey) === "1");
  const [notesOpen, setNotesOpen] = useState(false);
  const notesRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: session } = authClient.useSession();
  const security = useQuery({ queryKey: ["security-public"], queryFn: () => api<{ customerAi: boolean }>("/api/security/public"), staleTime: 60_000 });
  const customerAi = security.data?.customerAi !== false;
  const nav = useQuery({ queryKey: ["nav"], queryFn: () => api<{ claims: number; unpaidShipments: number }>("/api/nav") });
  const notes = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api<{ id: string; title: string; body: string; href: string | null; read: boolean; createdAt: string }[]>("/api/notifications"),
  });
  const unread = notes.data?.filter((item) => !item.read).length ?? 0;
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<{ isAdmin?: boolean }>("/api/me") });
  const name = session?.user.name ?? "";
  const initial = name.trim().charAt(0).toUpperCase() || "H";
  const brand = useBrand();
  const site = useSiteMode();
  const homeHref = site.ready ? brandHomeHref({ mode: site.mode, publicUrl: brand.website.publicUrl, signedIn: true }) : brand.website.publicUrl || "/app/dashboard";
  const accent = brand.accentColor || brand.primaryColor;

  // New page: start at the top, and close any open menus.
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
    setOpen(false);
    setNotesOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!notesOpen && !open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setNotesOpen(false);
        setOpen(false);
      }
    };
    const onPointer = (event: PointerEvent) => {
      if (notesRef.current && !notesRef.current.contains(event.target as Node)) setNotesOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [notesOpen, open]);

  function toggleCollapsed() {
    setCollapsed((value) => {
      localStorage.setItem(storageKey, value ? "0" : "1");
      return !value;
    });
  }

  async function logout() {
    await authClient.signOut();
    queryClient.clear();
    navigate("/auth/login");
  }

  async function openNotes() {
    setNotesOpen((value) => !value);
    if (unread > 0) {
      await api("/api/notifications/read", { method: "POST" });
      await queryClient.invalidateQueries({ queryKey: ["notifications"] });
    }
  }

  function renderSidebar({ compact, onNavigate }: { compact: boolean; onNavigate?: () => void }) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className={`flex items-center px-3 pt-4 pb-3 ${compact ? "justify-center" : "justify-between"}`}>
          <BrandLockup compact={compact} tone="light" href={homeHref} />
          <button
            type="button"
            className="hidden rounded-lg p-2 text-slate-400 hover:bg-white/5 hover:text-white md:inline-flex"
            aria-label={compact ? "Expand sidebar" : "Collapse sidebar"}
            onClick={toggleCollapsed}
          >
            {compact ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
        </div>
        <nav className="scroll-area min-h-0 flex-1 space-y-4 overflow-y-auto px-2.5 pb-3" aria-label="Main">
          {groups.map((group) => (
            <div key={group.label}>
              <div className={`mb-1 px-2 text-[11px] font-medium text-slate-500 ${compact ? "sr-only" : ""}`}>{group.label}</div>
              <div className="space-y-0.5">
                {group.links.map((link) => {
                  const count = link.badge === "claims" ? nav.data?.claims : link.badge === "unpaid" ? nav.data?.unpaidShipments : 0;
                  return (
                    <NavLink
                      key={link.to}
                      to={link.to}
                      title={compact ? link.label : undefined}
                      aria-label={count && link.badge === "unpaid" ? `${link.label}, ${count} to pay` : link.label}
                      onClick={onNavigate}
                      style={({ isActive }) => (isActive ? { boxShadow: `inset 3px 0 0 ${accent}` } : undefined)}
                      className={({ isActive }) =>
                        `relative flex items-center rounded-lg text-[13px] transition-colors duration-150 ${compact ? "justify-center px-2 py-2.5" : "justify-between px-2.5 py-2"} ${
                          isActive
                            ? "bg-white/[0.09] font-medium text-white"
                            : "text-slate-400 hover:bg-white/[0.05] hover:text-slate-100"
                        }`
                      }
                    >
                      <span className={`flex min-w-0 items-center ${compact ? "" : "gap-2.5"}`}>
                        <link.icon size={16} aria-hidden="true" className="shrink-0 opacity-90" />
                        <span className={compact ? "sr-only" : "truncate"}>{link.label}</span>
                      </span>
                      {count ? (
                        compact ? (
                          <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-rose-500" aria-label={`${count} waiting`} />
                        ) : (
                          <span className="min-w-5 rounded-full bg-rose-500 px-1.5 text-center text-[11px] leading-[18px] font-semibold text-white tabular-nums">{count}</span>
                        )
                      ) : null}
                    </NavLink>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
        {me.data?.isAdmin ? (
          <div className="px-2.5 pb-2">
            <NavLink
              to="/admin"
              title={compact ? "Operations admin" : undefined}
              className={`flex items-center gap-2.5 rounded-lg border border-amber-400/20 bg-amber-400/10 text-[13px] text-amber-200 transition-colors hover:bg-amber-400/15 ${compact ? "justify-center px-2 py-2.5" : "px-2.5 py-2"}`}
            >
              <ShieldCheck size={16} aria-hidden="true" />
              <span className={compact ? "sr-only" : ""}>Operations admin</span>
            </NavLink>
          </div>
        ) : null}
        <div className={`border-t border-white/10 px-3 py-3 ${compact ? "flex justify-center" : ""}`}>
          <div className={`flex items-center gap-3 ${compact ? "flex-col" : ""}`}>
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-indigo-500/20 text-sm font-semibold text-indigo-100" title={name}>
              {initial}
            </div>
            {compact ? null : (
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-white">{name}</div>
                <div className="truncate text-xs text-slate-500">Member {session?.user.memberCode}</div>
              </div>
            )}
            <button type="button" className="rounded-lg p-2 text-slate-400 hover:bg-white/5 hover:text-white" aria-label="Log out" onClick={() => void logout()}>
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-dvh gap-2 overflow-hidden bg-[#1a1a1a] md:py-2 md:pr-2" style={{ ["--sidebar-width" as string]: collapsed ? "76px" : "248px" }}>
      <aside className={`hidden h-full shrink-0 overflow-hidden bg-[#1a1a1a] transition-[width] duration-200 md:block ${collapsed ? "w-[76px]" : "w-[248px]"}`}>
        {renderSidebar({ compact: collapsed })}
      </aside>
      {open ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <button className="dialog-backdrop absolute inset-0 bg-slate-950/50" aria-label="Close menu" onClick={() => setOpen(false)} />
          <aside className="drawer-in relative h-dvh w-[280px] max-w-[85vw] overflow-hidden bg-[#1a1a1a] shadow-2xl">
            <button type="button" className="absolute top-4 right-3 z-10 rounded-lg p-2 text-slate-400 hover:bg-white/5 hover:text-white" aria-label="Close menu" onClick={() => setOpen(false)}>
              <X size={18} />
            </button>
            {renderSidebar({ compact: false, onNavigate: () => setOpen(false) })}
          </aside>
        </div>
      ) : null}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.04)] md:rounded-2xl">
        <header className="relative z-30 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-slate-200/80 bg-white px-4 md:px-6">
          <div className="flex items-center gap-2 md:hidden">
            <button type="button" className="-ml-1.5 rounded-lg p-2 text-slate-600 hover:bg-slate-100" aria-label="Open menu" aria-expanded={open} onClick={() => setOpen(true)}>
              <Menu size={19} />
            </button>
            <BrandLockup compact tone="dark" />
          </div>
          <div ref={notesRef} className="relative ml-auto flex items-center gap-1.5">
            {session?.user.memberCode ? (
              <span className="mr-1 hidden items-center gap-1.5 rounded-md bg-slate-100 px-2 py-1 text-[12px] text-slate-500 sm:inline-flex" title="Your member code. Put it on every parcel sent to the warehouse.">
                Member <span className="font-mono font-medium text-slate-700">{session.user.memberCode}</span>
              </span>
            ) : null}
            {session?.user.id && customerAi ? <AssistantToggle open={assistantOpen} onToggle={() => setAssistantOpen((value) => !value)} /> : null}
            <button
              type="button"
              className={`relative grid size-9 place-items-center rounded-lg transition-colors ${notesOpen ? "bg-slate-100 text-ink" : "text-slate-600 hover:bg-slate-100"}`}
              aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
              aria-expanded={notesOpen}
              aria-haspopup="dialog"
              onClick={() => void openNotes()}
            >
              <Bell size={18} />
              {unread ? <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-rose-500 ring-2 ring-white" /> : null}
            </button>
            {notesOpen ? (
              <div className="pop-in absolute top-12 right-0 z-40 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_16px_40px_-12px_rgba(16,24,40,0.25)]" role="dialog" aria-label="Notifications">
                <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                  <span className="text-sm font-semibold">Notifications</span>
                  {notes.data?.length ? <span className="text-[12px] text-slate-400 tabular-nums">{notes.data.length}</span> : null}
                </div>
                <div className="scroll-area max-h-[min(24rem,70vh)] overflow-auto">
                  {notes.data?.length ? (
                    notes.data.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className="flex w-full gap-3 border-b border-slate-100 px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-slate-50"
                        onClick={() => {
                          setNotesOpen(false);
                          if (item.href) navigate(item.href);
                        }}
                      >
                        <span className={`mt-1.5 size-2 shrink-0 rounded-full ${item.read ? "bg-transparent" : "bg-indigo-500"}`} aria-hidden="true" />
                        <span className="min-w-0">
                          <span className="block text-[13px] font-medium text-ink">{item.title}</span>
                          <span className="mt-0.5 block text-[12px] leading-[18px] text-slate-500">{item.body}</span>
                          <span className="mt-1 block text-[11px] text-slate-400">{formatDateTime(item.createdAt)}</span>
                        </span>
                      </button>
                    ))
                  ) : (
                    <div className="px-4 py-8 text-center">
                      <BellOff size={18} className="mx-auto text-slate-300" aria-hidden="true" />
                      <p className="mt-2 text-[13px] text-slate-500">You're all caught up.</p>
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </header>
        <div className="flex min-h-0 flex-1">
          <main ref={mainRef} className="scroll-area min-h-0 min-w-0 flex-1 overflow-y-auto px-4 pt-6 pb-10 md:px-8 md:pt-8">
            <div className="mx-auto max-w-[1080px]">
              <Outlet />
            </div>
          </main>
          {session?.user.id && customerAi && assistantOpen ? <AssistantSidebar userId={session.user.id} onClose={() => setAssistantOpen(false)} /> : null}
        </div>
      </div>
    </div>
  );
}
