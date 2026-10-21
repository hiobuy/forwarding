import { useMutation, useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { useI18n } from "../../lib/i18n";
import { ApiError, api } from "../../lib/api";
import { cn } from "../../lib/utils";
import { ChannelDialog } from "../calculator/ShippingCalculator";
import { Ms } from "./icon";

type Attribute = { code: string; name: string };
type Options = { connected: boolean; countries: { code: string; name: string }[]; attributes: Attribute[]; message: string | null; demo?: boolean };
type Quote = { code: string; name: string; description: string | null; eta: string | null; partial: boolean; note: string | null; priceUsdFen: number };
type Result = { quotes: Quote[]; disclaimer: string; demo?: boolean };

const fieldClass =
  "h-11 w-full rounded-lg border border-[var(--pb-control)] bg-white px-3.5 text-[15px] text-[var(--pb-on)] outline-none focus:border-[var(--pb-primary)] focus:ring-2 focus:ring-[var(--pb-primary)]/20";

export function SiteCalculator() {
  const { t, currency, format } = useI18n();
  const options = useQuery({ queryKey: ["calculator-options", "public"], queryFn: () => api<Options>("/api/shipping/calculator/options") });
  const [country, setCountry] = useState("");
  const [attribute, setAttribute] = useState("");
  const [weight, setWeight] = useState("1.5");
  const [length, setLength] = useState("");
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("");
  const [formError, setFormError] = useState("");
  const [detailCode, setDetailCode] = useState<string | null>(null);
  const quote = useMutation({
    mutationFn: (body: Record<string, unknown>) => api<Result>("/api/shipping/calculator", { method: "POST", body: JSON.stringify(body) }),
  });

  const selectedCountry = country || options.data?.countries[0]?.code || "";
  const selectedAttribute = attribute || options.data?.attributes[0]?.code || "";
  const weightNumber = Number(weight);
  const demo = Boolean(options.data?.demo || quote.data?.demo);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError("");
    if (!(weightNumber > 0)) {
      setFormError(t("Weight must be greater than 0 kg."));
      return;
    }
    const dims = [length, width, height].map((value) => value.trim());
    const filled = dims.filter(Boolean);
    if (filled.length !== 0 && filled.length !== 3) {
      setFormError(t("Enter all three dimensions, or leave all three blank."));
      return;
    }
    if (!selectedCountry || !selectedAttribute) {
      setFormError(t("Choose a destination and a cargo type."));
      return;
    }
    const body: Record<string, unknown> = { countryCode: selectedCountry, weightKg: weightNumber, attribute: selectedAttribute };
    if (filled.length === 3) {
      body.lengthCm = Number(length);
      body.widthCm = Number(width);
      body.heightCm = Number(height);
    }
    quote.mutate(body);
  }

  const error = formError || (quote.error instanceof ApiError ? quote.error.message : quote.error ? t("Could not get shipping rates.") : "");

  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
      <form className="flex flex-col gap-4 rounded-2xl bg-white p-6 shadow-[0_4px_24px_rgba(22,78,65,0.06)] lg:col-span-5" onSubmit={onSubmit}>
        <div className="flex items-center justify-between border-b border-[var(--pb-border)] pb-2">
          <span className="text-[16px] leading-[22px] font-bold">{t("Shipment parameters")}</span>
          <span className="text-[11px] leading-4 font-medium text-[var(--pb-text-muted)]">{t("Weight in kg")}</span>
        </div>
        {options.isLoading ? <p className="text-[13px] text-[var(--pb-text-muted)]" role="status">{t("Loading destinations…")}</p> : null}
        {options.isError ? (
          <p className="text-[13px] text-[#ba1a1a]" role="alert">
            {t("Could not load destinations.")}{" "}
            <button type="button" className="font-bold underline" onClick={() => void options.refetch()}>{t("Try again")}</button>
          </p>
        ) : null}
        {options.data ? (
          <>
            {options.data.message ? <p className="rounded-lg bg-[var(--pb-container)] px-3 py-2 text-[13px] leading-5 text-[var(--pb-muted)]">{t(options.data.message)}</p> : null}
            {demo ? <p className="text-[12px] leading-5 font-bold text-[var(--pb-primary)]">{t("Demo mode. These are sample rates, not live HioBuy quotes.")}</p> : null}
            <label className="flex flex-col gap-1.5 text-[12px] leading-4 font-bold text-[var(--pb-muted)]" htmlFor="dest-country">
              {t("Destination country")}
              <span className="relative">
                <select id="dest-country" className={cn(fieldClass, "cursor-pointer appearance-none pr-10")} value={selectedCountry} onChange={(event) => setCountry(event.target.value)} disabled={!options.data.countries.length}>
                  {options.data.countries.length ? null : <option value="">{t("No open countries")}</option>}
                  {options.data.countries.map((item) => (
                    <option key={item.code} value={item.code}>{item.name}</option>
                  ))}
                </select>
                <Ms name="expand_more" className="pointer-events-none absolute top-2.5 right-3 text-[20px] text-[var(--pb-text-muted)]" />
              </span>
            </label>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[12px] leading-4 font-bold text-[var(--pb-muted)]" htmlFor="weight-input">{t("Estimated weight (kg)")}</label>
                <span className="text-[11px] leading-4 font-bold text-[var(--pb-primary)]">{Number.isFinite(weightNumber) ? weightNumber.toFixed(2) : "0.00"} kg</span>
              </div>
              <span className="relative">
                <input id="weight-input" className={cn(fieldClass, "pr-12 tabular-nums")} type="number" min={0.1} max={50} step={0.1} value={weight} onChange={(event) => setWeight(event.target.value)} />
                <span className="absolute top-3 right-3.5 text-[11px] font-medium text-[var(--pb-text-muted)]">KG</span>
              </span>
              <input className="mt-1 w-full cursor-pointer accent-[var(--pb-primary)]" type="range" min={0.5} max={15} step={0.5} value={Math.min(15, Math.max(0.5, weightNumber || 0.5))} aria-label={t("Weight slider")} onChange={(event) => setWeight(event.target.value)} />
            </div>
            <fieldset className="flex flex-col gap-1.5">
              <legend className="text-[12px] leading-4 font-bold text-[var(--pb-muted)]">{t("Commodity classification")}</legend>
              <div className="grid grid-cols-2 gap-2">
                {options.data.attributes.map((item) => {
                  const active = item.code === selectedAttribute;
                  return (
                    <button
                      key={item.code}
                      type="button"
                      className={cn(
                        "flex items-center gap-2 rounded-lg border p-2.5 text-left text-[12px] leading-4 font-bold transition",
                        active ? "border-[var(--pb-primary)]/30 bg-[var(--pb-container)] text-[var(--pb-primary)]" : "border-transparent bg-[var(--pb-subtle)] text-[var(--pb-muted)] hover:bg-[var(--pb-container)]",
                      )}
                      aria-pressed={active}
                      onClick={() => setAttribute(item.code)}
                    >
                      <span className="min-w-0">{t(item.name)}</span>
                    </button>
                  );
                })}
              </div>
              {options.data.attributes.length ? null : <p className="text-[13px] text-[var(--pb-text-muted)]">{t("No cargo types are available.")}</p>}
            </fieldset>
            <details className="group pt-1 text-[var(--pb-muted)]">
              <summary className="flex cursor-pointer list-none items-center justify-between py-1 text-[12px] leading-4 font-bold text-[var(--pb-primary)]">
                <span>{t("Add box dimensions (L × W × H cm)")}</span>
                <Ms name="expand_more" className="text-[18px] transition-transform group-open:rotate-180" />
              </summary>
              <div className="mt-2 grid grid-cols-3 gap-2 border-t border-[var(--pb-border)] pt-2">
                {([["Length", length, setLength], ["Width", width, setWidth], ["Height", height, setHeight]] as const).map(([label, value, setValue]) => (
                  <input key={label} className="h-9 rounded border border-[var(--pb-control)] bg-[var(--pb-subtle)] px-2 text-center text-[13px]" inputMode="decimal" aria-label={t(label)} placeholder={t(label)} value={value} onChange={(event) => setValue(event.target.value)} />
                ))}
              </div>
              <p className="mt-1.5 text-[11px] leading-4 text-[var(--pb-text-muted)]">{t("Leave all three blank if you only know the weight.")}</p>
            </details>
            {error ? <p className="text-[13px] text-[#ba1a1a]" role="alert">{error}</p> : null}
            <button type="submit" className="flex h-11 items-center justify-center gap-2 rounded-lg bg-[var(--pb-primary)] text-[12px] leading-4 font-bold text-white shadow-sm transition hover:bg-[var(--pb-primary-strong)] disabled:opacity-60" disabled={quote.isPending || !options.data.connected || !options.data.countries.length || !options.data.attributes.length}>
              <Ms name="sync" className="text-[18px]" />
              {quote.isPending ? t("Updating rates…") : t("Update shipping rates")}
            </button>
          </>
        ) : null}
      </form>
      <section className="flex flex-col gap-4 lg:col-span-7" aria-live="polite">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-[var(--pb-container)] p-4">
          <div className="flex items-center gap-2 text-[12px] leading-4 font-extrabold tracking-[0.12em] text-[var(--pb-primary)] uppercase">
            <Ms name="local_shipping" className="text-[20px]" />
            <span>{quote.data ? t("Available channels ({count})", { count: quote.data.quotes.length }) : t("Available channels")}</span>
          </div>
          <span className="text-[11px] leading-4 font-medium text-[var(--pb-text-muted)]">{t("Final {currency} price only", { currency })}</span>
        </div>
        {quote.isPending ? <p className="rounded-2xl bg-white p-6 text-[15px] text-[var(--pb-muted)] shadow-[0_4px_16px_rgba(22,78,65,0.05)]" role="status">{t("Getting rates…")}</p> : null}
        {!quote.data && !quote.isPending ? <p className="rounded-2xl bg-white p-6 text-[15px] leading-6 text-[var(--pb-muted)] shadow-[0_4px_16px_rgba(22,78,65,0.05)]">{t("Choose a destination and cargo type, then update the rates. Estimates show up here.")}</p> : null}
        {quote.data && quote.data.quotes.length === 0 ? <p className="rounded-2xl bg-white p-6 text-[15px] leading-6 text-[var(--pb-muted)] shadow-[0_4px_16px_rgba(22,78,65,0.05)]">{t("No shipping channels for this destination, weight, and cargo type.")}</p> : null}
        {quote.data?.quotes.map((item, index) => (
          <article key={item.code} className="flex flex-col justify-between gap-4 rounded-2xl bg-white p-6 shadow-[0_4px_16px_rgba(22,78,65,0.05)] transition hover:shadow-[0_8px_24px_rgba(22,78,65,0.08)] md:flex-row md:items-center">
            <div className="flex items-start gap-4">
              <div className="grid size-12 shrink-0 place-items-center rounded-xl bg-[var(--pb-container)] text-[var(--pb-primary)]">
                <Ms name="local_shipping" className="text-[26px]" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-[16px] leading-[22px] font-bold">{item.name}</h3>
                  {index === 0 ? <span className="rounded bg-[var(--pb-secondary-container)] px-2 py-0.5 text-[11px] leading-4 font-semibold text-[var(--pb-on-secondary-container)]">{t("Lowest price")}</span> : null}
                </div>
                {item.description ? <p className="mt-0.5 text-[13px] leading-5 text-[var(--pb-muted)]">{item.description}</p> : null}
                <div className="mt-2 flex flex-wrap items-center gap-4 text-[11px] leading-4 font-medium text-[var(--pb-text-muted)]">
                  <span className="flex items-center gap-1"><Ms name="schedule" className="text-[14px]" />{item.eta ?? t("Timing not provided")}</span>
                  {item.partial ? <span>{t("Partial estimate")}</span> : null}
                </div>
                {item.note ? <p className="mt-1 text-[12px] leading-5 text-[var(--pb-muted)]">{item.note}</p> : null}
                <button type="button" className="mt-2 text-[13px] font-bold text-[var(--pb-primary)] hover:underline" onClick={() => setDetailCode(item.code)}>{t("Channel details")}</button>
              </div>
            </div>
            <div className="flex shrink-0 items-center justify-between gap-4 border-t border-[var(--pb-border)] pt-3 md:flex-col md:items-end md:border-t-0 md:pt-0">
              <div className="text-right">
                <div className="text-[36px] leading-[44px] font-bold tracking-[-0.03em] text-[var(--pb-primary)]">{format(item.priceUsdFen)}</div>
                <div className="text-[11px] leading-4 font-medium text-[var(--pb-text-muted)]">{t("Est. total ({currency})", { currency })}</div>
              </div>
              <Link className="rounded-lg bg-[var(--pb-container)] px-4 py-2 text-[12px] leading-4 font-bold text-[var(--pb-primary)] transition hover:bg-[var(--pb-primary)] hover:text-white" to="/auth/register">
                {t("Select")}
              </Link>
            </div>
          </article>
        ))}
        {quote.data ? <p className="text-[12px] leading-5 text-[var(--pb-text-muted)]">{quote.data.disclaimer}</p> : null}
      </section>
      <ChannelDialog mode="public" code={detailCode} country={selectedCountry} onClose={() => setDetailCode(null)} />
    </div>
  );
}

export function useOpenCountries() {
  return useQuery({
    queryKey: ["calculator-options", "public"],
    queryFn: () => api<Options>("/api/shipping/calculator/options"),
    staleTime: 60_000,
  });
}
