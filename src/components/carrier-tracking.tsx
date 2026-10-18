import { useQuery } from "@tanstack/react-query";
import { CopyButton, SectionHeading } from "./ui";
import { formatDateTime } from "../domain/dates";
import { api } from "../lib/api";

type CarrierTrack = {
  available: boolean;
  trackingNumber: string | null;
  carrier: string | null;
  events: { at: string; title: string; location: string }[];
};

export function CarrierTracking({ shipmentId, admin }: { shipmentId: string; admin?: boolean }) {
  const query = useQuery({
    queryKey: [admin ? "admin" : "shipment", shipmentId, "carrier-tracking"],
    queryFn: () => api<CarrierTrack>(`${admin ? "/api/admin" : "/api"}/shipments/${shipmentId}/tracking`),
  });
  if (!query.data?.available) return null;
  const item = query.data;
  return (
    <section className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm">
      <SectionHeading title="International tracking" />
      <div className="mt-3 flex items-center gap-1">
        <span className="font-mono text-sm">{item.trackingNumber ?? "Waiting for the carrier number"}</span>
        {item.trackingNumber ? <CopyButton value={item.trackingNumber} label="Copy tracking number" variant="ghost" size="sm" iconOnly /> : null}
      </div>
      {item.carrier ? <p className="mt-1 text-[12px] text-slate-500">{item.carrier}</p> : null}
      {query.isLoading ? <p className="mt-3 text-[13px] text-slate-500">Loading tracking…</p> : null}
      {query.isError ? <p className="mt-3 text-[13px] text-red-700">Tracking could not be loaded.</p> : null}
      {item.events.length ? (
        <ol className="relative mt-4 space-y-3 pl-5 before:absolute before:top-1.5 before:bottom-1.5 before:left-[5px] before:w-px before:bg-slate-200">
          {item.events.map((event, index) => (
            <li key={`${event.at}-${event.title}`} className="relative">
              <span className={`absolute top-1 -left-5 size-[11px] rounded-full border-2 border-white ${index === 0 ? "bg-indigo-500 ring-4 ring-indigo-100" : "bg-slate-300"}`} aria-hidden="true" />
              <div className={`text-[13px] ${index === 0 ? "font-semibold text-ink" : "font-medium text-slate-700"}`}>{event.title}</div>
              <div className="text-[12px] text-slate-500">{[event.location, formatDateTime(event.at)].filter(Boolean).join(" · ")}</div>
            </li>
          ))}
        </ol>
      ) : query.isSuccess ? (
        <p className="mt-3 text-[13px] text-slate-500">No carrier scans yet.</p>
      ) : null}
    </section>
  );
}
