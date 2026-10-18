import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button, CopyButton, ErrorState, Field, Notice, StatusBadge, inputClass } from "../../components/ui";
import { useToast } from "../../components/toast";
import { formatDateTime } from "../../domain/dates";
import { ApiError, api } from "../../lib/api";
import { cn } from "../../lib/utils";
import { Panel, allows, useAdminAccess } from "./shared";

type SyncItem = {
  id: string;
  entityType: string;
  publicId: string;
  tracking: string | null;
  action: string;
  label: string;
  remoteId: string | null;
  remoteSecondary: string | null;
  externalRef: string;
  errorCode: string | null;
  errorMessage: string | null;
  reason: string | null;
  canRetry: boolean;
  selectable: boolean;
  updatedAt: string;
};

type SyncList = {
  paused: { code: string; message: string } | null;
  counts: Record<string, number>;
  webhookConfigured: boolean;
  items: SyncItem[];
};

type SyncDetail = {
  remoteId: string | null;
  externalRef: string;
  links: { remoteType: string; remoteId: string; trackingNumber: string | null; remoteStatus: string | null }[];
  attempts: { id: string; attempt: number; httpStatus: number | null; outcome: string; errorCode: string | null; errorMessage: string | null; createdAt: string }[];
};

const buckets = [
  ["pending", "Pending"],
  ["syncing", "Syncing"],
  ["synced", "Synced"],
  ["failed", "Failed"],
  ["needs_review", "Needs review"],
] as const;

function AutoSyncSwitch() {
  const access = useAdminAccess();
  const toast = useToast();
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ["admin", "settings"], queryFn: () => api<{ autoSyncPackages?: boolean; connected: boolean }>("/api/admin/settings") });
  const save = useMutation({
    mutationFn: (enabled: boolean) => api("/api/admin/settings/package-sync", { method: "PUT", body: JSON.stringify({ enabled }) }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "settings"] });
      toast({ title: "Inbound notice sync updated.", tone: "success" });
    },
    onError: (reason) => toast({ title: reason instanceof ApiError ? reason.message : "Could not save the setting.", tone: "danger" }),
  });
  const enabled = settings.data?.autoSyncPackages !== false;
  if (!allows(access.data, "settings.write")) return null;
  return (
    <label className="flex items-start justify-between gap-4 border-b border-slate-100 px-4 py-3">
      <span>
        <span className="block text-[13px] font-semibold">Automatically submit new inbound notices</span>
        <span className="mt-1 block max-w-xl text-[12px] leading-5 text-slate-500">On by default. A new package is queued only while HioBuy is connected and the warehouse authorization is valid. Submitting a notice does not mark the parcel received.</span>
      </span>
      <input
        type="checkbox"
        className="mt-1 size-4"
        aria-label="Automatically submit new inbound notices"
        checked={enabled}
        disabled={save.isPending || settings.isLoading}
        onChange={(event) => save.mutate(event.target.checked)}
      />
    </label>
  );
}

