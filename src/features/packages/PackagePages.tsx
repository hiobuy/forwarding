import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Boxes, ChevronDown, ChevronRight, ClipboardPaste, Clock, ImageIcon, Ruler, Tag, Package as PackageIcon, PackageCheck, Plus, SearchX, Trash2, Truck, Warehouse, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { PACKAGE_FILTERS } from "../../domain/status";
import { formatDateTime } from "../../domain/dates";
import { TimelineList } from "../../components/timeline";
import { useI18n } from "../../lib/i18n";
import { MAX_PREALERT_BATCH, normalizeTrackingInput } from "../../domain/tracking";
import {
  Button,
  Card,
  CargoBadge,
  FilterBar,
  ConfirmDialog,
  CopyButton,
  DataRow,
  Dimensions,
  EmptyState,
  ErrorState,
  Field,
  LoadingBlock,
  Money,
  Notice,
  PageHeader,
  Pagination,
  PhotoGallery,
  SectionHeading,
  SearchInput,
  StatusBadge,
  plural,
  Weight,
  inputClass,
} from "../../components/ui";
import { Checkbox } from "../../components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { Textarea } from "../../components/ui/textarea";
import { useToast } from "../../components/toast";
import { ApiError, api } from "../../lib/api";
import type { PackageItem, Page } from "../../types/api";

