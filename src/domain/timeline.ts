export type TimelineEvent = { at: string; title: string; detail: string };

export type SyncMilestone = {
  action: string;
  status: string;
  at: string;
  remoteId: string | null;
};

export type StatusChange = {
  operation: string;
  outcome: string;
  at: string;
  previousStatus: string | null;
  newStatus: string | null;
};

const SHIPMENT_STATUS: Record<string, { title: string; detail: string }> = {
  PENDING: { title: "Processing", detail: "The warehouse is preparing the shipment." },
  WAIT_PAYMENT: { title: "Waiting for payment", detail: "Packing is finished and freight can be paid." },
  WAIT_SHIP: { title: "Ready to ship", detail: "Payment is confirmed and the shipment can leave." },
  SHIPPED: { title: "Shipped", detail: "Handed to the carrier." },
  SIGNED: { title: "Delivered", detail: "The shipment was signed for." },
  CANCELLED: { title: "Cancelled", detail: "The shipment was cancelled." },
};

const PACKAGE_STATUS: Record<string, { title: string; detail: string }> = {
  PENDING: { title: "Waiting for the warehouse", detail: "The parcel has not been received." },
  RECEIVED: { title: "Received", detail: "The warehouse received the parcel." },
  CONSOLIDATED: { title: "Consolidated", detail: "The parcel is in a shipment." },
  SHIPPED: { title: "Shipped", detail: "The parcel left with its shipment." },
  DELIVERED: { title: "Delivered", detail: "The parcel was delivered." },
  TRANSFERRING: { title: "Transferring", detail: "The parcel is moving between warehouses." },
  DISCARDED: { title: "Discarded", detail: "The warehouse discarded the parcel." },
  UNCLAIMED: { title: "Unclaimed", detail: "The parcel is not matched to a member." },
  ARCHIVED: { title: "Archived", detail: "The parcel was archived." },
};

export function mergeTimeline(events: TimelineEvent[]): TimelineEvent[] {
  const seen = new Set<string>();
  return events
    .filter((event) => event.at && !Number.isNaN(Date.parse(event.at)))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .filter((event) => {
      const key = `${event.title}|${event.at}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function earliest<T extends { at: string }>(rows: T[]) {
  return rows.filter((row) => row.at).sort((a, b) => Date.parse(a.at) - Date.parse(b.at))[0] ?? null;
}

/** Business events from sync tasks and status changes. Does not invent a time. */
export function timelineFromSync(input: {
  entity: "package" | "shipment";
  audience: "admin" | "customer";
  milestones: SyncMilestone[];
  changes: StatusChange[];
}): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  const submitted = earliest(
    input.milestones.filter((item) => item.status === "synced" && (item.action === "inbound_create" || item.action === "shipment_create")),
  );
  if (submitted) {
    const warehouse = input.audience === "customer";
    events.push({
      at: submitted.at,
      title: warehouse ? "Submitted to the warehouse" : "Submitted to HioBuy",
      detail: submitted.remoteId ? `Accepted as ${submitted.remoteId}.` : "The warehouse accepted the submission.",
    });
  }
  const paid = earliest(input.milestones.filter((item) => item.action === "shipment_pay" && item.status === "synced"));
  if (paid && input.audience === "admin") {
    events.push({ at: paid.at, title: "HioBuy paid", detail: "The fulfillment wallet payment was confirmed." });
  }
  const labels = input.entity === "shipment" ? SHIPMENT_STATUS : PACKAGE_STATUS;
  for (const change of input.changes) {
    if (change.outcome !== "updated" && change.outcome !== "synced") continue;
    const next = (change.newStatus ?? "").toUpperCase();
    const label = labels[next];
    if (!label || !change.at) continue;
    if (change.previousStatus && change.previousStatus.toUpperCase() === next) continue;
    events.push({ at: change.at, title: label.title, detail: label.detail });
  }
  return events;
}
