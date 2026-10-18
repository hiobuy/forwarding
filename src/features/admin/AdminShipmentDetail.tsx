import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { countryName } from "../../domain/countries";
import { hiobuyShipmentDisplay, interceptionDisplay } from "../../domain/status";
import { formatDateTime } from "../../domain/dates";
import {
  Button,
  Card,
  CargoBadge,
  ConfirmDialog,
  CopyButton,
  Dialog,
  Dimensions,
  ErrorState,
  Field,
  LoadingBlock,
  Money,
  MoneyRange,
  Notice,
  PhotoGallery,
  SectionHeading,
  Weight,
  inputClass,
  plural,
} from "../../components/ui";
import { useToast } from "../../components/toast";
import { ApiError, api } from "../../lib/api";
import type { Shipment } from "../../types/api";
import { formatKg, volumetricGrams } from "../../domain/units";
import { formatCnyFen, formatPercentBps, formatRateE4 } from "../../domain/freight";
import { TimelineList } from "../../components/timeline";
import { CarrierTracking } from "../../components/carrier-tracking";
import { formatFen } from "../../domain/money";
import { AdminHeader, StatusMark, allows, dollarsToFen, toInt, useAdminAccess, useAdminAction, type Owner, type ShipmentEarning } from "./shared";
import { ShipmentDocuments } from "../documents/ShipmentDocuments";

type Detail = Shipment & {
  ownerId: string;
  owner: Owner;
  hiobuyShipmentId: string | null;
  hiobuyStatus: string | null;
  hiobuyPaymentStatus: string | null;
  interceptionStatus: string | null;
  hiobuySyncedAt: string | null;
  syncLabel?: string;
  syncRemoteId?: string | null;
  fulfillment?: { label: string; tone: "success" | "warning" | "danger" | "info" | "neutral" };
  customerPayment?: string;
  hiobuyPayment?: string;
  canPull?: boolean;
  canPayHioBuy?: boolean;
  earning: ShipmentEarning;
  timeline?: { at: string; title: string; detail: string }[];
};

type PayQuote = {
  ready: boolean;
  already: boolean;
  reason: string;
  publicId: string;
  hiobuyShipmentId: string | null;
  customerPaidUsdFen: number;
  costCnyFen: number | null;
  balanceCnyFen: number | null;
  requires2fa?: boolean;
  enrolled?: boolean;
};

const progress = [
  { label: "Packing", statuses: ["CONSOLIDATING", "WAITING_FOR_WEIGHT"] },
  { label: "Payment", statuses: ["TO_PAY"] },
  { label: "Ready to ship", statuses: ["READY_TO_SHIP"] },
  { label: "In transit", statuses: ["SHIPPED", "IN_TRANSIT"] },
  { label: "Delivered", statuses: ["DELIVERED"] },
];