export function PackagesPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const status = params.get("status") ?? "all";
  const q = params.get("q") ?? "";
  const page = Number(params.get("page") ?? 1);
  const query = useQuery({
    queryKey: ["packages", status, q, page],
    queryFn: () => api<Page<PackageItem>>(`/api/packages?status=${status}&q=${encodeURIComponent(q)}&page=${page}`),
    placeholderData: keepPreviousData,
  });
  const filtered = status !== "all" || q !== "";
  const statusLabel = PACKAGE_FILTERS.find((item) => item.key === status)?.label ?? "this view";
  const grid = "grid-cols-[minmax(160px,1.4fr)_minmax(90px,0.7fr)_4.5rem_minmax(100px,0.8fr)_3rem_minmax(148px,0.9fr)_minmax(140px,1fr)_1.25rem]";

  return (
    <div>
      <PageHeader
        title="Packages"
        subtitle="Parcels linked to your member code, including ones still on the way to the warehouse."
        action={
          <Button to="/app/packages/pre-alert">
            <Plus size={15} aria-hidden="true" /> Add Package
          </Button>
        }
      />
      <FilterBar value={status} options={PACKAGE_FILTERS} onChange={(key) => setParams(q ? { status: key, q } : { status: key })} />
      <SearchInput
        defaultValue={q}
        placeholder="Search package ID or tracking number"
        label="Search packages"
        onSearch={(next) => setParams(next ? { status, q: next } : { status })}
      />
      {query.isLoading ? <LoadingBlock label="Loading packages" rows={5} /> : null}
      {query.error ? <ErrorState message="Could not load packages." onRetry={() => void query.refetch()} /> : null}
      {query.data && query.data.items.length === 0 ? (
        filtered ? (
          <EmptyState
            icon={SearchX}
            title={q ? `No packages match “${q}”` : `Nothing in ${statusLabel}`}
            body={q ? "Check the number, or search across all statuses." : "Packages move here automatically as the warehouse handles them."}
            action={<Button variant="secondary" onClick={() => setParams({})}>Show all packages</Button>}
          />
        ) : (
          <EmptyState
            icon={PackageIcon}
            title="No packages yet"
            body="Ship your purchases to the China warehouse, then add the domestic tracking numbers here."
            action={
              <>
                <Button to="/app/packages/pre-alert">Add Package</Button>
                <Button variant="secondary" to="/app/warehouse">Warehouse address</Button>
              </>
            }
          />
        )
      ) : null}
      {query.data && query.data.items.length > 0 ? (
        <>
          <div className={`overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(16,24,40,0.03)] transition-opacity ${query.isPlaceholderData ? "opacity-60" : ""}`}>
            <div className={`hidden ${grid} items-center gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-2 text-[12px] font-medium text-slate-500 md:grid`}>
              <span>Package</span>
              <span>Cargo</span>
              <span className="text-right">Weight</span>
              <span>Dimensions</span>
              <span className="text-right">Photos</span>
              <span>Time</span>
              <span>Status</span>
              <span aria-hidden="true" />
            </div>
            <ul>
              {query.data.items.map((item) => (
                <li key={item.id} className="border-b border-slate-100 last:border-b-0">
                  <Link
                    to={`/app/packages/${item.id}`}
                    className={`group hidden ${grid} items-center gap-3 px-4 py-2.5 text-[13px] transition-colors hover:bg-slate-50 focus-visible:bg-indigo-50/50 focus-visible:outline-none md:grid`}
                  >
                    <div className="min-w-0">
                      <div className="font-medium tracking-tight text-ink">{item.publicId}</div>
                      <div className="truncate text-[12px] text-slate-400">
                        <span className="font-mono">{item.domesticTrackingNumber}</span> · {item.courier}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {item.cargoAttributes.map((attribute) => (
                        <CargoBadge key={attribute} attribute={attribute} />
                      ))}
                    </div>
                    <div className="text-right text-slate-700">
                      <Weight grams={item.weightGrams} />
                    </div>
                    <div className="text-slate-500">
                      <Dimensions length={item.lengthMm} width={item.widthMm} height={item.heightMm} />
                    </div>
                    <div className="text-right text-slate-500 tabular-nums">{item.photoCount || "—"}</div>
                    <PackageTime item={item} />
                    <StatusBadge label={item.displayStatus.label} tone={item.displayStatus.tone} statusKey={item.displayStatus.key} />
                    <ChevronRight size={16} className="text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-slate-500" aria-hidden="true" />
                  </Link>
                  <Link to={`/app/packages/${item.id}`} className="block px-4 py-3 active:bg-slate-50 md:hidden">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium">{item.publicId}</div>
                        <div className="mt-0.5 truncate font-mono text-[12px] text-slate-400">{item.domesticTrackingNumber}</div>
                      </div>
                      <StatusBadge label={item.displayStatus.label} tone={item.displayStatus.tone} statusKey={item.displayStatus.key} />
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-slate-500">
                      {item.cargoAttributes.map((attribute) => (
                        <CargoBadge key={attribute} attribute={attribute} />
                      ))}
                      {item.weightGrams != null ? (
                        <span>
                          <Weight grams={item.weightGrams} /> · <Dimensions length={item.lengthMm} width={item.widthMm} height={item.heightMm} />
                        </span>
                      ) : (
                        <span>Not measured yet</span>
                      )}
                      {item.photoCount ? <span>· {plural(item.photoCount, "photo")}</span> : null}
                      <PackageTime item={item} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <Pagination
            page={query.data.page}
            pageSize={query.data.pageSize}
            total={query.data.total}
            onChange={(next) => {
              const nextParams: Record<string, string> = { status, page: String(next) };
              if (q) nextParams.q = q;
              setParams(nextParams);
            }}
          />
        </>
      ) : null}
      {status === "ready" && query.data && query.data.items.length > 1 ? (
        <div className="mt-4">
          <Notice tone="info" action={<Button size="sm" onClick={() => navigate("/app/consolidate")}>Consolidate</Button>}>
            {plural(query.data.total, "package")} ready. Combine them into one international shipment to save on freight.
          </Notice>
        </div>
      ) : null}
    </div>
  );
}

const COURIERS = ["SF", "YTO", "ZTO", "STO", "Yunda", "JD", "EMS", "China Post", "Other"];

type PrealertRow = {
  trackingNumber: string;
  courier: string;
  included: boolean;
};

function guessCourier(tracking: string) {
  const value = tracking.toUpperCase();
  if (value.startsWith("SF")) return "SF";
  if (value.startsWith("YT")) return "YTO";
  if (value.startsWith("ZT")) return "ZTO";
  if (value.startsWith("STO")) return "STO";
  if (value.startsWith("YD") || value.startsWith("YUNDA")) return "Yunda";
  if (value.startsWith("JD")) return "JD";
  if (value.startsWith("EMS")) return "EMS";
  return "SF";
}

export function PrealertPage() {
  const { t, currency } = useI18n();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [raw, setRaw] = useState("");
  const [rows, setRows] = useState<PrealertRow[]>([]);
  const [showDetails, setShowDetails] = useState(false);
  const [productName, setProductName] = useState("");
  const [quantity, setQuantity] = useState("");
  const [value, setValue] = useState("");
  const [platform, setPlatform] = useState("none");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const parsed = normalizeTrackingInput(raw, MAX_PREALERT_BATCH);
  const included = rows.filter((row) => row.included);

  const mutation = useMutation({
    mutationFn: (items: Record<string, unknown>[]) =>
      api<{ created: PackageItem[]; skipped: { trackingNumber: string; message: string }[] }>("/api/packages/prealert", {
        method: "POST",
        body: JSON.stringify({ items }),
      }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["packages"] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      const skipped = result.skipped.length ? ` ${result.skipped.length} already added.` : "";
      toast({ title: `${result.created.length === 1 ? "Package added." : `${result.created.length} packages added.`}${skipped}`, tone: "success" });
      if (result.created.length === 1 && result.skipped.length === 0) navigate(`/app/packages/${result.created[0]!.id}`);
      else navigate("/app/packages?status=pending");
    },
    onError: (reason) => setError(reason instanceof ApiError ? reason.message : "Could not add the package."),
  });

  function applyRaw(nextRaw: string) {
    setRaw(nextRaw);
    const next = normalizeTrackingInput(nextRaw, MAX_PREALERT_BATCH);
    setRows((current) =>
      next.numbers.map((trackingNumber) => {
        const existing = current.find((row) => row.trackingNumber === trackingNumber);
        if (existing) return existing;
        return { trackingNumber, courier: guessCourier(trackingNumber), included: true };
      }),
    );
  }

  function submit() {
    setError("");
    if (parsed.overflow) {
      setError(`You can add up to ${MAX_PREALERT_BATCH} packages at once.`);
      return;
    }
    if (included.length === 0) {
      setError("Enter at least one tracking number.");
      return;
    }
    const declared = value.trim() ? yuanToFen(value) : undefined;
    mutation.mutate(
      included.map((row) => ({
        courier: row.courier,
        trackingNumber: row.trackingNumber,
        productName: productName.trim() || undefined,
        quantity: quantity ? Number(quantity) : undefined,
        declaredValueFen: declared,
        platform: platform === "none" ? undefined : platform,
        notes: notes.trim() || undefined,
      })),
    );
  }

  return (
    <div>
      <PageHeader back={{ to: "/app/packages", label: "Packages" }} title="Package Pre-alert" subtitle="Tell us which domestic parcels are on the way. A tracking number is enough." />
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.7fr)]">
      <Card>
        <div>
          <Field label="Tracking numbers" hint="One number per line. Blank lines and duplicates are ignored.">
            <Textarea
              rows={8}
              value={raw}
              onChange={(event) => applyRaw(event.target.value)}
              placeholder={"YT908231002\nSF982319201\nZT1234567890"}
              aria-label="Tracking numbers"
              className="font-mono"
            />
          </Field>
        </div>
        {parsed.invalid.length ? (
          <div className="mt-3">
            <Notice tone="danger">
              {parsed.invalid.length === 1 ? "This line doesn't look like a tracking number" : "These lines don't look like tracking numbers"}: <span className="font-mono">{parsed.invalid.join(", ")}</span>
            </Notice>
          </div>
        ) : null}
        {parsed.overflow ? (
          <div className="mt-3">
            <Notice tone="danger">You can add up to {MAX_PREALERT_BATCH} packages at once. Split the rest into another batch.</Notice>
          </div>
        ) : null}
        {rows.length ? (
          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between text-[13px]">
              <span className="font-medium text-slate-700">
                {included.length} of {plural(rows.length, "number")} selected
              </span>
              {rows.length > 1 ? (
                <button
                  type="button"
                  className="font-medium text-brand hover:text-brand-dark"
                  onClick={() => {
                    const all = included.length === rows.length;
                    setRows((current) => current.map((row) => ({ ...row, included: !all })));
                  }}
                >
                  {included.length === rows.length ? "Clear all" : "Select all"}
                </button>
              ) : null}
            </div>
            <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
              {rows.map((row) => (
                <div key={row.trackingNumber} className={`flex flex-wrap items-center gap-3 px-3 py-2 transition-colors ${row.included ? "bg-white" : "bg-slate-50 text-slate-400"}`}>
                  <Checkbox
                    checked={row.included}
                    onCheckedChange={(checked) =>
                      setRows((current) => current.map((item) => (item.trackingNumber === row.trackingNumber ? { ...item, included: checked === true } : item)))
                    }
                    aria-label={`Include ${row.trackingNumber}`}
                  />
                  <span className="min-w-0 flex-1 font-mono text-sm font-medium">{row.trackingNumber}</span>
                  <div className="w-36">
                    <CourierSelect
                      value={row.courier}
                      onChange={(courier) =>
                        setRows((current) =>
                          current.map((item) => (item.trackingNumber === row.trackingNumber ? { ...item, courier } : item)),
                        )
                      }
                    />
                  </div>
                  <button
                    type="button"
                    className="grid size-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                    aria-label={`Remove ${row.trackingNumber}`}
                    onClick={() => {
                      const nextRaw = raw
                        .split(/\r?\n/)
                        .filter((line) => line.trim().toUpperCase() !== row.trackingNumber)
                        .join("\n");
                      applyRaw(nextRaw);
                    }}
                  >
                    <X size={15} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        <button
          type="button"
          className="mt-5 inline-flex items-center gap-1 text-[13px] font-medium text-brand hover:text-brand-dark"
          aria-expanded={showDetails}
          onClick={() => setShowDetails((value) => !value)}
        >
          <ChevronDown size={15} className={`transition-transform ${showDetails ? "rotate-180" : ""}`} aria-hidden="true" />
          {showDetails ? "Hide product details" : "Add product details (optional)"}
        </button>
        {showDetails ? (
          <div className="mt-4 grid gap-4 border-t border-slate-100 pt-4 sm:grid-cols-2">
            <p className="sm:col-span-2 text-sm text-slate-500">These details are copied onto every selected tracking number.</p>
            <Field label="Product name">
              <input className={inputClass} value={productName} onChange={(event) => setProductName(event.target.value)} />
            </Field>
            <Field label="Seller / platform">
              <Select value={platform} onValueChange={setPlatform}>
                <SelectTrigger aria-label="Seller platform">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not specified</SelectItem>
                  {["1688", "Taobao", "JD", "Pinduoduo", "Other"].map((item) => (
                    <SelectItem key={item} value={item}>{item}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Quantity">
              <input className={inputClass} value={quantity} onChange={(event) => setQuantity(event.target.value)} inputMode="numeric" />
            </Field>
            <Field label={t("Declared value ({currency})", { currency })}>
              <input className={inputClass} value={value} onChange={(event) => setValue(event.target.value)} inputMode="decimal" />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Notes">
                <Textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} />
              </Field>
            </div>
          </div>
        ) : null}
        {error ? <div className="mt-4"><Notice tone="danger">{error}</Notice></div> : null}
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-5">
          <p className="max-w-md text-[13px] leading-5 text-slate-500">Nothing is charged now. These numbers show as in transit until the warehouse receives them.</p>
          <Button loading={mutation.isPending} disabled={included.length === 0 || parsed.overflow} onClick={submit}>
            {mutation.isPending ? "Adding…" : included.length === 1 ? "Add Package" : included.length ? `Add ${included.length} packages` : "Add Package"}
          </Button>
        </div>
      </Card>
      <aside className="space-y-4 lg:sticky lg:top-2">
        <Card className="bg-gradient-to-b from-indigo-50/80 to-white">
          <h2 className="text-[15px] font-semibold tracking-tight">What happens next</h2>
          <ol className="mt-4 space-y-0">
            {nextSteps.map((step, index) => (
              <li key={step.title} className="relative flex gap-3 pb-5 last:pb-0">
                {index < nextSteps.length - 1 ? <span className="absolute top-8 left-4 h-[calc(100%-1.25rem)] w-px bg-indigo-100" /> : null}
                <span className={`relative grid size-8 shrink-0 place-items-center rounded-lg ${step.chip}`}>
                  <step.icon size={16} />
                </span>
                <div>
                  <div className="text-sm font-medium">{step.title}</div>
                  <p className="mt-1 text-sm leading-5 text-slate-500">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </Card>
        <Card>
          <h2 className="text-[15px] font-semibold tracking-tight">Before you buy</h2>
          <p className="mt-2 text-sm leading-5 text-slate-500">Put your member code in the recipient name on the seller’s shipping form. That is how the warehouse matches the parcel to you.</p>
          <Button className="mt-4" variant="secondary" to="/app/warehouse">View warehouse address</Button>
        </Card>
      </aside>
      </div>
    </div>
  );
}

const nextSteps = [
  {
    title: "We save the tracking numbers",
    body: "They show under Packages as Pending. A forecast is not the same as the warehouse receiving the parcel.",
    icon: ClipboardPaste,
    chip: "bg-indigo-50 text-indigo-600",
  },
  {
    title: "The seller ships to China",
    body: "Use the same domestic tracking number you pasted here. No freight is due at this step.",
    icon: Truck,
    chip: "bg-sky-50 text-sky-700",
  },
  {
    title: "The warehouse receives it",
    body: "Weight, size, and photos show up on the package. An exception is shown separately from the warehouse status.",
    icon: Warehouse,
    chip: "bg-amber-50 text-amber-700",
  },
  {
    title: "Then you can ship it abroad",
    body: "Once it is Received and has no exception, select it in Consolidate & Ship with other compatible parcels.",
    icon: PackageCheck,
    chip: "bg-emerald-50 text-emerald-700",
  },
];

function CourierSelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label="Courier">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {COURIERS.map((courier) => (
          <SelectItem key={courier} value={courier}>{courier}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function PackageDetailPage() {
  const { id = "" } = useParams();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = useState<null | "RETURN" | "DISPOSAL">(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const navigate = useNavigate();
  const query = useQuery({ queryKey: ["package", id], queryFn: () => api<PackageItem>(`/api/packages/${id}`) });
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["package", id] });
    await queryClient.invalidateQueries({ queryKey: ["packages"] });
    await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  };
  const exception = useMutation({
    mutationFn: (action: string) => api(`/api/packages/${id}/exceptions`, { method: "POST", body: JSON.stringify({ action }) }),
    onSuccess: async () => {
      setConfirm(null);
      toast({ title: "Response sent to the warehouse.", tone: "success" });
      await refresh();
    },
    onError: (reason) => toast({ title: reason instanceof ApiError ? reason.message : "Could not update the exception.", tone: "danger" }),
  });
  const remove = useMutation({
    mutationFn: () => api<{ publicId: string }>(`/api/packages/${id}`, { method: "DELETE" }),
    onSuccess: async (result) => {
      setConfirmDelete(false);
      queryClient.removeQueries({ queryKey: ["package", id] });
      await queryClient.invalidateQueries({ queryKey: ["packages"] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      toast({ title: `${result.publicId} was cancelled and deleted.`, tone: "success" });
      navigate("/app/packages");
    },
    onError: (reason) => {
      setConfirmDelete(false);
      toast({ title: reason instanceof ApiError ? reason.message : "Could not delete the package.", tone: "danger" });
      void refresh();
    },
  });
  const item = query.data;
  if (query.isLoading) return <LoadingBlock label="Loading package" rows={4} />;
  if (!item)
    return (
      <ErrorState
        message={query.error instanceof ApiError ? query.error.message : "This package could not be found."}
        onRetry={() => void query.refetch()}
        action={<Button variant="ghost" size="sm" to="/app/packages">Back to packages</Button>}
      />
    );
  const measured = item.weightGrams != null;

  return (
    <div>
      <PageHeader
        back={{ to: "/app/packages", label: "Packages" }}
        title="Package Details"
        badge={<StatusBadge label={item.displayStatus.label} tone={item.displayStatus.tone} statusKey={item.displayStatus.key} />}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-x-1.5">
            <span className="font-medium text-slate-700">{item.publicId}</span>
            <span>·</span>
            <span className="font-mono">{item.domesticTrackingNumber}</span>
            <CopyButton value={item.domesticTrackingNumber} label="Copy tracking number" variant="ghost" size="sm" iconOnly />
            <span>· {item.courier}</span>
            {item.receivedAt ? <span>· Received {formatDateTime(item.receivedAt)}</span> : <span>· Not received yet</span>}
          </span>
        }
        action={
          item.eligible ? (
            <Button to={`/app/consolidate?packages=${item.id}`}>
              <Boxes size={15} aria-hidden="true" /> Add to consolidation
            </Button>
          ) : item.packageStatus === "PENDING" ? (
            <Button variant="secondary" onClick={() => setConfirmDelete(true)}>
              <Trash2 size={15} aria-hidden="true" /> Cancel and delete
            </Button>
          ) : null
        }
      />
      <div className="space-y-4">
        {item.exception ? (
          <section className="rounded-xl border border-red-200 bg-white p-4 shadow-[0_0_0_4px_rgba(254,226,226,0.6)] sm:p-5" id="exception">
            <div className="flex items-start gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-red-50 text-red-600">
                <AlertTriangle size={18} aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-[15px] font-semibold tracking-tight">{item.exception.type}</h2>
                <p className="mt-1 text-[13px] leading-5 text-slate-600">{item.exception.description}</p>
                {item.exception.message ? <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-[13px] leading-5 text-slate-700">{item.exception.message}</p> : null}
                <p className="mt-3 text-[13px] font-medium text-slate-800">How should the warehouse handle it?</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {item.exception.actions.map((action, index) => (
                    <Button
                      key={action.code}
                      variant={action.code === "DISPOSAL" ? "danger" : index === 0 ? "primary" : "secondary"}
                      loading={exception.isPending && exception.variables === action.code}
                      disabled={exception.isPending}
                      onClick={() => {
                        if (action.code === "RETURN" || action.code === "DISPOSAL") setConfirm(action.code);
                        else if (action.code === "SUPPORT") {
                          window.location.href = `mailto:support@hiobuy.com?subject=${encodeURIComponent(item.publicId)}&body=${encodeURIComponent(`${item.publicId}\n${item.domesticTrackingNumber}`)}`;
                        } else exception.mutate(action.code);
                      }}
                    >
                      {action.label}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          </section>
        ) : !item.eligible && item.ineligibleReason ? (
          <Notice tone="info">{item.ineligibleReason}</Notice>
        ) : null}
        {item.storageWarning ? (
          <Notice tone="warning">
            {item.freeStorageRemainingDays != null && item.freeStorageRemainingDays > 0
              ? `Free storage ends in ${plural(item.freeStorageRemainingDays, "day")}. Ship it soon to avoid storage fees.`
              : "Free storage has ended. Storage fees are added to the shipment bill."}
          </Notice>
        ) : null}
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(280px,0.8fr)]">
          <div className="space-y-4">
            <Card>
              <SectionHeading icon={Clock} title="Timeline" />
              <TimelineList events={item.timeline?.length ? item.timeline : [{ at: item.receivedAt ?? item.createdAt, title: item.receivedAt ? "Received at the warehouse" : "Package added", detail: item.receivedAt ? "The parcel is in the warehouse." : "In transit to the warehouse." }]} />
            </Card>
            <Card>
              <SectionHeading icon={Ruler} title="Warehouse measurement" />
              {measured ? (
                <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Stat label="Actual weight" value={<Weight grams={item.weightGrams} />} />
                  <Stat label="Volumetric" value={<Weight grams={item.volumetricWeightGrams} />} />
                  <Stat label="Size (L × W × H)" value={<Dimensions length={item.lengthMm} width={item.widthMm} height={item.heightMm} />} wide />
                </dl>
              ) : (
                <p className="mt-3 text-[13px] text-slate-500">Weight and size appear after the warehouse receives the parcel.</p>
              )}
              <div className="mt-4 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-3">
                <span className="mr-1 text-[13px] text-slate-500">Cargo</span>
                {item.cargoAttributes.map((attribute) => (
                  <CargoBadge key={attribute} attribute={attribute} />
                ))}
              </div>
            </Card>
            <Card>
              <SectionHeading icon={ImageIcon} title="Warehouse photos" action={item.photos.length ? <span className="text-[12px] text-slate-400">{plural(item.photos.length, "photo")}</span> : null} />
              <div className="mt-4">
                <PhotoGallery photos={item.photos} />
              </div>
            </Card>
            <Card>
              <SectionHeading icon={Tag} title="Product" />
              <dl className="mt-3 divide-y divide-slate-100">
                <DataRow label="Name" value={item.productName ?? "—"} />
                <DataRow label="Quantity" value={item.quantity ?? "—"} />
                <DataRow label="Declared value" value={item.declaredValueFen == null ? "—" : <Money fen={item.declaredValueFen} />} />
              </dl>
            </Card>
          </div>
          <div className="space-y-4 lg:sticky lg:top-2">
            <Card>
              <SectionHeading icon={Clock} title="Storage" tone={item.storageWarning ? "amber" : "slate"} />
              <p className={`mt-3 text-[13px] ${item.storageWarning ? "font-medium text-amber-800" : "text-slate-600"}`}>
                {item.freeStorageRemainingDays == null
                  ? "Free storage starts when the warehouse receives the parcel."
                  : item.freeStorageRemainingDays > 0
                    ? `${plural(item.freeStorageRemainingDays, "day")} of free storage left`
                    : "Free storage has ended."}
              </p>
              {item.storageFeeFen > 0 ? (
                <p className="mt-1 text-[13px] text-slate-600">
                  Storage fee so far <span className="font-medium text-ink"><Money fen={item.storageFeeFen} /></span>
                </p>
              ) : null}
            </Card>
          </div>
        </div>
      </div>
      <ConfirmDialog
        open={confirm != null}
        title={confirm === "DISPOSAL" ? "Dispose of this parcel?" : "Return this parcel to the seller?"}
        body={confirm === "DISPOSAL" ? "The warehouse will destroy the parcel. This cannot be undone." : "The warehouse will prepare this parcel for a domestic return. You can add return details later."}
        confirmLabel={confirm === "DISPOSAL" ? "Dispose of parcel" : "Request return"}
        danger={confirm === "DISPOSAL"}
        pending={exception.isPending}
        onClose={() => setConfirm(null)}
        onConfirm={() => confirm && exception.mutate(confirm)}
      />
      <ConfirmDialog
        open={confirmDelete}
        title={`Delete ${item.publicId}?`}
        body="The pre-alert is withdrawn and the warehouse will stop expecting this parcel. If it arrives later, it is held as unclaimed until you claim it. This cannot be undone."
        confirmLabel="Cancel and delete"
        danger
        pending={remove.isPending}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => remove.mutate()}
      />
    </div>
  );
}

function PackageTime({ item }: { item: PackageItem }) {
  const latest = item.timeline?.[0];
  const at = latest?.at ?? item.receivedAt ?? item.createdAt;
  const label = latest?.title ?? (item.receivedAt ? "Received at the warehouse" : "Package added");
  return (
    <span className="min-w-0">
      <span className="block truncate text-[13px] text-slate-700">{formatDateTime(at)}</span>
      <span className="block truncate text-[12px] text-slate-400">{label}</span>
    </span>
  );
}


function Stat({ label, value, wide = false }: { label: string; value: ReactNode; wide?: boolean }) {
  return (
    <div className={`rounded-lg bg-slate-50 px-3 py-2.5 ${wide ? "col-span-2" : ""}`}>
      <dt className="text-[12px] text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-[15px] font-semibold tracking-tight text-ink">{value}</dd>
    </div>
  );
}

function yuanToFen(value: string): number {
  const [whole = "0", frac = ""] = value.trim().split(".");
  return Number(whole) * 100 + Number((frac + "00").slice(0, 2));
}
