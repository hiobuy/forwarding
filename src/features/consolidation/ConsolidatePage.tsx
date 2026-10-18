import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, ChevronRight, CircleHelp, Gauge, MapPin, PackageOpen, Plus, Truck, X } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { cargoLabel, type CargoAttribute } from "../../domain/status";
import { formatKg } from "../../domain/units";
import { Button, Card, CargoBadge, ChoiceCard, EmptyState, ErrorState, LoadingBlock, MoneyRange, Notice, PageHeader, StatusBadge, plural } from "../../components/ui";
import { Checkbox } from "../../components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "../../components/ui/radio-group";
import { Textarea } from "../../components/ui/textarea";
import { useToast } from "../../components/toast";
import { ApiError, api, idempotencyKey } from "../../lib/api";
import { countryName } from "../../domain/countries";
import { cn } from "../../lib/utils";
import type { Address, PackageItem, Page, QuoteResult, Shipment } from "../../types/api";

const steps = ["Packages", "Address", "Shipping method", "Review"] as const;
const packingOptions = [
  { value: "Remove unnecessary seller packaging", hint: "Smaller box, lower volumetric weight." },
  { value: "Keep original seller packaging", hint: "For gifts or resale." },
  { value: "Reinforce carton", hint: "Extra protection for fragile items." },
  { value: "Other instructions", hint: "Write your own note." },
];

