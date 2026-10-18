import { useQuery } from "@tanstack/react-query";
import { Ban, ClipboardList, PackageCheck } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Card, CopyButton, ErrorState, LoadingBlock, Notice, PageHeader } from "../../components/ui";
import { api } from "../../lib/api";
import type { Warehouse } from "../../types/api";

export function WarehousePage() {
  const query = useQuery({ queryKey: ["warehouse"], queryFn: () => api<Warehouse>("/api/warehouse") });
  const warehouse = query.data;
  if (query.isLoading) return <LoadingBlock rows={4} />;
  if (!warehouse) return <ErrorState message="Could not load the warehouse address." onRetry={() => void query.refetch()} />;
  if (!warehouse.available) {
    return (
      <div className="max-w-3xl">
        <PageHeader title="Warehouse address" subtitle="The China warehouse address appears here after HioBuy is connected." />
        <Notice tone="warning">
          No warehouse address is available yet. Your member code is <strong className="font-mono">{warehouse.memberCode}</strong>. Don't ship to a placeholder address.
        </Notice>
      </div>
    );
  }

  // In the order Chinese seller forms usually ask for them.
  const fields = [
    { label: "Recipient", value: warehouse.recipient, highlight: true },
    { label: "Phone", value: warehouse.phone },
    { label: "Province", value: warehouse.province },
    { label: "City", value: warehouse.city },
    { label: "District", value: warehouse.district },
    { label: "Street address", value: warehouse.street },
    { label: "Postal code", value: warehouse.postalCode },
  ];

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Warehouse address"
        subtitle="Use this as the shipping address when you buy from Chinese sellers."
        action={<CopyButton value={warehouse.fullAddress} label="Copy full address" copiedLabel="Address copied" variant="primary" />}
      />
      <Notice tone="warning">
        <strong>Always include your member code {warehouse.memberCode}.</strong> It's how the warehouse matches the parcel to you. Parcels without it end up under Claim Packages.
      </Notice>
      <Card className="mt-4 p-0 sm:p-0">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-5">
          <div>
            <div className="text-[12px] text-slate-500">{warehouse.name}</div>
            <div className="font-mono text-2xl font-semibold tracking-tight">{warehouse.memberCode}</div>
          </div>
          <CopyButton value={warehouse.memberCode} label="Copy code" variant="secondary" size="sm" />
        </div>
        <dl className="divide-y divide-slate-100">
          {fields.map((field) => (
            <div key={field.label} className={`flex items-center gap-3 px-4 py-2.5 sm:px-5 ${field.highlight ? "bg-amber-50/50" : ""}`}>
              <dt className="w-40 shrink-0 text-[12px] text-slate-500 sm:w-48">{field.label}</dt>
              <dd className="min-w-0 flex-1 text-[13px] font-medium break-words text-ink">{field.value}</dd>
              <CopyButton value={field.value} label={`Copy ${field.label}`} variant="ghost" size="sm" iconOnly />
            </div>
          ))}
        </dl>
        <div className="grid gap-3 border-t border-slate-100 bg-slate-50/60 px-4 py-3 text-[13px] sm:grid-cols-2 sm:px-5">
          <div>
            <div className="text-[12px] text-slate-500">Working hours</div>
            <div className="mt-0.5 font-medium">{warehouse.hours}</div>
          </div>
          <div>
            <div className="text-[12px] text-slate-500">Free storage</div>
            <div className="mt-0.5 font-medium">{warehouse.freeStorageDays} days from the day it's received</div>
          </div>
        </div>
      </Card>
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <RuleList icon={PackageCheck} title="Receiving rules" items={warehouse.receivingRules} />
        <RuleList icon={Ban} title="Prohibited items" items={warehouse.prohibitedItems} tone="danger" />
        <RuleList icon={ClipboardList} title="Inbound notes" items={warehouse.inboundNotes} />
      </div>
    </div>
  );
}

function RuleList({ icon: Icon, title, items, tone }: { icon: LucideIcon; title: string; items: string[]; tone?: "danger" }) {
  return (
    <Card>
      <h2 className="flex items-center gap-2 text-[13px] font-semibold">
        <Icon size={15} className={tone === "danger" ? "text-red-500" : "text-slate-400"} aria-hidden="true" />
        {title}
      </h2>
      <ul className="mt-2.5 space-y-1.5 text-[13px] leading-5 text-slate-600">
        {items.map((rule) => (
          <li key={rule} className="flex gap-2">
            <span className={`mt-2 size-1 shrink-0 rounded-full ${tone === "danger" ? "bg-red-400" : "bg-slate-300"}`} aria-hidden="true" />
            {rule}
          </li>
        ))}
      </ul>
    </Card>
  );
}
