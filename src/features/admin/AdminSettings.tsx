import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { customerUsdFen, formatCnyFen, formatPercentBps, formatRateE4, markedUpCnyFen } from "../../domain/freight";
import { DEFAULT_TRACKING_EVENT_LABELS, TRACKING_EVENT_CODES, type TrackingEventCode } from "../../domain/tracking-events";
import { countryName } from "../../domain/countries";
import { formatWarehouseLine, presentSchedule } from "../../domain/warehouse-location";
import { formatFen } from "../../domain/money";
import { useSearchParams } from "react-router";
import { Button, ConfirmDialog, CopyButton, ErrorState, Field, LoadingBlock, inputClass } from "../../components/ui";
import { Checkbox } from "../../components/ui/checkbox";
import { useToast } from "../../components/toast";
import { ApiError, api } from "../../lib/api";
import { cn } from "../../lib/utils";
import { AdminHeader, Panel, filterControl, useAdminAccess, useDemoPreview } from "./shared";
import { AdminTeam } from "./AdminTeam";
import { AdminEmail } from "./AdminEmail";
import { PaymentSettingsPanel } from "./AdminPayments";
import { FulfillmentSync } from "./FulfillmentSync";
import { HioBuyWallet } from "./HioBuyWallet";
import { AdminBusiness } from "./AdminBusiness";
import { AdminInvoicing } from "./AdminInvoicing";
import { AdminAdvanced } from "./AdminAdvanced";

type Country = { code: string; name: string; enabled: boolean };
type Settings = {
  connection: { configured: boolean; hint: string | null };
  connected: boolean;
  sync: { syncedAt: string | null };
  warehouse: {
    name: string;
    phone: string;
    recipient: string;
    province: string;
    city: string;
    district: string;
    street: string;
    postalCode: string;
    country: string;
    hours: string;
    supportedDestinations: string[];
    notice: string | null;
    syncedAt: string;
  } | null;
  countries: Country[];
  pricing: { markupBps: number; markupCnyFen: number; cnyPerUsdE4: number };
};

type Tab = "business" | "integration" | "destinations" | "pricing" | "wallet" | "email" | "payments" | "invoicing" | "tracking" | "team" | "advanced";

function TrackingLabels() {
  const query = useQuery({ queryKey: ["admin", "tracking-events"], queryFn: () => api<{ labels: Record<TrackingEventCode, string> }>("/api/admin/settings/tracking-events") });
  if (query.isLoading) return <LoadingBlock rows={4} />;
  if (query.error || !query.data) return <ErrorState message="Could not load tracking labels." onRetry={() => void query.refetch()} />;
  return <TrackingLabelForm key={query.dataUpdatedAt} initial={query.data.labels} />;
}

function TrackingLabelForm({ initial }: { initial: Record<TrackingEventCode, string> }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [labels, setLabels] = useState(initial);
  const save = useMutation({
    mutationFn: () => api<{ labels: Record<TrackingEventCode, string> }>("/api/admin/settings/tracking-events", { method: "PUT", body: JSON.stringify({ labels }) }),
    onSuccess: async (next) => {
      setLabels(next.labels);
      await queryClient.invalidateQueries({ queryKey: ["admin", "tracking-events"] });
      await queryClient.invalidateQueries({ queryKey: ["admin", "shipment"] });
      await queryClient.invalidateQueries({ queryKey: ["shipment"] });
      toast({ title: "Tracking labels saved.", tone: "success" });
    },
    onError: (reason) => toast({ title: reason instanceof ApiError ? reason.message : "Could not save tracking labels.", tone: "danger" }),
  });
  return (
    <form
      className="max-w-3xl"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <Panel>
        <div className="border-b border-slate-100 px-4 py-3">
          <h2 className="text-[13px] font-semibold">Tracking events</h2>
          <p className="mt-1 text-[13px] text-slate-500">Each HioBuy event code has one label. Admin and customers see this text instead of the upstream title.</p>
        </div>
        <ul className="divide-y divide-slate-100">
          {TRACKING_EVENT_CODES.map((code) => (
            <li key={code} className="grid items-center gap-3 px-4 py-3 sm:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
              <span className="font-mono text-[12px] text-slate-500">{code}</span>
              <input className={inputClass} value={labels[code] ?? ""} aria-label={code} onChange={(event) => setLabels({ ...labels, [code]: event.target.value })} />
            </li>
          ))}
        </ul>
      </Panel>
      <div className="mt-4 flex gap-2">
        <Button type="submit" loading={save.isPending}>Save labels</Button>
        <Button type="button" variant="secondary" onClick={() => setLabels({ ...DEFAULT_TRACKING_EVENT_LABELS })}>Reset to preset</Button>
      </div>
    </form>
  );
}