export function AdminShipmentDetail() {
  const { id = "" } = useParams();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [payCode, setPayCode] = useState("");
  const [params] = useSearchParams();
  const [packing, setPacking] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [delivering, setDelivering] = useState(false);
  const query = useQuery({ queryKey: ["admin", "shipment", id], queryFn: () => api<Detail>(`/api/admin/shipments/${id}`) });
  const settings = useQuery({ queryKey: ["admin", "settings"], queryFn: () => api<{ connected: boolean }>("/api/admin/settings") });
  const cancel = useMutation({
    mutationFn: () => api(`/api/admin/shipments/${id}/cancel`, { method: "POST" }),
    onSuccess: async () => {
      setCancelOpen(false);
      toast({ title: "Cancelled for the customer. Packages are free to ship again.", tone: "success" });
      await queryClient.invalidateQueries({ queryKey: ["admin", "shipment", id] });
      await queryClient.invalidateQueries({ queryKey: ["admin", "shipments"] });
      await queryClient.invalidateQueries({ queryKey: ["admin", "packages"] });
    },
    onError: (reason) => {
      setCancelOpen(false);
      toast({ title: reason instanceof ApiError ? reason.message : "Could not cancel the consolidation.", tone: "danger" });
    },
  });
  const deliver = useAdminAction<Detail>((current) => `/api/admin/shipments/${current.id}/deliver`, {
    success: (current) => `${current.publicId} marked delivered.`,
    onDone: () => setDelivering(false),
  });
  const pullNow = useMutation({
    mutationFn: () => api<{ items: { message: string; outcome: string }[]; failed: number; needsReview: number }>(`/api/admin/shipments/pull`, { method: "POST", body: JSON.stringify({ ids: [id], scope: "selected" }) }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "shipment", id] });
      await queryClient.invalidateQueries({ queryKey: ["admin", "shipments"] });
      toast({ title: result.items[0]?.message ?? "Status pull finished.", tone: result.failed || result.needsReview ? "danger" : "success" });
    },
    onError: (reason) => toast({ title: reason instanceof ApiError ? reason.message : "Could not pull this shipment.", tone: "danger" }),
  });
  const intercept = useMutation({
    mutationFn: () => api(`/api/admin/shipments/${id}/intercept`, { method: "POST", body: JSON.stringify({ reason: "CUSTOMER_REQUEST", remark: "Customer requested a hold." }) }),
    onSuccess: async () => {
      toast({ title: "Interception requested. The shipment status was not changed.", tone: "success" });
      await queryClient.invalidateQueries({ queryKey: ["admin", "shipment", id] });
    },
    onError: (reason) => toast({ title: reason instanceof ApiError ? reason.message : "Could not request an interception.", tone: "danger" }),
  });
  const syncLog = useQuery({ queryKey: ["admin", "shipment-sync", id], queryFn: () => api<{ history: { id: string; operationLabel: string; outcome: string; previousStatus: string | null; newStatus: string | null; errorCode: string | null; errorMessage: string | null; requestId: string | null; createdAt: string }[] }>(`/api/admin/shipments/${id}/sync`), enabled: Boolean(id) });
  const access = useAdminAccess();
  const canPay = allows(access.data, "shipments.pay");
  const canOperate = allows(access.data, "shipments.write");
  const canAdjust = allows(access.data, "payments.money");
  const payQuote = useQuery({ queryKey: ["admin", "shipment", id, "hiobuy-pay"], queryFn: () => api<PayQuote>(`/api/admin/shipments/${id}/hiobuy-pay`), enabled: payOpen && canPay });
  const payHiobuy = useMutation({
    mutationFn: () => api(`/api/admin/shipments/${id}/hiobuy-pay`, { method: "POST", body: JSON.stringify({ code: payCode }) }),
    onSuccess: async () => {
      setPayOpen(false);
      toast({ title: "HioBuy payment confirmed. The customer wallet was not charged again.", tone: "success" });
      await queryClient.invalidateQueries({ queryKey: ["admin", "shipment", id] });
      await queryClient.invalidateQueries({ queryKey: ["admin", "shipments"] });
      await queryClient.invalidateQueries({ queryKey: ["admin", "overview"] });
      await queryClient.invalidateQueries({ queryKey: ["admin", "shipment-sync", id] });
    },
    onError: (reason) => toast({ title: reason instanceof ApiError ? reason.message : "HioBuy payment failed. The customer wallet was not charged again.", tone: "danger" }),
  });
  useEffect(() => {
    if (params.get("pay") === "1" && canPay) {
      setPayCode("");
      setPayOpen(true);
    }
  }, [params, canPay]);
  const item = query.data;
  if (query.isLoading) return <LoadingBlock rows={4} />;
  if (!item) return <ErrorState message="This shipment could not be found." onRetry={() => void query.refetch()} action={<Button variant="ghost" size="sm" to="/admin/shipments">Back to shipments</Button>} />;
  const due = item.charges.filter((charge) => charge.status === "DUE").reduce((sum, charge) => sum + charge.amountFen, 0);
  const index = progress.findIndex((stage) => stage.statuses.includes(item.status));

  return (
    <div>
      <AdminHeader
        back={{ to: "/admin/shipments", label: "Shipments" }}
        title={item.publicId}
        badge={<StatusMark label={item.fulfillment?.label ?? item.displayStatus.label} tone={item.fulfillment?.tone ?? item.displayStatus.tone} />}
        meta={`Created ${formatDateTime(item.createdAt)} · ${plural(item.packageCount, "package")} · ${item.owner?.name ?? "customer"} ${item.owner?.memberCode ?? ""}`}
        action={
          <>
            {(item.status === "CONSOLIDATING" || item.status === "WAITING_FOR_WEIGHT") && !settings.data?.connected ? <Button onClick={() => setPacking(true)}>Pack and set freight</Button> : null}
            {item.status === "READY_TO_SHIP" && !settings.data?.connected ? <Button onClick={() => setDispatching(true)}>Dispatch</Button> : null}
            {item.status === "IN_TRANSIT" || item.status === "SHIPPED" ? <Button variant="secondary" onClick={() => setDelivering(true)}>Mark delivered</Button> : null}
          </>
        }
      />
      {index >= 0 ? (
        <ol className="mb-5 grid grid-cols-5 gap-1.5" aria-label="Shipment progress">
          {progress.map((stage, i) => {
            const done = i < index || item.status === "DELIVERED";
            const current = i === index && item.status !== "DELIVERED";
            return (
              <li key={stage.label}>
                <div className={`h-1 rounded-full ${done ? "bg-ink" : current ? "bg-ink/30" : "bg-slate-200"}`} />
                <div className={`mt-2 flex items-center gap-1 text-[12px] ${current ? "font-semibold text-ink" : "text-slate-500"}`}>
                  {done ? <Check size={12} aria-hidden="true" /> : null}
                  <span className="truncate">{stage.label}</span>
                </div>
              </li>
            );
          })}
        </ol>
      ) : null}
      {item.status === "TO_PAY" ? <Notice tone="warning">Final freight is due. The customer pays from their own wallet. This screen does not charge them.</Notice> : null}
      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(280px,0.75fr)]">
        <div className="space-y-4">
          <Card>
            <SectionHeading title="Timeline" />
            <TimelineList events={item.timeline ?? []} />
          </Card>
          <Card>
            <SectionHeading title="Included packages" action={<span className="text-[12px] text-slate-400">{plural(item.packages.length, "package")}</span>} />
            <ul className="mt-3 divide-y divide-slate-100">
              {item.packages.map((pkg) => (
                <li key={pkg.id} className="flex items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <div className="font-medium text-ink">{pkg.publicId}</div>
                    <div className="mt-0.5 truncate font-mono text-[12px] text-slate-500">{[pkg.courier, pkg.domesticTrackingNumber].filter(Boolean).join(" ") || "No domestic tracking"}</div>
                    <div className="mt-1 text-[12px] text-slate-500">
                      {pkg.weightGrams != null ? <Weight grams={pkg.weightGrams} /> : "No weight"} · <Dimensions length={pkg.lengthMm} width={pkg.widthMm} height={pkg.heightMm} />
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {pkg.cargoAttributes.map((attribute) => (
                        <CargoBadge key={attribute} attribute={attribute} />
                      ))}
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" to={`/admin/packages/${pkg.id}`}>
                    Details <ChevronRight size={13} aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          </Card>
          <div className="grid gap-4 md:grid-cols-2">
            {item.destination ? (
              <Card>
                <SectionHeading title="Destination" action={<CopyButton value={destinationCopy(item.destination)} label="Copy address" variant="ghost" size="sm" />} />
                <p className="mt-3 text-[13px] leading-6 text-slate-700">
                  <span className="font-medium text-ink">{item.destination.name}</span>
                  <br />
                  {item.destination.addressLine1} {item.destination.addressLine2}
                  <br />
                  {item.destination.city}, {item.destination.state} {item.destination.postalCode}
                  <br />
                  {countryName(item.destination.countryCode)} · {item.destination.phone}
                </p>
              </Card>
            ) : null}
            {item.shippingMethod ? (
              <Card>
                <SectionHeading title="Shipping method" />
                <p className="mt-3 text-[13px] font-medium">{item.shippingMethod.routeName}</p>
                <p className="mt-1 text-[13px] text-slate-500">
                  Estimated <MoneyRange min={item.shippingMethod.estimatedMinFen} max={item.shippingMethod.estimatedMaxFen} />
                </p>
              </Card>
            ) : null}
          </div>
          <Card>
            <SectionHeading title="Final measurement" />
            {item.finalWeightGrams == null ? (
              <p className="mt-3 text-[13px] text-slate-500">Available after HioBuy finishes packing.</p>
            ) : (
              <dl className="mt-4 grid gap-2 sm:grid-cols-3">
                <div><dt className="text-[12px] text-slate-500">Final weight</dt><dd className="mt-1 font-semibold tabular-nums"><Weight grams={item.finalWeightGrams} /></dd></div>
                <div><dt className="text-[12px] text-slate-500">Volumetric</dt><dd className="mt-1 font-semibold tabular-nums"><Weight grams={item.finalVolumetricWeightGrams} /></dd></div>
                <div><dt className="text-[12px] text-slate-500">Size</dt><dd className="mt-1 font-semibold tabular-nums"><Dimensions length={item.finalLengthMm} width={item.finalWidthMm} height={item.finalHeightMm} /></dd></div>
              </dl>
            )}
          </Card>
          {item.cartons.length ? (
            <Card>
              <SectionHeading title="Outbound cartons" action={<span className="text-[12px] text-slate-400">{plural(item.cartons.length, "carton")}</span>} />
              <ul className="mt-3 divide-y divide-slate-100">
                {item.cartons.map((carton) => (
                  <li key={carton.id} className="flex items-start justify-between gap-3 py-3 text-[13px]">
                    <div className="min-w-0">
                      <div className="font-medium text-ink">{carton.code}</div>
                      <div className="mt-0.5 text-slate-500">{carton.packages.length ? carton.packages.map((pkg) => `${pkg.publicId}${pkg.trackingNumber ? ` · ${pkg.trackingNumber}` : ""}`).join(", ") : "No packages listed"}</div>
                      {carton.trackingNumber ? <div className="mt-0.5 font-mono text-[12px] text-slate-400">{carton.trackingNumber}</div> : null}
                    </div>
                    <div className="text-right text-slate-600">
                      <div>{carton.weightGrams != null ? <Weight grams={carton.weightGrams} /> : "—"}</div>
                      <div className="text-[12px] text-slate-400"><Dimensions length={carton.lengthMm} width={carton.widthMm} height={carton.heightMm} /></div>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
          <Card>
            <SectionHeading title="Packing photos and video" />
            <div className="mt-4">
              <PhotoGallery photos={item.photos} />
            </div>
          </Card>
        </div>
        <div className="space-y-4">
          <Card>
            <SectionHeading title="HioBuy" />
            <div className="mt-3 space-y-2 text-[13px] text-slate-600">
              <p>Status <span className="font-medium text-ink">{item.fulfillment?.label ?? hiobuyShipmentDisplay(item.hiobuyStatus)?.label ?? "Not on HioBuy"}</span></p>
              <p>{item.customerPayment} · {item.hiobuyPayment}</p>
              {interceptionDisplay(item.interceptionStatus) ? <p className="font-medium text-amber-800">{interceptionDisplay(item.interceptionStatus)?.label}</p> : null}
              <p>Sync <span className="font-medium text-ink">{item.syncLabel ?? "Not linked"}</span></p>
              <div className="flex flex-wrap gap-2 pt-1">
                {canPay && item.canPayHioBuy ? <Button size="sm" onClick={() => { setPayCode(""); setPayOpen(true); }}>Pay HioBuy</Button> : null}
                {canOperate && item.canPull ? <Button size="sm" variant="secondary" loading={pullNow.isPending} onClick={() => pullNow.mutate()}>Sync now</Button> : null}
                {canOperate && (item.hiobuyStatus === "WAIT_SHIP" || item.hiobuyStatus === "SHIPPED") ? <Button size="sm" variant="secondary" loading={intercept.isPending} onClick={() => intercept.mutate()}>Request intercept</Button> : null}
              </div>
              {syncLog.data?.history.length ? (
                <ul className="space-y-1 border-t border-slate-100 pt-2 text-[12px]">
                  {syncLog.data.history.slice(0, 5).map((entry) => (
                    <li key={entry.id}>{entry.operationLabel} · {entry.outcome}{entry.previousStatus ? ` · ${entry.previousStatus}${entry.newStatus ? ` → ${entry.newStatus}` : ""}` : ""}{entry.errorCode ? ` · ${entry.errorCode}` : ""}{entry.errorMessage ? ` · ${entry.errorMessage}` : ""}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          </Card>
          <EarningsCard item={item} canAdjust={canAdjust} />
          <Card>
            <div className="text-[13px] font-semibold">Charges</div>
            {item.charges.length ? (
              <dl className="mt-2">
                {item.charges.map((charge) => (
                  <div key={charge.id} className="flex justify-between gap-3 py-1.5 text-[13px]">
                    <dt className="text-slate-600">{charge.name}</dt>
                    <dd className="font-medium"><Money fen={charge.amountFen} /></dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="mt-2 text-[13px] text-slate-500">Charges appear after packing.</p>
            )}
            {item.status === "TO_PAY" ? <p className="mt-2 text-[13px] font-medium">Due <Money fen={due} /></p> : null}
          </Card>
          <ShipmentDocuments shipmentId={item.id} admin />
          <CarrierTracking shipmentId={item.id} admin />
          {item.canCancel ? (
            <Button variant="ghost" className="text-red-700" onClick={() => setCancelOpen(true)}>
              Cancel for the customer
            </Button>
          ) : null}
        </div>
      </div>
      <Dialog
        open={payOpen}
        title="Pay HioBuy"
        description="This charges the HioBuy fulfillment wallet. The customer wallet is not charged again."
        onClose={() => { if (!payHiobuy.isPending) setPayOpen(false); }}
        footer={
          <>
            <Button variant="secondary" onClick={() => setPayOpen(false)} disabled={payHiobuy.isPending}>Cancel</Button>
            <Button loading={payHiobuy.isPending} disabled={!payQuote.data?.ready || (Boolean(payQuote.data?.requires2fa) && (!payQuote.data?.enrolled || payCode.trim().length < 6))} onClick={() => payHiobuy.mutate()}>Confirm payment</Button>
          </>
        }
      >
        {payQuote.isLoading ? <p className="text-[13px] text-slate-500">Checking HioBuy…</p> : null}
        {payQuote.data ? (
          <dl className="space-y-2 text-[13px]">
            <div className="flex justify-between gap-3"><dt className="text-slate-500">Shipment</dt><dd className="font-medium">{payQuote.data.publicId}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-slate-500">HioBuy shipment</dt><dd className="font-mono">{payQuote.data.hiobuyShipmentId ?? "—"}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-slate-500">Customer paid</dt><dd className="font-medium">{formatFen(payQuote.data.customerPaidUsdFen)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-slate-500">HioBuy cost</dt><dd className="font-medium">{payQuote.data.costCnyFen == null ? "—" : formatCnyFen(payQuote.data.costCnyFen)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-slate-500">HioBuy wallet</dt><dd className="font-medium">{payQuote.data.balanceCnyFen == null ? "Unavailable" : formatCnyFen(payQuote.data.balanceCnyFen)}</dd></div>
            {payQuote.data.reason ? <p className="pt-1 text-amber-800">{payQuote.data.reason}</p> : null}
            {payQuote.data.requires2fa ? (
              payQuote.data.enrolled ? (
                <Field label="Authenticator code" hint="This code authorizes only this payment.">
                  <input className={inputClass} inputMode="text" autoComplete="one-time-code" value={payCode} onChange={(event) => setPayCode(event.target.value)} />
                </Field>
              ) : (
                <p className="text-[13px] text-amber-800">Set up an authenticator in Team before paying HioBuy.</p>
              )
            ) : null}
          </dl>
        ) : null}
        {payQuote.isError ? <p className="text-[13px] text-red-700">{payQuote.error instanceof ApiError ? payQuote.error.message : "Could not check this payment."}</p> : null}
      </Dialog>
      <ConfirmDialog
        open={cancelOpen}
        title="Cancel this consolidation for the customer?"
        body="Packages return to Ready. Nothing is charged. The customer is notified."
        confirmLabel="Cancel consolidation"
        danger
        pending={cancel.isPending}
        onClose={() => setCancelOpen(false)}
        onConfirm={() => cancel.mutate()}
      />
      <PackDialog shipment={packing ? item : null} onClose={() => setPacking(false)} />
      <DispatchDialog shipment={dispatching ? item : null} onClose={() => setDispatching(false)} />
      <ConfirmDialog
        open={delivering}
        title={`Mark ${item.publicId} delivered?`}
        body="The customer gets a notification."
        confirmLabel="Mark delivered"
        pending={deliver.isPending}
        onClose={() => setDelivering(false)}
        onConfirm={() => deliver.mutate(item)}
      />
    </div>
  );
}

function PackDialog({ shipment, onClose }: { shipment: Detail | null; onClose: () => void }) {
  const [form, setForm] = useState({ weight: "", length: "", width: "", height: "", freight: "" });
  const [error, setError] = useState("");
  useEffect(() => {
    if (!shipment) return;
    setForm({ weight: "", length: "", width: "", height: "", freight: shipment.shippingMethod ? (shipment.shippingMethod.estimatedMaxFen / 100).toFixed(2) : "" });
    setError("");
  }, [shipment]);
  const pack = useAdminAction<{ shipment: Detail; body: unknown }>(({ shipment: current }) => `/api/admin/shipments/${current.id}/pack`, {
    body: ({ body }) => body,
    success: ({ shipment: current }) => `${current.publicId} packed. The customer can pay.`,
    onDone: onClose,
  });
  const l = toInt(form.length, 10);
  const w = toInt(form.width, 10);
  const h = toInt(form.height, 10);
  const actual = toInt(form.weight, 1000);
  return (
    <Dialog open={shipment != null} title={shipment ? `Pack ${shipment.publicId}` : ""} onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="pack-form" loading={pack.isPending}>Send bill</Button></>}>
      {shipment ? (
        <form id="pack-form" className="space-y-4" onSubmit={(event) => {
          event.preventDefault();
          const freightFen = dollarsToFen(form.freight);
          if (!actual || !l || !w || !h || !freightFen || freightFen <= 0) {
            setError("Enter the packed weight, all three sides, and a freight amount above $0.");
            return;
          }
          pack.mutate({ shipment, body: { finalWeightGrams: actual, finalLengthMm: l, finalWidthMm: w, finalHeightMm: h, freightFen } });
        }}>
          <Field label="Packed weight (kg)"><input className={inputClass} inputMode="decimal" value={form.weight} onChange={(event) => setForm({ ...form, weight: event.target.value })} autoFocus /></Field>
          <div className="grid grid-cols-3 gap-3">
            {(["length", "width", "height"] as const).map((key) => (
              <Field key={key} label={`${key} (cm)`}><input className={inputClass} inputMode="decimal" value={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.value })} /></Field>
            ))}
          </div>
          {actual && l && w && h ? <p className="text-[12px] text-slate-500">Chargeable {formatKg(Math.max(actual, volumetricGrams(l, w, h)))}</p> : null}
          <Field label="Final freight (USD)"><input className={inputClass} inputMode="decimal" value={form.freight} onChange={(event) => setForm({ ...form, freight: event.target.value.replace(/[^\d.]/g, "") })} /></Field>
          {error ? <Notice tone="danger">{error}</Notice> : null}
        </form>
      ) : null}
    </Dialog>
  );
}

function EarningsCard({ item, canAdjust }: { item: Detail; canAdjust: boolean }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const earning = item.earning;
  const [kind, setKind] = useState<"refund" | "extra_charge" | "cost">("refund");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const save = useMutation({
    mutationFn: () => api(`/api/admin/shipments/${item.id}/earnings/adjustments`, { method: "POST", body: JSON.stringify({ kind, amount, note, idempotencyKey }) }),
    onSuccess: async () => {
      setAmount("");
      setNote("");
      setIdempotencyKey(crypto.randomUUID());
      toast({ title: "Shipping gross profit updated.", tone: "success" });
      await queryClient.invalidateQueries({ queryKey: ["admin"] });
    },
    onError: (reason) => toast({ title: reason instanceof ApiError ? reason.message : "Could not save the adjustment.", tone: "danger" }),
  });
  const finalize = useMutation({
    mutationFn: () => api(`/api/admin/shipments/${item.id}/earnings/finalize`, { method: "POST" }),
    onSuccess: async () => {
      toast({ title: "HioBuy cost marked final.", tone: "success" });
      await queryClient.invalidateQueries({ queryKey: ["admin"] });
    },
    onError: (reason) => toast({ title: reason instanceof ApiError ? reason.message : "Could not confirm the cost.", tone: "danger" }),
  });
  const rows: { label: string; value: string }[] = [
    { label: "HioBuy cost", value: earning.hiobuyCostCnyFen == null ? "—" : formatCnyFen(earning.hiobuyCostCnyFen) },
    { label: "Markup", value: earning.markupBps == null ? "—" : `${formatPercentBps(earning.markupBps)}%` },
    { label: "Fixed markup", value: earning.markupCnyFen == null ? "—" : formatCnyFen(earning.markupCnyFen) },
    { label: "Exchange rate", value: earning.cnyPerUsdE4 == null ? "—" : `${formatRateE4(earning.cnyPerUsdE4)} CNY/USD` },
    { label: "Customer charged", value: moneyOrDash(earning.customerChargedUsdFen) },
    { label: "HioBuy cost USD", value: moneyOrDash(earning.hiobuyCostUsdFen) },
  ];
  return (
    <Card>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[13px] font-semibold">Shipping gross profit</h2>
        <span className="text-[12px] text-slate-500">{earningStatusLabel(earning.status)}</span>
      </div>
      <p className="mt-2 text-[1.35rem] leading-none font-semibold tabular-nums">{earning.status === "pending" || earning.status === "unavailable" ? "—" : moneyOrDash(earning.grossProfitUsdFen)}</p>
      {earning.status === "pending" ? <p className="mt-2 text-[12px] leading-5 text-slate-500">Not collected yet. This is not realized profit.</p> : null}
      {earning.status === "unavailable" ? <p className="mt-2 text-[12px] leading-5 text-slate-500">The saved cost or exchange rate is missing, so profit is left blank.</p> : null}
      {earning.status === "provisional" ? <p className="mt-2 text-[12px] leading-5 text-slate-500">Paid. The HioBuy cost is still the packed quote.</p> : null}
      <dl className="mt-3">
        {rows.map((row) => (
          <div key={row.label} className="flex items-baseline justify-between gap-3 py-1 text-[13px]">
            <dt className="text-slate-500">{row.label}</dt>
            <dd className="text-right tabular-nums">{row.value}</dd>
          </div>
        ))}
      </dl>
      {earning.adjustments.length ? (
        <ul className="mt-2 border-t border-slate-100 pt-2">
          {earning.adjustments.map((row) => (
            <li key={row.id} className="py-1 text-[12px] text-slate-600">
              <span className="font-medium text-ink">{adjustmentLabel(row.kind)}</span>
              {row.kind === "cost" ? ` ${row.cnyFen == null ? "" : formatCnyFen(row.cnyFen)}` : ` ${moneyOrDash(row.usdFen)}`}
              <span className="text-slate-400"> · {row.note}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {canAdjust && earning.status === "provisional" ? <Button className="mt-3" size="sm" variant="secondary" loading={finalize.isPending} onClick={() => finalize.mutate()}>Mark cost final</Button> : null}
      {canAdjust && earning.status !== "pending" ? (
        <form className="mt-3 space-y-2 border-t border-slate-100 pt-3" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
          <div className="grid grid-cols-2 gap-2">
            <select className={inputClass} value={kind} onChange={(event) => setKind(event.target.value as typeof kind)} aria-label="Adjustment type">
              <option value="refund">Refund</option>
              <option value="extra_charge">Extra freight</option>
              <option value="cost">HioBuy cost</option>
            </select>
            <input className={inputClass} inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder={kind === "cost" ? "Yuan" : "USD"} aria-label="Amount" />
          </div>
          <input className={inputClass} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Note" aria-label="Note" />
          <Button type="submit" size="sm" variant="secondary" loading={save.isPending} disabled={note.trim().length < 2 || !amount.trim()}>Save adjustment</Button>
        </form>
      ) : null}
    </Card>
  );
}

function earningStatusLabel(status: ShipmentEarning["status"]) {
  if (status === "pending") return "Pending";
  if (status === "provisional") return "Provisional";
  if (status === "finalized") return "Final";
  if (status === "adjusted") return "Adjusted";
  return "Unavailable";
}

function destinationCopy(destination: NonNullable<Shipment["destination"]>) {
  return [
    destination.name,
    [destination.addressLine1, destination.addressLine2].filter(Boolean).join(", "),
    [destination.district, destination.city, destination.state, destination.postalCode].filter(Boolean).join(", "),
    [countryName(destination.countryCode), destination.phone].filter(Boolean).join(" · "),
  ].filter(Boolean).join("\n");
}

function adjustmentLabel(kind: ShipmentEarning["adjustments"][number]["kind"]) {
  if (kind === "refund") return "Refund";
  if (kind === "extra_charge") return "Extra freight";
  return "Cost update";
}

function moneyOrDash(fen: number | null) {
  if (fen == null) return "—";
  return formatFen(fen);
}

function DispatchDialog({ shipment, onClose }: { shipment: Detail | null; onClose: () => void }) {
  const [tracking, setTracking] = useState("");
  useEffect(() => setTracking(""), [shipment]);
  const dispatch = useAdminAction<{ shipment: Detail; trackingNumber: string }>(({ shipment: current }) => `/api/admin/shipments/${current.id}/dispatch`, {
    body: ({ trackingNumber }) => ({ trackingNumber }),
    success: ({ shipment: current }) => `${current.publicId} dispatched.`,
    onDone: onClose,
  });
  return (
    <Dialog open={shipment != null} title={shipment ? `Dispatch ${shipment.publicId}` : ""} onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="dispatch-form" loading={dispatch.isPending} disabled={tracking.trim().length < 6}>Dispatch</Button></>}>
      <form id="dispatch-form" onSubmit={(event) => { event.preventDefault(); if (shipment) dispatch.mutate({ shipment, trackingNumber: tracking.trim() }); }}>
        <Field label="Carrier tracking number"><input className={inputClass} value={tracking} onChange={(event) => setTracking(event.target.value)} autoFocus /></Field>
      </form>
    </Dialog>
  );
}