export function FulfillmentSync({ canEditSecrets = true }: { canEditSecrets?: boolean }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [bucket, setBucket] = useState<(typeof buckets)[number][0]>("pending");
  const [entity, setEntity] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [secret, setSecret] = useState("");
  const query = useQuery({
    queryKey: ["admin", "fulfillment-sync", bucket, entity],
    queryFn: () => api<SyncList>(`/api/admin/settings/fulfillment-sync?status=${bucket}&entity=${entity}`),
  });
  const detail = useQuery({
    queryKey: ["admin", "fulfillment-sync", "detail", openId],
    queryFn: () => api<SyncDetail>(`/api/admin/settings/fulfillment-sync/${openId}`),
    enabled: Boolean(openId),
  });
  function refresh() {
    return queryClient.invalidateQueries({ queryKey: ["admin", "fulfillment-sync"] });
  }
  const scan = useMutation({
    mutationFn: () => api("/api/admin/settings/fulfillment-sync/scan", { method: "POST", body: "{}" }),
    onSuccess: async () => {
      await refresh();
      toast({ title: "History scanned. Nothing was sent until you choose it.", tone: "success" });
    },
    onError: (reason) => toast({ title: reason instanceof ApiError ? reason.message : "Could not scan history.", tone: "danger" }),
  });
  const enqueue = useMutation({
    mutationFn: () => api("/api/admin/settings/fulfillment-sync/enqueue", { method: "POST", body: JSON.stringify({ ids: selected }) }),
    onSuccess: async () => {
      setSelected([]);
      await refresh();
      toast({ title: "Selected records were queued.", tone: "success" });
    },
    onError: (reason) => toast({ title: reason instanceof ApiError ? reason.message : "Could not queue those records.", tone: "danger" }),
  });
  const retry = useMutation({
    mutationFn: (id: string) => api(`/api/admin/settings/fulfillment-sync/${id}/retry`, { method: "POST", body: "{}" }),
    onSuccess: async () => {
      await refresh();
      toast({ title: "Retry queued. The customer was not charged again.", tone: "success" });
    },
    onError: (reason) => toast({ title: reason instanceof ApiError ? reason.message : "Could not retry.", tone: "danger" }),
  });
  const saveSecret = useMutation({
    mutationFn: () => api("/api/admin/settings/hiobuy-webhook", { method: "PUT", body: JSON.stringify({ secret }) }),
    onSuccess: async () => {
      setSecret("");
      await refresh();
      toast({ title: "Webhook secret saved on the server.", tone: "success" });
    },
    onError: (reason) => toast({ title: reason instanceof ApiError ? reason.message : "Could not save the secret.", tone: "danger" }),
  });

  return (
    <Panel>
      <AutoSyncSwitch />
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <div>
          <h2 className="text-[13px] font-semibold">Fulfillment sync</h2>
          <p className="mt-1 max-w-xl text-[12px] leading-5 text-slate-500">An inbound notice is not a warehouse receipt. Package status changes only when HioBuy reports the parcel received.</p>
        </div>
        <Button size="sm" variant="secondary" loading={scan.isPending} onClick={() => scan.mutate()}>Scan history</Button>
      </div>
      {query.data?.paused ? <p className="border-b border-amber-100 bg-amber-50 px-4 py-2 text-[12px] text-amber-900">{query.data.paused.message} Automatic retries are paused.</p> : null}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2">
        {buckets.map(([id, label]) => (
          <button key={id} type="button" className={cn("rounded-full px-2.5 py-1 text-[12px]", bucket === id ? "bg-ink text-white" : "bg-slate-100 text-slate-600")} onClick={() => { setBucket(id); setOpenId(null); }}>
            {label} {query.data?.counts[id] ?? 0}
          </button>
        ))}
        <select className={cn(inputClass, "ml-auto h-8 w-36 py-1 text-[12px]")} aria-label="Record type" value={entity} onChange={(event) => setEntity(event.target.value)}>
          <option value="">Packages and shipments</option>
          <option value="package">Packages</option>
          <option value="shipment">Shipments</option>
        </select>
      </div>
      {query.isLoading ? <p className="px-4 py-8 text-center text-[13px] text-slate-500">Loading sync tasks.</p> : null}
      {query.error ? <div className="p-4"><ErrorState message="Could not load sync tasks." onRetry={() => void query.refetch()} /></div> : null}
      {query.data && query.data.items.length === 0 ? <p className="px-4 py-8 text-center text-[13px] text-slate-500">Nothing in this view.</p> : null}
      {query.data?.items.length ? (
        <ul className="divide-y divide-slate-100">
          {query.data.items.map((item) => (
            <li key={item.id} className="px-4 py-3 text-[13px]">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  {item.selectable ? (
                    <label className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={selected.includes(item.id)}
                        onChange={(event) => setSelected((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))}
                      />
                      <span>
                        <span className="font-medium">{item.publicId}</span>
                        <span className="ml-2 text-[12px] text-slate-400">{item.entityType === "package" ? "Inbound notice" : item.entityType} · {item.action === "inbound_create" ? "Submit" : item.action}</span>
                      </span>
                    </label>
                  ) : (
                    <button type="button" className="text-left" onClick={() => setOpenId(openId === item.id ? null : item.id)}>
                      <span className="font-medium">{item.publicId}</span>
                      <span className="ml-2 text-[12px] text-slate-400">{item.entityType} · {item.label}</span>
                    </button>
                  )}
                  <p className="mt-1 text-[12px] text-slate-500">{item.reason || item.errorMessage || item.tracking || "No error recorded."}</p>
                  {item.remoteId ? <p className="mt-1 font-mono text-[11px] text-slate-400">Remote {item.remoteId}{item.remoteSecondary ? ` · ${item.remoteSecondary}` : ""}</p> : null}
                  {item.errorCode ? <p className="mt-1 font-mono text-[11px] text-slate-400">{item.errorCode}</p> : null}
                </div>
                {item.canRetry ? <Button size="sm" variant="secondary" loading={retry.isPending} onClick={() => retry.mutate(item.id)}>Retry</Button> : null}
              </div>
              {openId === item.id && detail.data ? (
                <div className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-[12px] text-slate-600">
                  <p>External reference {detail.data.externalRef}</p>
                  {detail.data.links.length ? <p className="mt-1">Links {detail.data.links.map((link) => `${link.remoteType} ${link.remoteId}`).join(", ")}</p> : null}
                  {detail.data.attempts.length ? (
                    <ul className="mt-2 space-y-1">
                      {detail.data.attempts.map((attempt) => (
                        <li key={attempt.id}>Attempt {attempt.attempt}: {attempt.outcome}{attempt.httpStatus ? ` HTTP ${attempt.httpStatus}` : ""}{attempt.errorMessage ? ` — ${attempt.errorMessage}` : ""}</li>
                      ))}
                    </ul>
                  ) : <p className="mt-1">No attempts yet.</p>}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {bucket === "needs_review" && selected.length ? (
        <div className="border-t border-slate-100 px-4 py-3">
          <Button size="sm" loading={enqueue.isPending} onClick={() => enqueue.mutate()}>Submit to HioBuy</Button>
        </div>
      ) : null}
      {canEditSecrets ? <form className="flex flex-col gap-3 border-t border-slate-100 px-4 py-3 sm:flex-row sm:items-end" onSubmit={(event) => { event.preventDefault(); saveSecret.mutate(); }}>
        <Field label="Webhook signing secret" hint={query.data?.webhookConfigured ? "A secret is saved. Paste a new one to replace it." : "Paste the whsec value from the HioBuy developer portal."}>
          <input className={inputClass} type="password" autoComplete="off" value={secret} onChange={(event) => setSecret(event.target.value)} placeholder="whsec_…" />
        </Field>
        <Button type="submit" variant="secondary" loading={saveSecret.isPending} disabled={secret.trim().length < 8}>Save secret</Button>
      </form> : null}
      <WebhookActivity />
    </Panel>
  );
}

type WebhookEvent = { id: string; type: string; livemode: boolean; status: string; outcome: string | null; error: string | null; receivedAt: string };

type WebhookActivityView = {
  configured: boolean;
  rejectedAt: string | null;
  balanceAlert: { available: number; currency: string; threshold: number | null; at: string } | null;
  events: WebhookEvent[];
};

const eventTone: Record<string, "success" | "danger" | "warning"> = { processed: "success", failed: "danger", processing: "warning" };

function WebhookActivity() {
  const access = useAdminAccess();
  const toast = useToast();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["admin", "fulfillment-sync", "webhook"], queryFn: () => api<WebhookActivityView>("/api/admin/settings/hiobuy-webhook") });
  const dismiss = useMutation({
    mutationFn: () => api("/api/admin/settings/hiobuy-webhook/balance-alert", { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin", "fulfillment-sync", "webhook"] }),
    onError: (reason) => toast({ title: reason instanceof ApiError ? reason.message : "Could not dismiss the warning.", tone: "danger" }),
  });
  const endpoint = `${window.location.origin}/api/webhooks/hiobuy`;
  const data = query.data;
  const latest = data?.events[0] ?? null;
  const rejectedRecently = data?.rejectedAt && (!latest || data.rejectedAt > latest.receivedAt);
  return (
    <div className="border-t border-slate-100 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[13px] font-semibold">Webhook deliveries</h3>
          <p className="mt-1 break-all font-mono text-[11px] text-slate-500">{endpoint}</p>
        </div>
        <div className="flex gap-2">
          <CopyButton value={endpoint} size="sm" label="Copy URL" toastTitle="Endpoint URL copied." />
          <Button size="sm" variant="secondary" loading={query.isFetching} onClick={() => void query.refetch()}>Refresh</Button>
        </div>
      </div>
      <div className="mt-3 space-y-2">
        {data?.balanceAlert ? (
          <Notice
            tone="warning"
            action={allows(access.data, "fulfillment.write") ? <Button size="sm" variant="secondary" loading={dismiss.isPending} onClick={() => dismiss.mutate()}>Dismiss</Button> : undefined}
          >
            HioBuy warehouse wallet is low: {data.balanceAlert.available} {data.balanceAlert.currency}
            {data.balanceAlert.threshold != null ? ` (threshold ${data.balanceAlert.threshold})` : ""}. Reported {formatDateTime(data.balanceAlert.at)}. Top up so shipments can be paid.
          </Notice>
        ) : null}
        {data && !data.configured ? <Notice tone="warning">No signing secret is saved, so every HioBuy delivery is refused. Save the whsec value above.</Notice> : null}
        {data?.configured && rejectedRecently ? (
          <Notice tone="danger">A delivery was refused {formatDateTime(data.rejectedAt!)} because its signature did not match. Check that the saved secret belongs to this endpoint in the HioBuy portal.</Notice>
        ) : null}
        {data?.configured && !latest && !rejectedRecently ? <Notice tone="info">No deliveries yet. Use Send test event in the HioBuy developer portal to check the connection.</Notice> : null}
      </div>
      {query.error ? <div className="mt-3"><ErrorState message="Could not load webhook deliveries." onRetry={() => void query.refetch()} /></div> : null}
      {data?.events.length ? (
        <ul className="mt-3 divide-y divide-slate-100 rounded-md border border-slate-100">
          {data.events.map((event) => (
            <li key={event.id} className="px-3 py-2 text-[12px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-medium text-ink">{event.type}</span>
                <StatusBadge label={event.status} tone={eventTone[event.status] ?? "neutral"} />
                {event.livemode ? null : <StatusBadge label="Test" tone="neutral" />}
                <span className="ml-auto text-slate-400">{formatDateTime(event.receivedAt)}</span>
              </div>
              <p className={cn("mt-1", event.error ? "text-red-700" : "text-slate-500")}>{event.error || event.outcome || "—"}</p>
              <p className="mt-0.5 font-mono text-[11px] text-slate-400">{event.id}</p>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