function yuan(fen: number) {
  return (fen / 100).toFixed(2);
}

const tabs = [
  ["business", "Business", "settings.read"],
  ["integration", "Integration", "settings.read"],
  ["invoicing", "Invoice details", "settings.write"],
  ["destinations", "Destinations", "settings.write"],
  ["pricing", "Pricing", "settings.write"],
  ["wallet", "HioBuy Wallet", "wallet.read"],
  ["email", "Email", "secrets.write"],
  ["advanced", "Advanced", "secrets.write"],
  ["payments", "Payments", "secrets.write"],
  ["tracking", "Tracking", "settings.write"],
  ["team", "Team", "team.manage"],
] as const;

function isTab(value: string | null): value is Tab {
  return tabs.some(([id]) => id === value);
}

export function AdminSettings() {
  const query = useQuery({ queryKey: ["admin", "settings"], queryFn: () => api<Settings>("/api/admin/settings") });
  const access = useAdminAccess();
  const [dirty, setDirty] = useState(false);
  if (query.isLoading || access.isLoading) return <LoadingBlock rows={4} />;
  if (query.error || !query.data) return <ErrorState message="Could not load settings." onRetry={() => void query.refetch()} />;
  return <SettingsScreen data={query.data} dirty={dirty} setDirty={setDirty} permissions={access.data?.permissions ?? []} demo={access.data?.role === "demo"} />;
}

const DEMO_TABS = new Set(["business", "integration", "destinations", "pricing", "wallet", "email", "advanced", "payments", "team"]);