export function ConsolidatePage() {
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const packages = useQuery({ queryKey: ["packages", "all", "", 1], queryFn: () => api<Page<PackageItem>>("/api/packages?status=all&pageSize=50") });
  const addresses = useQuery({ queryKey: ["addresses"], queryFn: () => api<Address[]>("/api/addresses") });
  const [step, setStep] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [addressId, setAddressId] = useState<string | null>(null);
  const [quote, setQuote] = useState<QuoteResult | null>(null);
  const [quotedFor, setQuotedFor] = useState("");
  const [routeCode, setRouteCode] = useState<string | null>(null);
  const [packing, setPacking] = useState(packingOptions[0]!.value);
  const [note, setNote] = useState("");
  const [showBlocked, setShowBlocked] = useState(false);
  const [error, setError] = useState("");
  const [prefilled, setPrefilled] = useState(false);

  const items = packages.data?.items ?? [];
  const chosenAddress = addresses.data?.find((item) => item.id === (addressId ?? addresses.data.find((row) => row.isDefault)?.id)) ?? null;
  const activeAddressId = chosenAddress?.id ?? null;
  const chosen = items.filter((item) => selected.includes(item.id));
  const weight = chosen.reduce((sum, item) => sum + (item.weightGrams ?? 0), 0);
  const eligible = items.filter((item) => item.eligible);
  const blocked = items.filter((item) => !item.eligible && !["shipped", "delivered", "discarded", "archived"].includes(item.displayStatus.key));
  const allSelected = eligible.length > 0 && eligible.every((item) => selected.includes(item.id));
  const cargoMix = useMemo(() => {
    const set = new Set<CargoAttribute>();
    chosen.forEach((item) => item.cargoAttributes.forEach((attribute) => set.add(attribute)));
    return [...set];
  }, [chosen]);
  const specialCargo = cargoMix.filter((attribute) => attribute !== "GENERAL");
  const quoteKey = `${[...selected].sort().join(",")}|${activeAddressId}`;

  // Arriving from a package page with ?packages=id: preselect it.
  useEffect(() => {
    if (prefilled || !packages.data) return;
    const wanted = (params.get("packages") ?? "").split(",").filter(Boolean);
    const ok = wanted.filter((id) => eligible.some((item) => item.id === id));
    if (ok.length) setSelected(ok);
    setPrefilled(true);
  }, [packages.data, params, prefilled, eligible]);

  function resetQuote() {
    setQuote(null);
    setRouteCode(null);
  }

  function toggle(id: string) {
    setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
    resetQuote();
  }

  function chooseAddress(id: string) {
    setAddressId(id);
    resetQuote();
  }

  const quoteRequest = useMutation({
    mutationFn: (packageIds: string[]) => api<QuoteResult>("/api/shipping/quotes", { method: "POST", body: JSON.stringify({ packageIds, addressId: activeAddressId }) }),
    onSuccess: (result, packageIds) => {
      setQuote(result);
      setQuotedFor(`${[...packageIds].sort().join(",")}|${activeAddressId}`);
      setError("");
      // Preselect the cheapest route so the common case is one click.
      const cheapest = [...result.routes].sort((a, b) => a.estimatedMinFen - b.estimatedMinFen)[0];
      setRouteCode(result.failure ? null : (cheapest?.routeCode ?? null));
    },
    onError: (reason) => setError(reason instanceof ApiError ? reason.message : "Could not load shipping methods. Try again."),
  });

  const submit = useMutation({
    mutationFn: () =>
      api<Shipment>("/api/shipments", {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey() },
        body: JSON.stringify({
          packageIds: selected,
          addressId: activeAddressId,
          quoteId: quote?.quoteId,
          routeCode,
          packingInstruction: packing,
          packingNote: packing === "Other instructions" ? note || undefined : undefined,
        }),
      }),
    onSuccess: async (shipment) => {
      await queryClient.invalidateQueries({ queryKey: ["packages"] });
      await queryClient.invalidateQueries({ queryKey: ["shipments"] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      toast({ title: `Consolidation ${shipment.publicId} submitted. Nothing to pay yet.`, tone: "success" });
      navigate(`/app/shipments/${shipment.id}`);
    },
    onError: async (reason) => {
      setError(reason instanceof ApiError ? reason.message : "Could not submit the consolidation.");
      if (reason instanceof ApiError && reason.code === "PACKAGE_STATE_CHANGED") {
        await queryClient.invalidateQueries({ queryKey: ["packages"] });
      }
    },
  });

  function goToRoutes() {
    setStep(3);
    if (!quote || quotedFor !== quoteKey) quoteRequest.mutate(selected);
  }

  const route = quote?.routes.find((item) => item.routeCode === routeCode) ?? null;
  const routeTags = useMemo(() => {
    const routes = quote?.routes ?? [];
    if (routes.length < 2) return {} as Record<string, string[]>;
    const cheapest = [...routes].sort((a, b) => a.estimatedMinFen - b.estimatedMinFen)[0]!.routeCode;
    const timed = routes.filter((item) => item.daysMax > 0);
    const fastest = [...(timed.length ? timed : routes)].sort((a, b) => a.daysMax - b.daysMax || a.daysMin - b.daysMin)[0]!.routeCode;
    const tags: Record<string, string[]> = {};
    tags[cheapest] = [...(tags[cheapest] ?? []), "Cheapest"];
    tags[fastest] = [...(tags[fastest] ?? []), "Fastest"];
    return tags;
  }, [quote]);

  const primary: { label: string; disabled: boolean; onClick: () => void; loading?: boolean } = (() => {
    if (step === 1) return { label: "Continue to address", disabled: selected.length === 0, onClick: () => setStep(2) };
    if (step === 2) return { label: "See shipping methods", disabled: !activeAddressId, onClick: goToRoutes };
    if (step === 3) return { label: "Review shipment", disabled: !routeCode || Boolean(quote?.failure) || quoteRequest.isPending, onClick: () => setStep(4) };
    return { label: submit.isPending ? "Submitting…" : "Submit consolidation", disabled: !route || (packing === "Other instructions" && !note.trim()), onClick: () => submit.mutate(), loading: submit.isPending };
  })();

  function go(target: number) {
    if (target === 3) goToRoutes();
    else setStep(target);
    setError("");
  }

  if (packages.isLoading) return <><PageHeader title="Consolidate & ship" /><LoadingBlock label="Loading packages" rows={4} /></>;
  if (packages.error) return <><PageHeader title="Consolidate & ship" /><ErrorState message="Could not load your packages." onRetry={() => void packages.refetch()} /></>;

  return (
    <div className="pb-28 lg:pb-0">
      <PageHeader title="Consolidate & ship" subtitle="Combine ready packages into one international shipment. You pay after the warehouse packs and weighs it." />
      <Stepper step={step} canOpen={(index) => index < step || (index === step + 1 && !primary.disabled)} onOpen={go} />
      {error ? (
        <div className="mb-4">
          <Notice tone="danger">{error}</Notice>
        </div>
      ) : null}
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div key={step} className="step-in min-w-0">
          {step === 1 ? (
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-[15px] font-semibold tracking-tight">Choose packages</h2>
                  <p className="mt-0.5 text-[13px] text-slate-500">Only packages that are received and have nothing pending can ship.</p>
                </div>
                {eligible.length > 1 ? (
                  <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] font-medium text-slate-700 hover:bg-slate-50">
                    <Checkbox
                      checked={allSelected ? true : selected.length ? "indeterminate" : false}
                      onCheckedChange={() => {
                        setSelected(allSelected ? [] : eligible.map((item) => item.id));
                        resetQuote();
                      }}
                    />
                    Select all {eligible.length}
                  </label>
                ) : null}
              </div>
              {eligible.length === 0 ? (
                <div className="mt-4">
                  <EmptyState
                    icon={PackageOpen}
                    title="No packages are ready to ship"
                    body="Packages appear here once the warehouse has received them and any exceptions or services are finished."
                    action={<Button variant="secondary" to="/app/packages">View packages</Button>}
                  />
                </div>
              ) : (
                <div className="mt-4 grid gap-2">
                  {eligible.map((item) => {
                    const on = selected.includes(item.id);
                    return (
                      <ChoiceCard
                        key={item.id}
                        className="p-3.5"
                        checked={on}
                        control={<Checkbox checked={on} onCheckedChange={() => toggle(item.id)} aria-label={`Select ${item.publicId}`} />}
                        onSelect={() => toggle(item.id)}
                      >
                        <span className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
                          <span className="min-w-0">
                            <span className="block text-sm font-semibold tracking-tight">{item.publicId}</span>
                            <span className="block truncate text-[12px] text-slate-500">
                              <span className="font-mono">{item.domesticTrackingNumber}</span>
                              {item.productName ? ` · ${item.productName}` : ""}
                            </span>
                          </span>
                          <span className="flex items-center gap-3">
                            <span className="flex flex-wrap gap-1">
                              {item.cargoAttributes.map((attribute) => (
                                <CargoBadge key={attribute} attribute={attribute} />
                              ))}
                            </span>
                            <span className="w-16 text-right text-[13px] font-medium tabular-nums">{formatKg(item.weightGrams ?? 0)}</span>
                          </span>
                        </span>
                      </ChoiceCard>
                    );
                  })}
                </div>
              )}
              {specialCargo.length ? (
                <div className="mt-4">
                  <Notice tone="info">
                    Special cargo selected: {specialCargo.map(cargoLabel).join(", ")}. Fewer shipping methods accept it, and some mixes can't travel in one box. You'll see what fits in the next steps.
                  </Notice>
                </div>
              ) : null}
              {blocked.length ? (
                <div className="mt-4 border-t border-slate-100 pt-3">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-[13px] font-medium text-slate-600 hover:text-ink"
                    aria-expanded={showBlocked}
                    onClick={() => setShowBlocked((value) => !value)}
                  >
                    <ChevronDown size={15} className={cn("transition-transform", showBlocked && "rotate-180")} aria-hidden="true" />
                    {plural(blocked.length, "package")} can't ship yet
                  </button>
                  {showBlocked ? (
                    <ul className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-200">
                      {blocked.map((item) => (
                        <li key={item.id}>
                          <Link to={`/app/packages/${item.id}`} className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-[13px] hover:bg-slate-50">
                            <span className="min-w-0">
                              <span className="font-medium text-ink">{item.publicId}</span>
                              <span className="block truncate text-[12px] text-slate-500">{item.ineligibleReason}</span>
                            </span>
                            <span className="flex shrink-0 items-center gap-2">
                              <StatusBadge label={item.displayStatus.label} tone={item.displayStatus.tone} statusKey={item.displayStatus.key} />
                              <ChevronRight size={15} className="text-slate-300" aria-hidden="true" />
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </Card>
          ) : null}

          {step === 2 ? (
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-[15px] font-semibold tracking-tight">Where should it go?</h2>
                  <p className="mt-0.5 text-[13px] text-slate-500">Destination and postal code decide which shipping methods are available.</p>
                </div>
                <Button variant="ghost" to="/app/addresses">
                  <Plus size={15} aria-hidden="true" /> Manage addresses
                </Button>
              </div>
              {addresses.isLoading ? <div className="mt-4"><LoadingBlock rows={2} /></div> : null}
              {addresses.data && addresses.data.length === 0 ? (
                <div className="mt-4">
                  <EmptyState icon={MapPin} title="Add a delivery address first" body="You need an international address before we can find shipping methods." action={<Button to="/app/addresses">Add address</Button>} />
                </div>
              ) : null}
              <RadioGroup className="mt-4 gap-2" value={activeAddressId ?? ""} onValueChange={chooseAddress}>
                {addresses.data?.map((address) => (
                  <ChoiceCard
                    key={address.id}
                    checked={activeAddressId === address.id}
                    control={<RadioGroupItem value={address.id} aria-label={address.name} />}
                    onSelect={() => chooseAddress(address.id)}
                  >
                    <span className="flex items-center gap-2">
                      <span className="text-sm font-semibold">{address.name}</span>
                      {address.isDefault ? <span className="rounded-full bg-slate-100 px-1.5 py-px text-[11px] font-medium text-slate-600">Default</span> : null}
                    </span>
                    <AddressLines address={address} />
                  </ChoiceCard>
                ))}
              </RadioGroup>
            </Card>
          ) : null}

          {step === 3 ? (
            <Card>
              <h2 className="text-[15px] font-semibold tracking-tight">Choose a shipping method</h2>
              <p className="mt-0.5 text-[13px] text-slate-500">Filtered by destination, cargo, weight, and size. Prices are estimates; the final freight comes after packing.</p>
              {quoteRequest.isPending ? (
                <div className="mt-4">
                  <LoadingBlock label="Finding shipping methods" rows={3} />
                </div>
              ) : null}
              {!quoteRequest.isPending && quoteRequest.isError ? (
                <div className="mt-4">
                  <ErrorState message="Shipping methods didn't load." onRetry={() => quoteRequest.mutate(selected)} />
                </div>
              ) : null}
              {quote?.failure ? (
                <div className="mt-4 space-y-3">
                  <Notice tone="danger">
                    <strong className="block">{quote.failure.message}</strong>
                    <span className="mt-0.5 block">{quote.failure.detail}</span>
                  </Notice>
                  {quote.failure.packages.length ? (
                    <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 text-[13px]">
                      {quote.failure.packages.map((pkg) => {
                        const match = chosen.find((item) => item.publicId === pkg.publicId);
                        return (
                          <li key={pkg.publicId} className="flex items-center justify-between gap-3 px-3.5 py-2">
                            <span className="flex items-center gap-2">
                              <span className="font-medium">{pkg.publicId}</span>
                              <span className="flex gap-1">{pkg.cargo.map((attribute) => <CargoBadge key={attribute} attribute={attribute} />)}</span>
                            </span>
                            {match && chosen.length > 1 ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  const next = selected.filter((id) => id !== match.id);
                                  setSelected(next);
                                  resetQuote();
                                  quoteRequest.mutate(next);
                                }}
                              >
                                Leave out and retry
                              </Button>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                  <p className="text-[13px] text-slate-500">Leave out a package to ship the rest now. It stays in your warehouse for a separate shipment.</p>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" onClick={() => setStep(1)}>Change packages</Button>
                    <Button variant="secondary" onClick={() => setStep(2)}>Change address</Button>
                  </div>
                </div>
              ) : null}
              {quote && !quote.failure ? (
                <RadioGroup className="mt-4 gap-2" value={routeCode ?? ""} onValueChange={setRouteCode}>
                  {quote.routes.map((item) => (
                    <ChoiceCard
                      key={item.routeCode}
                      checked={routeCode === item.routeCode}
                      control={<RadioGroupItem value={item.routeCode} aria-label={item.routeName} />}
                      onSelect={() => setRouteCode(item.routeCode)}
                    >
                      <span className="flex items-start justify-between gap-4">
                        <span className="min-w-0">
                          <span className="flex flex-wrap items-center gap-1.5">
                            <span className="text-sm font-semibold">{item.routeName}</span>
                            {routeTags[item.routeCode]?.map((tag) => (
                              <span key={tag} className={cn("rounded-full px-1.5 py-px text-[11px] font-medium", tag === "Cheapest" ? "bg-emerald-50 text-emerald-700" : "bg-sky-50 text-sky-700")}>
                                {tag}
                              </span>
                            ))}
                          </span>
                          <span className="mt-1 block text-[13px] text-slate-500">
                            {item.daysMax > 0 ? `${item.daysMin}–${item.daysMax} business days · ` : item.description ? `${item.description} · ` : ""}{item.doorToDoor ? "Door to door" : "Pick up at terminal"} · {item.supportsTracking ? "Full tracking" : "Limited tracking"}
                          </span>
                          <span className="mt-2 flex flex-wrap items-center gap-1">
                            <span className="mr-0.5 text-[12px] text-slate-400">Accepts</span>
                            {item.cargoCapabilities.map((attribute) => (
                              <CargoBadge key={attribute} attribute={attribute} />
                            ))}
                          </span>
                          {item.taxNote ? <span className="mt-1.5 block text-[12px] text-slate-500">Taxes: {item.taxNote}</span> : null}
                        </span>
                        <span className="shrink-0 text-right">
                          <span className="block text-[15px] font-semibold tracking-tight">
                            <MoneyRange min={item.estimatedMinFen} max={item.estimatedMaxFen} />
                          </span>
                          <span className="block text-[11px] text-slate-400">estimated</span>
                        </span>
                      </span>
                    </ChoiceCard>
                  ))}
                </RadioGroup>
              ) : null}
            </Card>
          ) : null}

          {step === 4 && route && chosenAddress ? (
            <div className="space-y-4">
              <Card>
                <h2 className="text-[15px] font-semibold tracking-tight">Review before you submit</h2>
                <dl className="mt-3 divide-y divide-slate-100">
                  <ReviewRow label="Packages" onChange={() => setStep(1)}>
                    <span className="font-medium">{plural(chosen.length, "package")} · {formatKg(weight)}</span>
                    <span className="mt-1 flex flex-wrap gap-1">
                      {chosen.map((item) => (
                        <span key={item.id} className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[12px] text-slate-700">{item.publicId}</span>
                      ))}
                    </span>
                  </ReviewRow>
                  <ReviewRow label="Deliver to" onChange={() => setStep(2)}>
                    <span className="font-medium">{chosenAddress.name}</span>
                    <AddressLines address={chosenAddress} />
                  </ReviewRow>
                  <ReviewRow label="Shipping method" onChange={() => setStep(3)}>
                    <span className="font-medium">{route.routeName}</span>
                    <span className="block text-slate-500">
                      {route.daysMax > 0 ? `${route.daysMin}–${route.daysMax} business days · ` : null}estimated <MoneyRange min={route.estimatedMinFen} max={route.estimatedMaxFen} />
                    </span>
                  </ReviewRow>
                </dl>
              </Card>
              <Card>
                <div>
                  <h3 className="text-[13px] font-medium text-slate-800">Packing instructions</h3>
                  <RadioGroup className="mt-2 gap-2 sm:grid-cols-2" value={packing} onValueChange={setPacking}>
                    {packingOptions.map((option) => (
                      <ChoiceCard
                        key={option.value}
                        className="p-3"
                        checked={packing === option.value}
                        control={<RadioGroupItem value={option.value} aria-label={option.value} />}
                        onSelect={() => setPacking(option.value)}
                      >
                        <span className="block text-[13px] font-medium">{option.value}</span>
                        <span className="block text-[12px] font-normal text-slate-500">{option.hint}</span>
                      </ChoiceCard>
                    ))}
                  </RadioGroup>
                </div>
                {packing === "Other instructions" ? (
                  <Textarea className="mt-3" rows={3} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Tell the warehouse what to do, e.g. “Put the ceramic mug in bubble wrap.”" aria-label="Packing note" autoFocus />
                ) : null}
              </Card>
              <Notice tone="info">No payment now. The warehouse packs, weighs, and measures first. The final freight then shows under Shipments → To Pay.</Notice>
            </div>
          ) : null}
        </div>

        <aside className="hidden lg:sticky lg:top-2 lg:block">
          <Summary
            chosen={chosen}
            weight={weight}
            cargoMix={cargoMix}
            address={step >= 2 ? chosenAddress : null}
            route={step >= 3 ? route : null}
            onRemove={step === 1 ? toggle : undefined}
          />
          <div className="mt-3 flex gap-2">
            {step > 1 ? (
              <Button variant="secondary" onClick={() => setStep((value) => value - 1)}>
                Back
              </Button>
            ) : null}
            <Button className="flex-1" size="lg" disabled={primary.disabled} loading={primary.loading} onClick={primary.onClick}>
              {primary.label}
            </Button>
          </div>
        </aside>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur lg:hidden">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <div className="min-w-0 text-[13px]">
            <div className="font-semibold">{plural(selected.length, "package")}</div>
            <div className="truncate text-slate-500">
              {formatKg(weight)}
              {route ? <> · <MoneyRange min={route.estimatedMinFen} max={route.estimatedMaxFen} /></> : null}
            </div>
          </div>
          <div className="flex gap-2">
            {step > 1 ? (
              <Button variant="secondary" onClick={() => setStep((value) => value - 1)}>
                Back
              </Button>
            ) : null}
            <Button disabled={primary.disabled} loading={primary.loading} onClick={primary.onClick}>
              {primary.label}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stepper({ step, canOpen, onOpen }: { step: number; canOpen: (index: number) => boolean; onOpen: (index: number) => void }) {
  return (
    <ol className="mb-5 flex items-center gap-2 overflow-x-auto pb-1" aria-label="Progress">
      {steps.map((label, index) => {
        const number = index + 1;
        const current = step === number;
        const done = number < step;
        const enabled = !current && canOpen(number);
        return (
          <li key={label} className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              disabled={!enabled}
              aria-current={current ? "step" : undefined}
              className={cn(
                "flex items-center gap-2 rounded-full p-1 text-[13px] transition-colors sm:pr-3",
                current && "pr-3",
                current && "bg-white font-medium text-ink shadow-[0_1px_2px_rgba(16,24,40,0.08)] ring-1 ring-slate-200",
                done && "text-slate-700 hover:bg-white",
                !current && !done && "text-slate-400",
                enabled && !done && "hover:bg-white hover:text-slate-700",
              )}
              onClick={() => onOpen(number)}
            >
              <span
                className={cn(
                  "grid size-6 place-items-center rounded-full text-[12px] font-semibold tabular-nums",
                  current && "bg-brand text-white",
                  done && "bg-indigo-100 text-indigo-700",
                  !current && !done && "bg-slate-200/70 text-slate-500",
                )}
              >
                {done ? <Check size={13} strokeWidth={3} aria-hidden="true" /> : number}
              </span>
              <span className={current ? "" : "sr-only sm:not-sr-only"}>{label}</span>
            </button>
            {index < steps.length - 1 ? <span className={cn("h-px w-4 shrink-0 sm:w-10", done ? "bg-indigo-200" : "bg-slate-200")} aria-hidden="true" /> : null}
          </li>
        );
      })}
    </ol>
  );
}

function Summary({
  chosen,
  weight,
  cargoMix,
  address,
  route,
  onRemove,
}: {
  chosen: PackageItem[];
  weight: number;
  cargoMix: CargoAttribute[];
  address: Address | null;
  route: QuoteResult["routes"][number] | null;
  onRemove?: (id: string) => void;
}) {
  const [weightNote, setWeightNote] = useState(false);
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(16,24,40,0.03)]" aria-label="Shipment summary">
      <div className="relative border-b border-slate-100 bg-[linear-gradient(180deg,#f8f9ff,#ffffff)] px-4 py-3.5">
        <div className="text-[12px] font-medium text-slate-500">Your shipment</div>
        <div className="mt-1 flex items-baseline justify-between gap-3">
          <span className="flex items-baseline gap-1.5">
            <span className="text-[1.35rem] leading-none font-semibold tracking-tight tabular-nums">{formatKg(weight)}</span>
            <span className="inline-flex items-center gap-0.5 text-[12px] font-medium text-slate-500">
              Est. weight
              <button type="button" className="grid size-4 place-items-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-expanded={weightNote} aria-controls="est-weight-note" aria-label="Why this weight is an estimate" onClick={() => setWeightNote((open) => !open)}>
                <CircleHelp size={13} aria-hidden="true" />
              </button>
            </span>
          </span>
          <span className="text-[13px] text-slate-500">{plural(chosen.length, "package")}</span>
        </div>
        {weightNote ? (
          <p id="est-weight-note" className="absolute top-full right-3 left-3 z-20 -mt-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[12px] leading-5 text-slate-600 shadow-lg">
            This adds the warehouse weight of each package before packing. After consolidation, volumetric weight can change, and each channel bills that weight differently.
          </p>
        ) : null}
        {cargoMix.length ? (
          <div className="mt-2.5 flex flex-wrap gap-1">
            {cargoMix.map((attribute) => (
              <CargoBadge key={attribute} attribute={attribute} />
            ))}
          </div>
        ) : null}
      </div>
      {chosen.length ? (
        <ul className="scroll-area max-h-56 divide-y divide-slate-100 overflow-y-auto">
          {chosen.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-2 px-4 py-2 text-[13px]">
              <span className="font-medium">{item.publicId}</span>
              <span className="flex items-center gap-1.5 text-slate-500 tabular-nums">
                {formatKg(item.weightGrams ?? 0)}
                {onRemove ? (
                  <button type="button" className="grid size-6 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label={`Remove ${item.publicId}`} onClick={() => onRemove(item.id)}>
                    <X size={13} />
                  </button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-4 py-5 text-center text-[13px] text-slate-400">Select packages to start.</p>
      )}
      <dl className="divide-y divide-slate-100 border-t border-slate-100 text-[13px]">
        <SummaryRow icon={MapPin} label="Deliver to" value={address ? `${address.city}, ${countryName(address.countryCode)}` : null} />
        <SummaryRow icon={Truck} label="Method" value={route ? route.routeName : null} />
        <SummaryRow icon={Gauge} label="Est. freight" value={route ? <MoneyRange min={route.estimatedMinFen} max={route.estimatedMaxFen} /> : null} />
      </dl>
    </section>
  );
}

function SummaryRow({ icon: Icon, label, value }: { icon: typeof MapPin; label: string; value: ReactNode | null }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5">
      <dt className="flex items-center gap-2 text-slate-500">
        <Icon size={14} className="text-slate-400" aria-hidden="true" />
        {label}
      </dt>
      <dd className={cn("truncate text-right", value ? "font-medium text-ink" : "text-slate-300")}>{value ?? "—"}</dd>
    </div>
  );
}

function placeName(value: string) {
  const local = value.split("—")[0]?.trim();
  return local || value.trim();
}

function AddressLines({ address }: { address: Address }) {
  const street = [address.addressLine1, address.addressLine2].map((line) => line?.trim()).filter(Boolean).join(", ");
  const locality = [address.district, address.city, address.state ? placeName(address.state) : ""].map((line) => line?.trim()).filter(Boolean).join(", ");
  const country = [countryName(address.countryCode), address.postalCode.trim()].filter(Boolean).join(" ");
  return (
    <span className="mt-1 block text-[13px] leading-5 text-slate-500">
      {street ? <span className="block">{street}</span> : null}
      {locality ? <span className="block">{locality}</span> : null}
      {country ? <span className="block">{country}</span> : null}
    </span>
  );
}

function ReviewRow({ label, children, onChange }: { label: string; children: ReactNode; onChange: () => void }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3 text-[13px]">
      <div className="min-w-0">
        <dt className="text-[12px] text-slate-500">{label}</dt>
        <dd className="mt-0.5">{children}</dd>
      </div>
      <Button variant="ghost" size="sm" onClick={onChange}>
        Change
      </Button>
    </div>
  );
}
