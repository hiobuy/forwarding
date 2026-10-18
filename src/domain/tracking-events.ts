/** Stable HioBuy fulfillment tracking codes. Display text is local; the API title is not shown. */
export const TRACKING_EVENT_CODES = [
  "SHIPMENT_CREATED",
  "SHIPMENT_PACKED",
  "SHIPMENT_PAID",
  "SHIPMENT_DISPATCHED",
  "SHIPMENT_SIGNED",
  "SHIPMENT_CANCELLED",
  "SHIPMENT_INTERCEPTION_REQUESTED",
  "SHIPMENT_INTERCEPTION_PROCESSING",
  "SHIPMENT_INTERCEPTION_SUCCEEDED",
  "SHIPMENT_INTERCEPTION_FAILED",
  "PICKUP_STATION_ARRIVED",
  "PICKUP_STATION_SHELVED",
  "PICKUP_STATION_CHECKED_OUT",
  "PICKUP_STATION_TRANSFERRED_OUT",
  "DISTRIBUTION_CENTER_SORTED",
] as const;

export type TrackingEventCode = (typeof TRACKING_EVENT_CODES)[number];

export const DEFAULT_TRACKING_EVENT_LABELS: Record<TrackingEventCode, string> = {
  SHIPMENT_CREATED: "Shipment created",
  SHIPMENT_PACKED: "Packed",
  SHIPMENT_PAID: "Paid",
  SHIPMENT_DISPATCHED: "Dispatched",
  SHIPMENT_SIGNED: "Delivered",
  SHIPMENT_CANCELLED: "Cancelled",
  SHIPMENT_INTERCEPTION_REQUESTED: "Intercept requested",
  SHIPMENT_INTERCEPTION_PROCESSING: "Intercept in progress",
  SHIPMENT_INTERCEPTION_SUCCEEDED: "Intercepted",
  SHIPMENT_INTERCEPTION_FAILED: "Intercept failed",
  PICKUP_STATION_ARRIVED: "Arrived at pickup point",
  PICKUP_STATION_SHELVED: "Shelved at pickup point",
  PICKUP_STATION_CHECKED_OUT: "Collected from pickup point",
  PICKUP_STATION_TRANSFERRED_OUT: "Left the pickup point",
  DISTRIBUTION_CENTER_SORTED: "Sorted at distribution center",
};

export function isTrackingEventCode(value: string): value is TrackingEventCode {
  return (TRACKING_EVENT_CODES as readonly string[]).includes(value);
}

/** Saved labels override the preset. A blank or unknown code uses the preset, never the upstream title. */
export function resolveTrackingLabels(raw: string | null | undefined): Record<TrackingEventCode, string> {
  let parsed: unknown = {};
  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = {};
    }
  }
  const stored = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  const labels = { ...DEFAULT_TRACKING_EVENT_LABELS };
  for (const code of TRACKING_EVENT_CODES) {
    const value = stored[code];
    if (typeof value === "string" && value.trim()) labels[code] = value.trim().slice(0, 80);
  }
  return labels;
}

export function labelTrackingEvent(code: string, labels: Record<string, string>) {
  if (isTrackingEventCode(code) && labels[code]?.trim()) return labels[code].trim();
  if (isTrackingEventCode(code)) return DEFAULT_TRACKING_EVENT_LABELS[code];
  return "Tracking update";
}