function SettingsScreen({ data, dirty, setDirty, permissions, demo }: { data: Settings; dirty: boolean; setDirty: (value: boolean) => void; permissions: string[]; demo: boolean }) {
  const [params, setParams] = useSearchParams();
  const visible = tabs.filter(([id, , permission]) => (demo ? DEMO_TABS.has(id) : permissions.includes(permission)));
  const requested = params.get("tab");
  const fallback = visible[0]?.[0] ?? "business";
  const tab: Tab = isTab(requested) && visible.some(([id]) => id === requested) ? requested : fallback;
  const canEditSecrets = permissions.includes("secrets.write");
  const canWriteBusiness = permissions.includes("business.write");
  function choose(next: Tab) {
    if (next !== tab && dirty && !window.confirm("You have unsaved changes. Leave this tab without saving?")) return;
    if (next !== tab) setDirty(false);
    const nextParams = new URLSearchParams(params);
    if (next === fallback) nextParams.delete("tab");
    else nextParams.set("tab", next);
    setParams(nextParams, { replace: true });
  }
  return (
    <div>
      <AdminHeader title="Settings" meta={demo ? "Sample configuration. Saves, invites, uploads, and live API calls stay off." : undefined} />
      <div className="mb-4 flex gap-0.5 overflow-x-auto border-b border-line" role="tablist">
        {visible.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={cn("-mb-px shrink-0 border-b-2 px-2.5 py-2 text-[13px] whitespace-nowrap", tab === id ? "border-ink font-medium text-ink" : "border-transparent text-slate-500 hover:text-ink")}
            onClick={() => choose(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className={tab === "business" ? "" : "hidden"}>
        <AdminBusiness canWrite={canWriteBusiness} active={tab === "business"} onDirty={setDirty} />
      </div>
      <div className={tab === "integration" ? "" : "hidden"}>
        <Integration data={data} canEditSecrets={canEditSecrets} />
      </div>
      <div className={tab === "destinations" ? "" : "hidden"}>
        <Destinations data={data} />
      </div>
      <div className={tab === "pricing" ? "" : "hidden"}>
        <Pricing data={data} active={tab === "pricing"} onDirty={setDirty} />
      </div>
      <div className={tab === "wallet" ? "" : "hidden"}>
        <HioBuyWallet />
      </div>
      <div className={tab === "email" ? "" : "hidden"}>
        <AdminEmail />
      </div>
      <div className={tab === "advanced" ? "" : "hidden"}>
        <AdminAdvanced />
      </div>
      <div className={tab === "payments" ? "" : "hidden"}>
        <PaymentSettingsPanel />
      </div>
      <div className={tab === "invoicing" ? "" : "hidden"}>
        <AdminInvoicing />
      </div>
      <div className={tab === "tracking" ? "" : "hidden"}>
        <TrackingLabels />
      </div>
      <div className={tab === "team" ? "" : "hidden"}>
        <AdminTeam />
      </div>
    </div>
  );
}

const DEVELOPER_PORTAL = "https://developers.hiobuy.com";
const SETUP_GUIDE = "https://hiobuy.com/en/api-docs/fulfillment-setup";

function Integration({ data, canEditSecrets }: { data: Settings; canEditSecrets: boolean }) {
  return (
    <div className="space-y-4">
      {!data.connection.configured ? <GettingStarted canEditSecrets={canEditSecrets} /> : !data.connected ? <NeedsRepair data={data} canEditSecrets={canEditSecrets} /> : <ConnectedIntegration data={data} canEditSecrets={canEditSecrets} />}
      <FulfillmentSync canEditSecrets={canEditSecrets} />
    </div>
  );
}

function GettingStarted({ canEditSecrets }: { canEditSecrets: boolean }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<ApiError | null>(null);
  const connect = useMutation({
    mutationFn: () => api("/api/admin/settings/connect", { method: "POST", body: JSON.stringify({ apiKey }) }),
    onSuccess: async () => {
      setApiKey("");
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ["admin", "settings"] });
      toast({ title: "HioBuy connected. Warehouse and shipping channels are available.", tone: "success" });
    },
    onError: (reason) => setError(reason instanceof ApiError ? reason : new ApiError("REQUEST_FAILED", "Could not connect.", 500)),
  });
  return (
    <Panel>
      <div className="border-b border-slate-100 px-4 py-4">
        <h2 className="text-[13px] font-semibold">Getting started</h2>
        <p className="mt-1 max-w-xl text-[13px] leading-5 text-slate-500">Register on HioBuy, turn on warehouse fulfillment, then paste a Production API key. You can paste a key you already have.</p>
      </div>
      <ol>
        <Step
          n="1"
          title="Create a HioBuy developer account"
          body="Register, create an application, and finish the review HioBuy requires. That happens in the Developer Portal, not here."
          action={<ExternalLink href={DEVELOPER_PORTAL}>Create Developer Account</ExternalLink>}
        />
        <Step
          n="2"
          title="Configure warehouse fulfillment"
          body="Use this when customers buy on their own, ship parcels to the China warehouse, and you forward them internationally."
          action={<ExternalLink href={SETUP_GUIDE}>View Setup Guide</ExternalLink>}
        >
          <ul className="mt-2 space-y-1 text-[13px] text-slate-600">
            <li>Fulfillment Mode: HioBuy Warehouse</li>
            <li>Procurement Mode: Self Procurement</li>
            <li>Warehouse Authorization: the binding code HioBuy provides</li>
          </ul>
        </Step>
        <Step n="3" title="Connect your API key" body={canEditSecrets ? "Generate a Production API key in the Developer Portal. The full key stays on the server." : "An owner connects the Production API key. You can run fulfillment sync after that."}>
          {canEditSecrets ? (
          <form
            className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end"
            onSubmit={(event) => {
              event.preventDefault();
              setError(null);
              connect.mutate();
            }}
          >
            <Field label="Production API key">
              <input className={`${inputClass} w-full sm:w-80`} type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="Paste your Production key" />
            </Field>
            <Button type="submit" loading={connect.isPending} disabled={apiKey.trim().length < 8}>Connect HioBuy</Button>
          </form>
          ) : null}
          {error ? <ConnectionIssue error={error} /> : null}
        </Step>
      </ol>
    </Panel>
  );
}

function NeedsRepair({ data, canEditSecrets }: { data: Settings; canEditSecrets: boolean }) {
  return (
    <div className="space-y-4">
      <Panel>
        <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-4">
          <div>
            <h2 className="text-[13px] font-semibold">Connection needs attention</h2>
            <p className="mt-1 max-w-xl text-[13px] leading-5 text-slate-500">
              A key is saved{data.connection.hint ? <span> · {data.connection.hint}</span> : null}, but the warehouse address and shipping channels are not both available. Fix the item below, then test again. You do not need to repeat the full setup.
            </p>
          </div>
          <ExternalLink href={SETUP_GUIDE}>View Setup Guide</ExternalLink>
        </div>
      </Panel>
      <ConnectedIntegration data={data} repair canEditSecrets={canEditSecrets} />
    </div>
  );
}

function ConnectedIntegration({ data, repair = false, canEditSecrets }: { data: Settings; repair?: boolean; canEditSecrets: boolean }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [replacing, setReplacing] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [clearOpen, setClearOpen] = useState(false);
  const [test, setTest] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [testMessage, setTestMessage] = useState("");
  const [issue, setIssue] = useState<ApiError | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin", "settings"] });
  const connect = useMutation({
    mutationFn: () => api("/api/admin/settings/connect", { method: "POST", body: JSON.stringify({ apiKey }) }),
    onSuccess: async () => {
      setApiKey("");
      setReplacing(false);
      setIssue(null);
      await refresh();
      toast({ title: "HioBuy connected. Warehouse and shipping channels are available.", tone: "success" });
    },
    onError: (reason) => setIssue(reason instanceof ApiError ? reason : new ApiError("REQUEST_FAILED", "Could not connect.", 500)),
  });
  const clearKey = useMutation({
    mutationFn: () => api("/api/admin/settings/api-key", { method: "PUT", body: JSON.stringify({ apiKey: "" }) }),
    onSuccess: async () => {
      setClearOpen(false);
      setReplacing(false);
      await refresh();
      toast({ title: "API key removed.", tone: "success" });
    },
    onError: (reason) => toast({ title: reason instanceof ApiError ? reason.message : "Could not remove the key.", tone: "danger" }),
  });
  const syncWarehouse = useMutation({
    mutationFn: () => api("/api/admin/settings/sync/warehouse", { method: "POST", body: JSON.stringify(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) }),
    onSuccess: async () => {
      await refresh();
      toast({ title: "Warehouse address updated.", tone: "success" });
    },
    onError: (reason) => toast({ title: reason instanceof ApiError ? reason.message : "Warehouse sync failed.", tone: "danger" }),
  });
  async function testConnection() {
    setTest("loading");
    setTestMessage("");
    setIssue(null);
    try {
      await api("/api/admin/settings/test", { method: "POST", body: JSON.stringify(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) });
      setTest("ok");
      setTestMessage("Warehouse address and shipping channels both responded. Payments and the wallet are separate.");
    } catch (reason) {
      setTest("error");
      const next = reason instanceof ApiError ? reason : new ApiError("REQUEST_FAILED", "Connection failed.", 500);
      setIssue(next);
      setTestMessage(next.message);
    }
  }
  const demo = useDemoPreview();
  const status = test === "error" ? "Check failed" : data.connected ? "Connected" : "Key saved";
  const address = data.warehouse ? formatWarehouseLine(data.warehouse) : "";
  const schedule = data.warehouse ? presentSchedule(data.warehouse.hours) : null;
  const countries = data.warehouse?.supportedDestinations.map((code) => countryName(code)).join(", ") ?? "";
  const notice = data.warehouse?.notice && !/^\d+$/.test(data.warehouse.notice.trim()) ? data.warehouse.notice.trim() : "";

  return (
    <Panel>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-4 py-4">
        <div className="min-w-0">
          <h2 className="text-[13px] font-semibold">Connection</h2>
          <p className="mt-1 text-[13px] text-slate-500">
            <span className={cn("font-medium", status === "Check failed" ? "text-red-700" : "text-ink")}>{status}</span>
            {data.connection.hint ? <span> · {data.connection.hint}</span> : null}
          </p>
          {test === "ok" && testMessage ? <p className="mt-1 max-w-xl text-[13px] leading-5 text-slate-600">{testMessage}</p> : null}
          {issue ? <ConnectionIssue error={issue} /> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {demo ? <p className="text-[12px] text-slate-500">Sample connection. The API key and live checks are hidden.</p> : (
            <>
              <Button variant="secondary" size="sm" loading={test === "loading"} onClick={() => void testConnection()}>{repair ? "Retry check" : "Test connection"}</Button>
              {canEditSecrets ? <Button variant="secondary" size="sm" onClick={() => setReplacing((value) => !value)}>Replace API key</Button> : null}
              {canEditSecrets && data.connection.configured ? <Button variant="ghost" size="sm" className="text-red-700" onClick={() => setClearOpen(true)}>Remove</Button> : null}
            </>
          )}
        </div>
      </div>
      {canEditSecrets && replacing ? (
        <form className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 sm:flex-row sm:items-end" onSubmit={(event) => { event.preventDefault(); connect.mutate(); }}>
          <Field label="New API key">
            <input className={`${inputClass} w-full sm:w-80`} type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="Paste a Production key" />
          </Field>
          <Button type="submit" loading={connect.isPending} disabled={apiKey.trim().length < 8}>Connect HioBuy</Button>
        </form>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-[13px] font-semibold">Warehouse</h2>
            {demo ? <span className="text-[12px] text-slate-400">Sample address</span> : <Button variant="secondary" size="sm" loading={syncWarehouse.isPending} onClick={() => syncWarehouse.mutate()}>Sync warehouse</Button>}
          </div>
          {data.warehouse ? (
            <dl className="mt-3 max-w-xl space-y-2 text-[13px]">
              <SettingRow label="Recipient" value={data.warehouse.recipient || "—"} />
              <SettingRow label="Phone" value={data.warehouse.phone || "—"} />
              <div className="flex gap-3">
                <dt className="w-24 shrink-0 text-slate-500">Address</dt>
                <dd className="min-w-0">
                  <span className="break-words">{address}</span>
                  <CopyButton value={address} label="Copy address" variant="ghost" size="sm" className="ml-1" />
                </dd>
              </div>
              {schedule ? <SettingRow label={schedule.label} value={schedule.value} /> : null}
              {countries ? <SettingRow label="Countries" value={countries} /> : null}
              {notice ? <p className="pt-1 text-[12px] leading-5 text-slate-500">{notice}</p> : null}
              <p className="text-[12px] text-slate-400">Synced {new Date(data.warehouse.syncedAt).toLocaleString()}</p>
            </dl>
          ) : (
            <p className="mt-2 text-[13px] text-slate-500">Nothing to show until HioBuy returns an address.</p>
          )}
        </div>
      </div>
      <ConfirmDialog open={clearOpen} title="Remove the HioBuy API key?" body="Sync and quotes that need HioBuy will stop until you add a key again." confirmLabel="Remove key" danger pending={clearKey.isPending} onClose={() => setClearOpen(false)} onConfirm={() => clearKey.mutate()} />
    </Panel>
  );
}

function Step({ n, title, body, action, children }: { n: string; title: string; body: string; action?: ReactNode; children?: ReactNode }) {
  return (
    <li className="border-b border-slate-100 px-4 py-4 last:border-b-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-xl">
          <h3 className="text-[13px] font-semibold text-ink">
            <span className="mr-2 font-medium text-slate-400">{n}</span>
            {title}
          </h3>
          <p className="mt-1 text-[13px] leading-5 text-slate-500">{body}</p>
          {children}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
    </li>
  );
}

function ExternalLink({ href, children }: { href: string; children: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center rounded-lg border border-slate-200 bg-white px-3 text-[13px] font-medium text-slate-700 hover:bg-slate-50">
      {children}
    </a>
  );
}

function ConnectionIssue({ error }: { error: ApiError }) {
  const guide = error.code === "FULFILLMENT_MODE_NOT_SUPPORTED" || error.code === "WAREHOUSE_AUTH_INVALID";
  const portal = error.code === "INVALID_API_KEY";
  return (
    <div className="mt-2 max-w-xl">
      <p className="text-[13px] leading-5 text-red-700">{error.message}</p>
      {guide || portal ? (
        <p className="mt-2">
          <ExternalLink href={guide ? SETUP_GUIDE : DEVELOPER_PORTAL}>{guide ? "View Setup Guide" : "Open Developer Portal"}</ExternalLink>
        </p>
      ) : null}
    </div>
  );
}

function SettingRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <dt className="w-24 shrink-0 text-slate-500">{label}</dt>
      <dd className="min-w-0 break-words text-ink">{value}</dd>
    </div>
  );
}

function Destinations({ data }: { data: Settings }) {
  const demo = useDemoPreview();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin", "settings"] });
  const fail = (reason: unknown) => toast({ title: reason instanceof ApiError ? reason.message : "That didn't work.", tone: "danger" });
  const sync = useMutation({
    mutationFn: () => api<Settings & { syncStats?: { added: number; updated: number; unavailable: number } }>("/api/admin/settings/sync/channels", { method: "POST", body: "{}" }),
    onSuccess: async (result) => {
      await refresh();
      const stats = result.syncStats;
      toast({ title: stats ? `Countries synced. ${stats.added} added, ${stats.updated} updated, ${stats.unavailable} unavailable.` : "Countries synced.", tone: "success" });
    },
    onError: fail,
  });
  const toggleCountry = useMutation({
    mutationFn: (input: { code: string; enabled: boolean }) => api(`/api/admin/settings/countries/${input.code}`, { method: "PUT", body: JSON.stringify({ enabled: input.enabled }) }),
    onSuccess: refresh,
    onError: fail,
  });
  const toggleAll = useMutation({
    mutationFn: (enabled: boolean) => api("/api/admin/settings/countries", { method: "PUT", body: JSON.stringify({ enabled }) }),
    onSuccess: refresh,
    onError: fail,
  });
  const countries = data.countries.filter((country) => `${country.name} ${country.code}`.toLowerCase().includes(query.trim().toLowerCase()));
  const openCount = data.countries.filter((country) => country.enabled).length;

  return (
    <Panel>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
        <div className="flex min-w-[12rem] flex-1 items-center gap-3">
          <input className={cn(filterControl, "w-full max-w-xs")} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search country or code" aria-label="Search countries" />
          <span className="shrink-0 text-[12px] text-slate-500 tabular-nums">{openCount} open</span>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <Button size="sm" variant="ghost" disabled={demo || !data.countries.length || toggleAll.isPending} title={demo ? "Demo countries are a sample" : undefined} onClick={() => toggleAll.mutate(true)}>Enable all</Button>
          <Button size="sm" variant="ghost" disabled={demo || !data.countries.length || toggleAll.isPending} title={demo ? "Demo countries are a sample" : undefined} onClick={() => toggleAll.mutate(false)}>Disable all</Button>
          <Button size="sm" variant="secondary" loading={sync.isPending} disabled={demo} title={demo ? "Live channel sync is off in demo" : undefined} onClick={() => sync.mutate()}>Sync</Button>
        </div>
      </div>
      {data.sync.syncedAt ? <p className="border-b border-slate-100 px-4 py-2 text-[12px] text-slate-400">Last synced {new Date(data.sync.syncedAt).toLocaleString()}. Closing a country blocks new shipments. Existing orders stay.</p> : null}
      {!data.connected ? <p className="px-4 py-10 text-center text-[13px] text-slate-500">Connect an API key, then sync. Countries stay hidden until HioBuy returns them.</p> : null}
      {data.connected ? (
        <ul className="grid sm:grid-cols-2">
          {countries.map((country) => (
            <li key={country.code} className="border-b border-slate-100 sm:odd:border-r">
              <div className="flex items-center justify-between gap-3 px-4 py-2.5">
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium text-ink">{country.name}</span>
                  <span className="block font-mono text-[11px] text-slate-400">{country.code}</span>
                </span>
                <Checkbox checked={country.enabled} disabled={demo || toggleCountry.isPending || toggleAll.isPending} aria-label={`${country.enabled ? "Close" : "Open"} ${country.name}`} onCheckedChange={(checked) => toggleCountry.mutate({ code: country.code, enabled: checked === true })} />
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {data.connected && countries.length === 0 ? <p className="px-4 py-10 text-center text-[13px] text-slate-500">No matching country.</p> : null}
    </Panel>
  );
}

function Pricing({ data, active, onDirty }: { data: Settings; active: boolean; onDirty: (value: boolean) => void }) {
  const demo = useDemoPreview();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [percent, setPercent] = useState(formatPercentBps(data.pricing.markupBps));
  const [fixed, setFixed] = useState(yuan(data.pricing.markupCnyFen));
  const [rate, setRate] = useState(formatRateE4(data.pricing.cnyPerUsdE4));
  const [cost, setCost] = useState("100");
  useEffect(() => {
    setPercent(formatPercentBps(data.pricing.markupBps));
    setFixed(yuan(data.pricing.markupCnyFen));
    setRate(formatRateE4(data.pricing.cnyPerUsdE4));
  }, [data.pricing]);
  const snapshot = `${percent}|${fixed}|${rate}`;
  const saved = `${formatPercentBps(data.pricing.markupBps)}|${yuan(data.pricing.markupCnyFen)}|${formatRateE4(data.pricing.cnyPerUsdE4)}`;
  useEffect(() => {
    if (active) onDirty(demo ? false : snapshot !== saved);
  }, [active, snapshot, saved, onDirty, demo]);
  const save = useMutation({
    mutationFn: () => api("/api/admin/settings/pricing", { method: "PUT", body: JSON.stringify({ markupPercent: percent, markupYuan: fixed, rate }) }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "settings"] });
      toast({ title: "Pricing saved.", tone: "success" });
    },
    onError: (reason) => toast({ title: reason instanceof ApiError ? reason.message : "Could not save pricing.", tone: "danger" }),
  });
  const preview = previewPrice(cost, percent, fixed, rate);

  return (
    <form className="overflow-hidden rounded-lg border border-line bg-white" onSubmit={(event) => { event.preventDefault(); if (!demo) save.mutate(); }}>
      <div className="border-b border-slate-100 px-4 py-3">
        <h2 className="text-[13px] font-semibold">Markup and exchange rate</h2>
        <p className="mt-1 text-[13px] text-slate-500">{demo ? "Adjust the sample markup to preview a price. Refresh restores the demo values. Nothing is saved." : "One rule for every channel. HioBuy prices in yuan. Customers pay dollars."}</p>
      </div>
      <div className="grid gap-3 px-4 py-4 sm:grid-cols-3">
        <Field label="Markup %"><input className={inputClass} inputMode="decimal" value={percent} onChange={(event) => setPercent(event.target.value)} /></Field>
        <Field label="Fixed markup (CNY)"><input className={inputClass} inputMode="decimal" value={fixed} onChange={(event) => setFixed(event.target.value)} /></Field>
        <Field label="CNY per 1 USD"><input className={inputClass} inputMode="decimal" value={rate} onChange={(event) => setRate(event.target.value)} /></Field>
      </div>
      <div className="mx-4 mb-4 flex flex-wrap items-end justify-between gap-4 border-t border-slate-100 pt-4">
        <Field label="Preview cost (CNY)">
          <input className={cn(inputClass, "w-40")} inputMode="decimal" value={cost} onChange={(event) => setCost(event.target.value)} />
        </Field>
        <div className="pb-0.5 text-right">
          <div className="text-[12px] text-slate-500">Customer pays</div>
          <div className="mt-0.5 text-[22px] leading-none font-semibold tracking-tight tabular-nums">{preview ? formatFen(preview.usdFen) : "—"}</div>
          <div className="mt-1 text-[12px] text-slate-400">{preview ? `${formatCnyFen(preview.costFen)} → ${formatCnyFen(preview.sellFen)}` : "Enter a cost to preview."}</div>
        </div>
      </div>
      <div className="flex items-center justify-end gap-3 border-t border-slate-100 px-4 py-3">
        {demo ? <span className="text-[12px] text-slate-500">Preview only</span> : snapshot !== saved ? <span className="text-[12px] text-slate-500">Unsaved changes</span> : <span className="text-[12px] text-slate-400">Saved</span>}
        <Button type="submit" loading={save.isPending} disabled={demo || snapshot === saved}>{demo ? "Not saved in demo" : "Save changes"}</Button>
      </div>
    </form>
  );
}

function previewPrice(costYuan: string, percent: string, fixedYuan: string, rate: string) {
  if (!/^\d+(\.\d{1,2})?$/.test(costYuan) || !/^\d+(\.\d{1,2})?$/.test(percent) || !/^\d+(\.\d{1,2})?$/.test(fixedYuan) || !/^\d+(\.\d{1,4})?$/.test(rate)) return null;
  const [cw = "0", cf = ""] = costYuan.split(".");
  const costFen = Number(cw) * 100 + Number((cf + "00").slice(0, 2));
  const [pw = "0", pf = ""] = percent.split(".");
  const bps = Number(pw) * 100 + Number((pf + "00").slice(0, 2));
  const [fw = "0", ff = ""] = fixedYuan.split(".");
  const fixedFen = Number(fw) * 100 + Number((ff + "00").slice(0, 2));
  const [rw = "0", rf = ""] = rate.split(".");
  const rateE4 = Number(rw) * 10000 + Number((rf + "0000").slice(0, 4));
  if (bps > 10000 || rateE4 <= 0) return null;
  const policy = { markupBps: bps, markupCnyFen: fixedFen, cnyPerUsdE4: rateE4 };
  return { costFen, sellFen: markedUpCnyFen(costFen, policy), usdFen: customerUsdFen(costFen, policy) };
}
