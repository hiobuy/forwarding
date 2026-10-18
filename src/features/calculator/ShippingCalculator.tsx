import { useMutation, useQuery } from "@tanstack/react-query";
import { useState, type FormEvent, type ReactNode } from "react";
import { formatCnyFen, formatRateE4 } from "../../domain/freight";
import { formatFen } from "../../domain/money";
import { Button, Dialog, EmptyState, ErrorState, Field, LoadingBlock, inputClass } from "../../components/ui";
import { ApiError, api } from "../../lib/api";
import { cn } from "../../lib/utils";

type Attribute = { code: string; name: string };
type Options = { connected: boolean; countries: { code: string; name: string }[]; attributes: Attribute[]; message: string | null };
type Quote = {
  code: string;
  name: string;
  description: string | null;
  eta: string | null;
  partial: boolean;
  note: string | null;
  priceUsdFen: number;
  costCnyFen?: number;
  markupCnyFen?: number;
  profitUsdFen?: number;
  cnyPerUsdE4?: number;
};
type Result = { quotes: Quote[]; disclaimer: string };

export function ShippingCalculator({ mode }: { mode: "public" | "customer" | "admin" }) {
  const optionsPath = mode === "admin" ? "/api/admin/calculator/options" : "/api/shipping/calculator/options";
  const quotePath = mode === "admin" ? "/api/admin/calculator" : "/api/shipping/calculator";
  const options = useQuery({ queryKey: ["calculator-options", mode], queryFn: () => api<Options>(optionsPath) });
  const [country, setCountry] = useState("");
  const [attribute, setAttribute] = useState("");
  const [weight, setWeight] = useState("");
  const [length, setLength] = useState("");
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("");
  const [formError, setFormError] = useState("");
  const [detailCode, setDetailCode] = useState<string | null>(null);
  const quote = useMutation({
    mutationFn: (body: Record<string, unknown>) => api<Result>(quotePath, { method: "POST", body: JSON.stringify(body) }),
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError("");
    const weightKg = Number(weight);
    if (!(weightKg > 0)) {
      setFormError("Weight must be greater than 0 kg.");
      return;
    }
    const dims = [length, width, height].map((value) => value.trim());
    const filled = dims.filter(Boolean);
    if (filled.length !== 0 && filled.length !== 3) {
      setFormError("Enter all three dimensions, or leave all three blank.");
      return;
    }
    const countryCode = country || options.data?.countries[0]?.code || "";
    const cargo = attribute || options.data?.attributes[0]?.code || "";
    if (!countryCode || !cargo) {
      setFormError("Choose a destination and a cargo type.");
      return;
    }
    const body: Record<string, unknown> = { countryCode, weightKg, attribute: cargo };
    if (filled.length === 3) {
      body.lengthCm = Number(length);
      body.widthCm = Number(width);
      body.heightCm = Number(height);
    }
    quote.mutate(body);
  }

  const error = formError || (quote.error instanceof ApiError ? quote.error.message : quote.error ? "Could not get shipping rates." : "");
  const selectedCountry = country || options.data?.countries[0]?.code || "";
  const selectedAttribute = attribute || options.data?.attributes[0]?.code || "";

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(280px,0.82fr)_minmax(0,1.18fr)]">
      <form className="rounded-xl border border-slate-200 bg-white p-4" onSubmit={onSubmit}>
        <h2 className="text-sm font-semibold">Shipment details</h2>
        <p className="mt-1 text-[13px] text-slate-500">Weight in kilograms. Dimensions in centimeters are optional.</p>
        {options.isLoading ? <div className="mt-4"><LoadingBlock rows={3} /></div> : null}
        {options.isError ? <div className="mt-4"><ErrorState message="Could not load destinations." onRetry={() => void options.refetch()} /></div> : null}
        {options.data ? (
          <div className="mt-4 space-y-3">
            {options.data.message ? <p className="text-[13px] text-slate-500">{options.data.message}</p> : null}
            <Field label="Destination country">
              <select className={inputClass} aria-label="Destination country" value={selectedCountry} onChange={(event) => setCountry(event.target.value)} disabled={!options.data.countries.length}>
                {options.data.countries.length ? null : <option value="">No open countries</option>}
                {options.data.countries.map((item) => (
                  <option key={item.code} value={item.code}>{item.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Cargo type">
              <select className={inputClass} aria-label="Cargo type" value={selectedAttribute} onChange={(event) => setAttribute(event.target.value)} disabled={!options.data.attributes.length}>
                {options.data.attributes.length ? null : <option value="">No cargo types</option>}
                {options.data.attributes.map((item) => (
                  <option key={item.code} value={item.code}>{item.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Weight (kg)">
              <input className={cn(inputClass, "tabular-nums")} inputMode="decimal" value={weight} onChange={(event) => setWeight(event.target.value)} placeholder="1.25" />
            </Field>
            <div className="grid grid-cols-3 gap-2">
              {([["length", length, setLength], ["width", width, setWidth], ["height", height, setHeight]] as const).map(([key, value, setValue]) => (
                <Field key={key} label={`${key[0]!.toUpperCase()}${key.slice(1)} (cm)`}>
                  <input className={cn(inputClass, "tabular-nums")} inputMode="decimal" aria-label={`${key} in centimeters`} value={value} onChange={(event) => setValue(event.target.value)} placeholder="—" />
                </Field>
              ))}
            </div>
            {error ? <p className="text-[13px] text-red-700" role="alert">{error}</p> : null}
            <Button type="submit" loading={quote.isPending} disabled={!options.data.connected || !options.data.countries.length || !options.data.attributes.length}>Get shipping rates</Button>
          </div>
        ) : null}
      </form>
      <section aria-live="polite">
        {quote.isPending ? <LoadingBlock label="Getting rates" rows={3} /> : null}
        {!quote.data && !quote.isPending ? <EmptyState title="Estimates show up here" body="Choose a destination and cargo type, then compare shipping channels." /> : null}
        {quote.data && quote.data.quotes.length === 0 ? <EmptyState title="No shipping channels" body="Nothing is available for this destination, weight, and cargo type." /> : null}
        {quote.data && quote.data.quotes.length > 0 ? (
          <div className="space-y-2">
            {mode === "admin" ? <AdminQuotes quotes={quote.data.quotes} country={selectedCountry} onDetails={setDetailCode} /> : <PublicQuotes quotes={quote.data.quotes} country={selectedCountry} onDetails={setDetailCode} />}
            <p className="text-[12px] leading-5 text-slate-400">{quote.data.disclaimer}</p>
          </div>
        ) : null}
      </section>
      <ChannelDialog mode={mode} code={detailCode} country={selectedCountry} onClose={() => setDetailCode(null)} />
    </div>
  );
}

function PublicQuotes({ quotes, onDetails }: { quotes: Quote[]; country: string; onDetails: (code: string) => void }) {
  return (
    <ul className="space-y-2">
      {quotes.map((item, index) => (
        <li key={item.code} className="rounded-xl border border-slate-200 bg-white px-3.5 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold">{item.name}</h3>
                {index === 0 ? <span className="rounded-full bg-indigo-50 px-1.5 text-[11px] font-medium text-indigo-700">Lowest price</span> : null}
              </div>
              <p className="mt-1 text-[13px] text-slate-500">{item.eta ? `Estimated delivery: ${item.eta}` : "Delivery time not provided"}</p>
              {item.description ? <p className="mt-1 text-[12px] leading-5 text-slate-400">{item.description}</p> : null}
              {item.note ? <p className="mt-1 text-[12px] leading-5 text-slate-500">{item.note}</p> : null}
              {item.partial ? <p className="mt-1 text-[12px] text-slate-500">Partial estimate. Some charges are still unknown.</p> : null}
              <button type="button" className="mt-2 text-[13px] font-medium text-indigo-700 hover:text-indigo-800" onClick={() => onDetails(item.code)}>Channel details</button>
            </div>
            <div className="text-right text-lg font-semibold tabular-nums">{formatFen(item.priceUsdFen)}</div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function AdminQuotes({ quotes, onDetails }: { quotes: Quote[]; country: string; onDetails: (code: string) => void }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full min-w-[640px] text-left text-[13px]">
        <thead className="border-b border-slate-100 text-[12px] text-slate-500">
          <tr>
            <th className="px-3 py-2.5 font-medium">Channel</th>
            <th className="px-3 py-2.5 text-right font-medium">HioBuy cost</th>
            <th className="px-3 py-2.5 text-right font-medium">Customer price</th>
            <th className="px-3 py-2.5 text-right font-medium">Gross profit</th>
            <th className="px-3 py-2.5 font-medium">ETA</th>
          </tr>
        </thead>
        <tbody>
          {quotes.map((item) => (
            <tr key={item.code} className="border-b border-slate-100 last:border-b-0">
              <td className="px-3 py-2.5">
                <div className="font-medium text-ink">{item.name}</div>
                <button type="button" className="mt-1 text-[12px] font-medium text-indigo-700 hover:text-indigo-800" onClick={() => onDetails(item.code)}>Details</button>
                {item.partial ? <div className="text-[11px] text-slate-400">Partial estimate</div> : null}
                {item.note ? <div className="text-[11px] text-slate-400">{item.note}</div> : null}
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums">{item.costCnyFen == null ? "—" : formatCnyFen(item.costCnyFen)}</td>
              <td className="px-3 py-2.5 text-right font-medium tabular-nums">{formatFen(item.priceUsdFen)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums">{item.profitUsdFen == null ? "—" : formatFen(item.profitUsdFen)}</td>
              <td className="px-3 py-2.5 text-slate-600">{item.eta ?? "—"}{item.cnyPerUsdE4 ? <span className="mt-0.5 block text-[11px] text-slate-400">{formatRateE4(item.cnyPerUsdE4)} CNY/USD</span> : null}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type Detail = {
  code: string;
  name: string;
  description: string | null;
  delivery: string[];
  range: string | null;
  volumetric: string | null;
  regions: { name: string; eta: string | null }[];
  restrictions: string[];
  services: { name: string; mode: string; description: string | null; price: string | null }[];
  rates: { region: string; rows: { label: string; range: string; amount: string }[] }[] | null;
};

export function ChannelDialog({ mode, code, country, onClose }: { mode: "public" | "customer" | "admin"; code: string | null; country: string; onClose: () => void }) {
  const path = mode === "admin"
    ? `/api/admin/calculator/channel?code=${encodeURIComponent(code ?? "")}&country=${encodeURIComponent(country)}`
    : `/api/shipping/calculator/channel?code=${encodeURIComponent(code ?? "")}&country=${encodeURIComponent(country)}`;
  const detail = useQuery({
    queryKey: ["channel-detail", mode, code, country],
    queryFn: () => api<Detail>(path),
    enabled: Boolean(code && country),
  });
  const item = detail.data;
  return (
    <Dialog open={code != null} title={item?.name ?? "Channel details"} description={item?.code} onClose={onClose} size="lg">
      {detail.isLoading ? <LoadingBlock rows={4} /> : null}
      {detail.isError ? <ErrorState message={detail.error instanceof ApiError ? detail.error.message : "Could not load channel details."} onRetry={() => void detail.refetch()} /> : null}
      {item ? (
        <div className="space-y-4 text-[13px]">
          {item.description ? <p className="leading-5 text-slate-600">{item.description}</p> : null}
          <dl className="space-y-2">
            <DetailRow label="Delivery" value={item.delivery.join(", ") || "Not provided"} />
            <DetailRow label="Weight range" value={item.range ?? "Not provided"} />
            <DetailRow label="Volumetric weight" value={item.volumetric ?? "Not provided"} />
          </dl>
          <DetailList title="Regions" empty="No regions returned for this destination.">
            {item.regions.map((region) => (
              <li key={region.name} className="flex items-baseline justify-between gap-3 py-1">
                <span className="font-medium text-ink">{region.name}</span>
                <span className="text-slate-500">{region.eta ?? "Timing not provided"}</span>
              </li>
            ))}
          </DetailList>
          <DetailList title="Restrictions" empty="No order restrictions returned.">
            {item.restrictions.map((rule) => <li key={rule} className="py-1 text-slate-600">{rule}</li>)}
          </DetailList>
          <DetailList title="Services" empty="No extra services returned.">
            {item.services.map((service) => (
              <li key={service.name} className="py-1.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-medium text-ink">{service.name}</span>
                  <span className="text-[12px] text-slate-400">{service.mode}{service.price ? ` · ${service.price}` : ""}</span>
                </div>
                {service.description ? <p className="text-[12px] leading-5 text-slate-500">{service.description}</p> : null}
              </li>
            ))}
          </DetailList>
          {item.rates ? (
            <DetailList title="HioBuy reference rates" empty="No reference rates returned.">
              {item.rates.map((card) => (
                <li key={card.region} className="py-1.5">
                  <div className="font-medium text-ink">{card.region}</div>
                  {card.rows.map((row) => (
                    <div key={`${row.label}-${row.range}`} className="mt-1 flex justify-between gap-3 text-[12px] text-slate-600">
                      <span>{row.label} · {row.range}</span>
                      <span className="tabular-nums">{row.amount}</span>
                    </div>
                  ))}
                </li>
              ))}
            </DetailList>
          ) : null}
          {item.rates ? <p className="text-[12px] leading-5 text-slate-400">These are HioBuy reference rates. The customer price is the quote in the list.</p> : null}
        </div>
      ) : null}
    </Dialog>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right text-ink">{value}</dd>
    </div>
  );
}

function DetailList({ title, empty, children }: { title: string; empty: string; children: ReactNode }) {
  const items = Array.isArray(children) ? children : children ? [children] : [];
  return (
    <section>
      <h3 className="text-[12px] font-semibold tracking-tight text-slate-500">{title}</h3>
      {items.length ? <ul className="mt-1">{children}</ul> : <p className="mt-1 text-slate-400">{empty}</p>}
    </section>
  );
}
