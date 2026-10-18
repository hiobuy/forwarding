import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Boxes, Check, ChevronRight, Clock, CreditCard, ImageIcon, MapPin, Package, PackageCheck, Ruler, SearchX, Truck } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { countryName } from "../../domain/countries";
import { formatDateTime } from "../../domain/dates";
import { TimelineList } from "../../components/timeline";
import { CarrierTracking } from "../../components/carrier-tracking";
import { SHIPMENT_FILTERS } from "../../domain/status";
import { Button, Card, CargoBadge, ConfirmDialog, Dimensions, EmptyState, ErrorState, FilterBar, LoadingBlock, Money, MoneyRange, Notice, PageHeader, PhotoGallery, SearchInput, SectionHeading, StatusBadge, Weight, plural } from "../../components/ui";
import { Checkbox } from "../../components/ui/checkbox";
import { useToast } from "../../components/toast";
import { ApiError, api } from "../../lib/api";
import { useBrand } from "../../lib/brand";
import type { Checkout, Page, Shipment } from "../../types/api";
import { ShipmentDocuments } from "../documents/ShipmentDocuments";

export function ShipmentsPage() {
  const [params, setParams] = useSearchParams();
  const status = params.get("status") ?? "all";
  const q = params.get("q") ?? "";
  const navigate = useNavigate();
  const toast = useToast();
  const [selected, setSelected] = useState<string[]>([]);
  const query = useQuery({
    queryKey: ["shipments", status, q],
    queryFn: () => api<Page<Shipment>>(`/api/shipments?status=${status}&q=${encodeURIComponent(q)}`),
    placeholderData: keepPreviousData,
  });
  const checkout = useMutation({
    mutationFn: (ids: string[]) => api<Checkout>("/api/checkout", { method: "POST", body: JSON.stringify({ shipmentIds: ids }) }),
    onSuccess: (result) => navigate(`/app/checkout/${result.id}`),
    onError: (reason) => toast({ title: reason instanceof ApiError ? reason.message : "Could not start checkout.", tone: "danger" }),
  });
  const payable = query.data?.items.filter((item) => item.status === "TO_PAY") ?? [];
  const chosen = payable.filter((item) => selected.includes(item.id));
  const total = chosen.reduce((sum, item) => sum + item.amountFen, 0);
  const payableTotal = payable.reduce((sum, item) => sum + item.amountFen, 0);
  const allChosen = payable.length > 0 && chosen.length === payable.length;
  const filtered = status !== "all" || q !== "";
  const grid = "grid-cols-[1.25rem_minmax(150px,1.2fr)_minmax(150px,1.1fr)_5rem_6rem_minmax(130px,0.9fr)_1.25rem]";

  function toggle(id: string) {
    setSelected((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id]));
  }

  return (
    <div className="pb-24">
      <PageHeader title="Shipments" subtitle="Track consolidations from packing to delivery. Pay one shipment or several at once." action={<Button variant="secondary" to="/app/consolidate"><Boxes size={15} aria-hidden="true" /> New consolidation</Button>} />
      {payable.length && status !== "to_pay" ? (
        <div className="mb-4">
          <Notice
            tone="warning"
            action={
              <Button size="sm" loading={checkout.isPending && checkout.variables?.length === payable.length} onClick={() => checkout.mutate(payable.map((item) => item.id))}>
                Pay all <Money fen={payableTotal} />
              </Button>
            }
          >
            <strong>{plural(payable.length, "shipment")} waiting for payment.</strong> They ship after you pay.
          </Notice>
        </div>
      ) : null}
      <FilterBar
        value={status}
        options={SHIPMENT_FILTERS}
        onChange={(key) => {
          setSelected([]);
          setParams(q ? { status: key, q } : { status: key });
        }}
      />
      <SearchInput defaultValue={q} placeholder="Search shipment ID or tracking number" label="Search shipments" onSearch={(next) => setParams(next ? { status, q: next } : { status })} />
      {query.isLoading ? <LoadingBlock rows={4} /> : null}
      {query.error ? <ErrorState message="Could not load shipments." onRetry={() => void query.refetch()} /> : null}
      {query.data && query.data.items.length === 0 ? (
        filtered ? (
          <EmptyState icon={SearchX} title="No shipments match" body="Try another status or search term." action={<Button variant="secondary" onClick={() => setParams({})}>Show all shipments</Button>} />
        ) : (
          <EmptyState icon={Truck} title="No shipments yet" body="Choose ready packages and submit a consolidation. It shows up here while the warehouse packs it." action={<Button to="/app/consolidate">Consolidate & ship</Button>} />
        )
      ) : null}
      {query.data && query.data.items.length > 0 ? (
        <div className={`overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(16,24,40,0.03)] transition-opacity ${query.isPlaceholderData ? "opacity-60" : ""}`}>
          <div className={`hidden ${grid} items-center gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-2 text-[12px] font-medium text-slate-500 md:grid`}>
            {payable.length ? (
              <Checkbox
                checked={allChosen ? true : chosen.length ? "indeterminate" : false}
                onCheckedChange={() => setSelected(allChosen ? [] : payable.map((item) => item.id))}
                aria-label="Select all shipments to pay"
              />
            ) : (
              <span aria-hidden="true" />
            )}
            <span>Shipment</span>
            <span>Destination</span>
            <span className="text-right">Weight</span>
            <span className="text-right">Amount</span>
            <span>Status</span>
            <span aria-hidden="true" />
          </div>
          <ul>
            {query.data.items.map((item) => {
              const canPay = item.status === "TO_PAY";
              const on = canPay && selected.includes(item.id);
              return (
                <li key={item.id} className={`relative border-b border-slate-100 last:border-b-0 ${on ? "bg-indigo-50/50" : ""}`}>
                  <div className={`group hidden ${grid} items-center gap-3 px-4 py-2.5 text-[13px] transition-colors hover:bg-slate-50/80 md:grid`}>
                    {canPay ? (
                      <Checkbox className="relative z-10" aria-label={`Select ${item.publicId} for payment`} checked={on} onCheckedChange={() => toggle(item.id)} />
                    ) : (
                      <span aria-hidden="true" />
                    )}
                    <div className="min-w-0">
                      <Link to={`/app/shipments/${item.id}`} className="font-medium tracking-tight text-ink after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-indigo-400 focus-visible:after:ring-inset">
                        {item.publicId}
                      </Link>
                      <div className="truncate text-[12px] text-slate-400">
                        {plural(item.packageCount, "package")}
                        {item.trackingNumber && (item.displayStatus.key === "in_transit" || item.displayStatus.key === "shipped" || item.displayStatus.key === "completed" || item.displayStatus.key === "delivered") ? <> · <span className="font-mono">{item.trackingNumber}</span></> : null}
                      </div>
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-slate-700">{item.destination ? countryName(item.destination.countryCode) : "—"}</div>
                      <div className="truncate text-[12px] text-slate-400">{item.shippingMethod?.routeName}</div>
                    </div>
                    <div className="text-right text-slate-600">
                      <Weight grams={item.finalWeightGrams} />
                    </div>
                    <div className="text-right font-medium tabular-nums">{item.amountFen ? <Money fen={item.amountFen} /> : <span className="font-normal text-slate-400">Pending</span>}</div>
                    <StatusBadge label={item.displayStatus.label} tone={item.displayStatus.tone} statusKey={item.displayStatus.key} />
                    <ChevronRight size={16} className="text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-slate-500" aria-hidden="true" />
                  </div>
                  <div className="flex items-start gap-3 px-4 py-3 md:hidden">
                    {canPay ? <Checkbox className="relative z-10 mt-0.5" aria-label={`Select ${item.publicId} for payment`} checked={on} onCheckedChange={() => toggle(item.id)} /> : null}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <Link className="font-medium after:absolute after:inset-0" to={`/app/shipments/${item.id}`}>
                          {item.publicId}
                        </Link>
                        <StatusBadge label={item.displayStatus.label} tone={item.displayStatus.tone} statusKey={item.displayStatus.key} />
                      </div>
                      <div className="mt-0.5 text-[13px] text-slate-500">
                        {plural(item.packageCount, "package")} · {item.destination ? countryName(item.destination.countryCode) : "—"}
                        {item.trackingNumber && (item.displayStatus.key === "in_transit" || item.displayStatus.key === "shipped" || item.displayStatus.key === "completed" || item.displayStatus.key === "delivered") ? <span className="mt-0.5 block font-mono text-[12px]">{item.trackingNumber}</span> : null}
                      </div>
                      <div className="mt-1 text-[13px] font-medium">{item.amountFen ? <Money fen={item.amountFen} /> : <span className="font-normal text-slate-400">Freight pending</span>}</div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      {chosen.length ? (
        <div className="toast-in fixed inset-x-4 bottom-4 z-30 mx-auto flex max-w-xl items-center justify-between gap-3 rounded-2xl bg-ink px-4 py-3 text-white shadow-[0_16px_40px_-12px_rgba(16,24,40,0.5)] md:left-[calc(var(--sidebar-width)+2rem)] md:right-8">
          <div className="min-w-0">
            <div className="text-[13px] font-semibold">{plural(chosen.length, "shipment")} selected</div>
            <div className="text-[13px] text-slate-300">
              Total <Money fen={total} />
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Button variant="ghost" className="text-slate-300 hover:bg-white/10 hover:text-white" onClick={() => setSelected([])}>
              Clear
            </Button>
            <Button loading={checkout.isPending} onClick={() => checkout.mutate(chosen.map((item) => item.id))}>
              {checkout.isPending ? "Opening checkout…" : "Pay selected"}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const progress = [
  { label: "Packing", statuses: ["CONSOLIDATING", "WAITING_FOR_WEIGHT", "consolidating", "waiting_for_weight", "processing"] },
  { label: "Payment", statuses: ["TO_PAY", "to_pay", "payment_received"] },
  { label: "Ready to ship", statuses: ["READY_TO_SHIP", "ready_to_ship"] },
  { label: "In transit", statuses: ["SHIPPED", "IN_TRANSIT", "in_transit", "shipped"] },
  { label: "Delivered", statuses: ["DELIVERED", "completed", "delivered"] },
];

function ShipmentProgress({ status }: { status: string }) {
  const index = progress.findIndex((stage) => stage.statuses.includes(status));
  if (index < 0) return null;
  const doneAll = status === "DELIVERED" || status === "completed" || status === "delivered";
  return (
    <ol className="mb-5 grid grid-cols-5 gap-1.5" aria-label="Shipment progress">
      {progress.map((stage, i) => {
        const done = i < index || doneAll;
        const current = i === index && !doneAll;
        return (
          <li key={stage.label} aria-current={current ? "step" : undefined}>
            <div className={`h-1.5 rounded-full ${done ? "bg-indigo-500" : current ? "bg-[linear-gradient(90deg,#6366f1_50%,#e0e7ff_50%)]" : "bg-slate-200"}`} />
            <div className={`mt-2 flex items-center gap-1 text-[12px] ${current ? "font-semibold text-ink" : done ? "text-slate-600" : "text-slate-400"}`}>
              {done ? <Check size={12} strokeWidth={3} className="hidden text-indigo-500 sm:block" aria-hidden="true" /> : null}
              <span className="truncate">{stage.label}</span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

const nextStepCopy: Record<string, string> = {
  CONSOLIDATING: "The warehouse is packing your parcels. You'll get the final weight and freight when it's done.",
  WAITING_FOR_WEIGHT: "Packed. The warehouse is recording the final weight and size.",
  TO_PAY: "Final freight is ready. Pay to release the shipment to the carrier.",
  payment_received: "We received your payment. The warehouse releases the shipment after it is confirmed.",
  processing: "The warehouse is preparing this shipment.",
  READY_TO_SHIP: "Paid. The carrier picks it up on the next dispatch.",
  SHIPPED: "Handed to the carrier. Tracking updates appear below.",
  IN_TRANSIT: "On its way. Tracking updates appear below.",
  DELIVERED: "Delivered.",
};

export function ShipmentDetailPage() {
  const { id = "" } = useParams();
  const brand = useBrand();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [cancelOpen, setCancelOpen] = useState(false);
  const query = useQuery({ queryKey: ["shipment", id], queryFn: () => api<Shipment>(`/api/shipments/${id}`) });
  const cancel = useMutation({
    mutationFn: () => api<Shipment>(`/api/shipments/${id}/cancel`, { method: "POST" }),
    onSuccess: async () => {
      setCancelOpen(false);
      toast({ title: "Consolidation cancelled. The packages are ready to ship again.", tone: "success" });
      await queryClient.invalidateQueries({ queryKey: ["shipment", id] });
      await queryClient.invalidateQueries({ queryKey: ["shipments"] });
      await queryClient.invalidateQueries({ queryKey: ["packages"] });
    },
    onError: (reason) => {
      setCancelOpen(false);
      toast({ title: reason instanceof ApiError ? reason.message : "Could not cancel the consolidation.", tone: "danger" });
    },
  });
  const pay = useMutation({
    mutationFn: () => api<Checkout>("/api/checkout", { method: "POST", body: JSON.stringify({ shipmentIds: [id] }) }),
    onSuccess: (result) => navigate(`/app/checkout/${result.id}`),
    onError: (reason) => toast({ title: reason instanceof ApiError ? reason.message : "Could not start checkout.", tone: "danger" }),
  });
  const item = query.data;
  if (query.isLoading) return <LoadingBlock rows={4} />;
  if (!item)
    return <ErrorState message="This shipment could not be found." onRetry={() => void query.refetch()} action={<Button variant="ghost" size="sm" to="/app/shipments">Back to shipments</Button>} />;
  const due = item.charges.filter((charge) => charge.status === "DUE").reduce((sum, charge) => sum + charge.amountFen, 0);
  const toPay = item.status === "TO_PAY";

  return (
    <div>
      <PageHeader
        back={{ to: "/app/shipments", label: "Shipments" }}
        title={item.publicId}
        badge={<StatusBadge label={item.displayStatus.label} tone={item.displayStatus.tone} statusKey={item.displayStatus.key} />}
        subtitle={`Created ${formatDateTime(item.createdAt)} · ${plural(item.packageCount, "package")}`}
        action={
          toPay ? (
            <Button loading={pay.isPending} onClick={() => pay.mutate()}>
              <CreditCard size={15} aria-hidden="true" /> Pay <Money fen={due || item.amountFen} />
            </Button>
          ) : null
        }
      />
      {item.status === "CANCELLED" ? (
        <div className="mb-5">
          <Notice tone="info">This consolidation was cancelled. Its packages are back in your warehouse and can ship in a new consolidation.</Notice>
        </div>
      ) : (
        <>
          <ShipmentProgress status={item.displayStatus.key} />
          {nextStepCopy[item.displayStatus.key] ?? nextStepCopy[item.status] ? <p className="-mt-2 mb-5 text-[13px] text-slate-600">{item.displayStatus.key === "DELIVERED" || item.status === "DELIVERED" ? `Delivered. Thanks for shipping with ${brand.name}.` : nextStepCopy[item.displayStatus.key] ?? nextStepCopy[item.status]}</p> : null}
        </>
      )}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(280px,0.75fr)]">
        <div className="space-y-4">
          <Card>
            <SectionHeading icon={Clock} title="Timeline" />
            <TimelineList events={item.timeline ?? []} />
          </Card>
          <Card>
            <SectionHeading icon={Package} title="Included packages" action={<span className="text-[12px] text-slate-400">{plural(item.packages.length, "package")}</span>} />
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
                  <Button variant="ghost" size="sm" to={`/app/packages/${pkg.id}`}>
                    Details <ChevronRight size={13} aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          </Card>
          <div className="grid gap-4 md:grid-cols-2">
            {item.destination ? (
              <Card>
                <SectionHeading icon={MapPin} title="Destination" tone="sky" />
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
                <SectionHeading icon={Truck} title="Shipping method" tone="indigo" />
                <p className="mt-3 text-[13px] font-medium">{item.shippingMethod.routeName}</p>
                <p className="mt-0.5 text-[13px] text-slate-500">
                  {item.shippingMethod.estimatedDaysMin}–{item.shippingMethod.estimatedDaysMax} business days
                </p>
                <p className="mt-3 text-[13px] text-slate-600">
                  {item.status === "TO_PAY" ? "Packed freight " : "Estimated freight "}
                  <span className="font-medium text-ink">
                    {item.status === "TO_PAY" && item.charges.some((charge) => charge.type === "FREIGHT" && charge.status === "DUE")
                      ? <Money fen={item.charges.find((charge) => charge.type === "FREIGHT" && charge.status === "DUE")!.amountFen} />
                      : <MoneyRange min={item.shippingMethod.estimatedMinFen} max={item.shippingMethod.estimatedMaxFen} />}
                  </span>
                </p>
              </Card>
            ) : null}
          </div>
          <Card>
            <SectionHeading icon={Ruler} title="Final warehouse measurement" />
            {item.finalWeightGrams == null ? (
              <p className="mt-3 text-[13px] text-slate-500">Available after the warehouse finishes packing.</p>
            ) : (
              <dl className="mt-4 grid gap-2 sm:grid-cols-3">
                <div className="rounded-lg bg-slate-50 px-3 py-2.5"><dt className="text-[12px] text-slate-500">Final weight</dt><dd className="mt-0.5 text-[15px] font-semibold tracking-tight"><Weight grams={item.finalWeightGrams} /></dd></div>
                <div className="rounded-lg bg-slate-50 px-3 py-2.5"><dt className="text-[12px] text-slate-500">Volumetric weight</dt><dd className="mt-0.5 text-[15px] font-semibold tracking-tight"><Weight grams={item.finalVolumetricWeightGrams} /></dd></div>
                <div className="rounded-lg bg-slate-50 px-3 py-2.5"><dt className="text-[12px] text-slate-500">Size (L × W × H)</dt><dd className="mt-0.5 text-[15px] font-semibold tracking-tight"><Dimensions length={item.finalLengthMm} width={item.finalWidthMm} height={item.finalHeightMm} /></dd></div>
              </dl>
            )}
          </Card>
          {item.cartons.length ? (
            <Card>
              <SectionHeading icon={Boxes} title="Outbound cartons" action={<span className="text-[12px] text-slate-400">{plural(item.cartons.length, "carton")}</span>} />
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
            <SectionHeading icon={ImageIcon} title="Packing photos and video" tone="amber" />
            <div className="mt-4">
              <PhotoGallery photos={item.photos} />
            </div>
          </Card>
        </div>
        <div className="space-y-4 lg:sticky lg:top-2">
          <section className={`overflow-hidden rounded-xl border ${toPay ? "border-amber-200 bg-amber-50/60" : "border-slate-200/80 bg-white"}`}>
            <div className="px-4 pt-3.5 pb-1 text-[13px] font-semibold">Charges</div>
            {item.charges.length ? (
              <dl className="px-4">
                {item.charges.map((charge) => (
                  <div key={charge.id} className="flex items-center justify-between gap-3 py-1.5 text-[13px]">
                    <dt className="text-slate-600">{charge.name}</dt>
                    <dd className="font-medium tabular-nums">
                      <Money fen={charge.amountFen} />
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="px-4 pb-3 text-[13px] text-slate-500">Charges appear after the warehouse packs and weighs the shipment.</p>
            )}
            {toPay ? (
              <div className="mt-2 border-t border-amber-200/80 px-4 py-3">
                <div className="flex items-baseline justify-between">
                  <span className="text-[13px] text-amber-900">Total due</span>
                  <span className="text-2xl font-semibold tracking-tight"><Money fen={due} /></span>
                </div>
                <Button className="mt-3 w-full" loading={pay.isPending} onClick={() => pay.mutate()}>
                  Pay now
                </Button>
              </div>
            ) : (
              <div className="h-2" />
            )}
          </section>
          <ShipmentDocuments shipmentId={item.id} />
          <CarrierTracking shipmentId={item.id} />
          {item.packingInstruction ? (
            <Card>
              <SectionHeading icon={PackageCheck} title="Packing instructions" />
              <p className="mt-3 text-[13px] text-slate-700">
                {item.packingInstruction}
                {item.packingNote ? <span className="mt-1 block text-slate-500">“{item.packingNote}”</span> : null}
              </p>
            </Card>
          ) : null}
          {item.canCancel ? (
            <div className="rounded-xl border border-slate-200/80 bg-white px-4 py-3">
              <p className="text-[13px] text-slate-500">Changed your mind? You can cancel until the warehouse starts packing.</p>
              <Button className="mt-2 -ml-2.5 text-red-700 hover:bg-red-50 hover:text-red-800" variant="ghost" onClick={() => setCancelOpen(true)}>
                Cancel consolidation
              </Button>
            </div>
          ) : item.status !== "CANCELLED" && item.status !== "DELIVERED" ? (
            <p className="px-1 text-[12px] leading-5 text-slate-400">Warehouse processing has started, so this shipment can't be cancelled here. Contact support with {item.publicId} if you need help.</p>
          ) : null}
        </div>
      </div>
      <ConfirmDialog
        open={cancelOpen}
        title="Cancel this consolidation?"
        body="The packages go back to Ready and can be used in another shipment. Nothing has been charged."
        confirmLabel="Cancel consolidation"
        confirmPhrase={item.publicId}
        danger
        pending={cancel.isPending}
        onClose={() => setCancelOpen(false)}
        onConfirm={() => cancel.mutate()}
      />
    </div>
  );
}
