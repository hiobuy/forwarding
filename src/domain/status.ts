export const CARGO_ATTRIBUTES = [
  "GENERAL",
  "BATTERY",
  "MAGNETIC",
  "LIQUID",
  "POWDER",
  "SENSITIVE",
] as const;

export type CargoAttribute = (typeof CARGO_ATTRIBUTES)[number];

export type Tone = "success" | "warning" | "danger" | "info" | "neutral";

export type DisplayStatus = {
  key: string;
  label: string;
  tone: Tone;
};

/** HioBuy warehouse package lifecycle. Condition and sync status are separate. */
export const PACKAGE_LIFECYCLE = [
  "PENDING",
  "RECEIVED",
  "CONSOLIDATED",
  "SHIPPED",
  "DELIVERED",
  "TRANSFERRING",
  "DISCARDED",
  "UNCLAIMED",
  "ARCHIVED",
] as const;

export type PackageLifecycle = (typeof PACKAGE_LIFECYCLE)[number];

export type PackageCondition = "NORMAL" | "EXCEPTION";

export type PackageState = {
  packageStatus: PackageLifecycle;
  conditionStatus: PackageCondition;
  exceptionStatus: "NONE" | "ACTION_REQUIRED" | "RESOLVED";
  vasStatus: "NONE" | "REQUESTED" | "PROCESSING" | "COMPLETED" | "CANCELLED";
  lockStatus: "AVAILABLE" | "LOCKED" | "BLOCKED";
  disposition: "NONE" | "RETURN_REQUESTED" | "DISPOSAL_REQUESTED";
};

const CARGO_LABELS: Record<CargoAttribute, string> = {
  GENERAL: "General",
  BATTERY: "Battery",
  MAGNETIC: "Magnetic",
  LIQUID: "Liquid",
  POWDER: "Powder",
  SENSITIVE: "Sensitive",
};

export function cargoLabel(attribute: CargoAttribute): string {
  return CARGO_LABELS[attribute];
}

const LIFECYCLE_LABELS: Record<PackageLifecycle, DisplayStatus> = {
  PENDING: { key: "pending", label: "Pending", tone: "neutral" },
  RECEIVED: { key: "received", label: "Received", tone: "success" },
  CONSOLIDATED: { key: "consolidated", label: "Consolidated", tone: "info" },
  SHIPPED: { key: "shipped", label: "Shipped", tone: "info" },
  DELIVERED: { key: "delivered", label: "Delivered", tone: "success" },
  TRANSFERRING: { key: "transferring", label: "Transferring", tone: "warning" },
  DISCARDED: { key: "discarded", label: "Discarded", tone: "neutral" },
  UNCLAIMED: { key: "unclaimed", label: "Unclaimed", tone: "warning" },
  ARCHIVED: { key: "archived", label: "Archived", tone: "neutral" },
};

/** Warehouse lifecycle only. Exceptions, services, and sync state stay on their own fields. */
export function getPackageDisplayStatus(pkg: PackageState): DisplayStatus {
  return LIFECYCLE_LABELS[pkg.packageStatus] ?? LIFECYCLE_LABELS.PENDING;
}

export function packageEligibility(pkg: PackageState): { eligible: boolean; reason: string | null } {
  if (pkg.packageStatus !== "RECEIVED") {
    return { eligible: false, reason: "Only a received package can be added to a shipment." };
  }
  if (pkg.conditionStatus === "EXCEPTION") {
    return { eligible: false, reason: "This package has an exception that needs your confirmation." };
  }
  if (pkg.exceptionStatus === "ACTION_REQUIRED") {
    return { eligible: false, reason: "This package has an exception that needs your confirmation." };
  }
  if (pkg.vasStatus === "REQUESTED" || pkg.vasStatus === "PROCESSING") {
    return { eligible: false, reason: "This package has an unfinished value-added service." };
  }
  if (pkg.lockStatus === "LOCKED") {
    return { eligible: false, reason: "This package is already locked by another shipment." };
  }
  if (pkg.lockStatus === "BLOCKED") {
    return { eligible: false, reason: "This package is blocked and cannot be consolidated." };
  }
  if (pkg.disposition === "RETURN_REQUESTED") {
    return { eligible: false, reason: "This package is being returned." };
  }
  if (pkg.disposition === "DISPOSAL_REQUESTED") {
    return { eligible: false, reason: "This package is being disposed." };
  }
  return { eligible: true, reason: null };
}

export type CustomerShipmentStatus =
  | "CONSOLIDATING"
  | "WAITING_FOR_WEIGHT"
  | "TO_PAY"
  | "READY_TO_SHIP"
  | "SHIPPED"
  | "IN_TRANSIT"
  | "DELIVERED"
  | "CANCELLED";

const SHIPMENT_LABELS: Record<CustomerShipmentStatus, DisplayStatus> = {
  CONSOLIDATING: { key: "consolidating", label: "Consolidating", tone: "info" },
  WAITING_FOR_WEIGHT: { key: "waiting_for_weight", label: "Waiting for Final Weight", tone: "info" },
  TO_PAY: { key: "to_pay", label: "To Pay", tone: "warning" },
  READY_TO_SHIP: { key: "ready_to_ship", label: "Ready to Ship", tone: "success" },
  SHIPPED: { key: "shipped", label: "Shipped", tone: "info" },
  IN_TRANSIT: { key: "in_transit", label: "In Transit", tone: "info" },
  DELIVERED: { key: "delivered", label: "Delivered", tone: "success" },
  CANCELLED: { key: "cancelled", label: "Cancelled", tone: "neutral" },
};

export function shipmentDisplayStatus(status: CustomerShipmentStatus): DisplayStatus {
  return SHIPMENT_LABELS[status];
}

export const HIOBUY_SHIPMENT_LIFECYCLE = ["PENDING", "WAIT_PAYMENT", "WAIT_SHIP", "SHIPPED", "SIGNED", "CANCELLED"] as const;

export type HiobuyShipmentStatus = (typeof HIOBUY_SHIPMENT_LIFECYCLE)[number];

const HIOBUY_SHIPMENT_LABELS: Record<HiobuyShipmentStatus, DisplayStatus> = {
  PENDING: { key: "pending", label: "Processing", tone: "info" },
  WAIT_PAYMENT: { key: "wait_payment", label: "Awaiting Payment", tone: "warning" },
  WAIT_SHIP: { key: "wait_ship", label: "Ready to Ship", tone: "success" },
  SHIPPED: { key: "shipped", label: "Shipped", tone: "info" },
  SIGNED: { key: "signed", label: "Delivered", tone: "success" },
  CANCELLED: { key: "cancelled", label: "Cancelled", tone: "neutral" },
};

const LOCAL_SHIPMENT_LABELS: Record<CustomerShipmentStatus, string> = {
  CONSOLIDATING: "Local · Packing",
  WAITING_FOR_WEIGHT: "Local · Final weight",
  TO_PAY: "Local · Customer due",
  READY_TO_SHIP: "Local · Ready",
  SHIPPED: "Local · Shipped",
  IN_TRANSIT: "Local · Shipped",
  DELIVERED: "Local · Delivered",
  CANCELLED: "Local · Cancelled",
};

/** Admin label for a HioBuy shipment lifecycle code. Unknown codes are not shown as confirmed. */
export function hiobuyShipmentDisplay(status: string | null | undefined): DisplayStatus | null {
  if (!status) return null;
  const key = status.trim().toUpperCase() as HiobuyShipmentStatus;
  return HIOBUY_SHIPMENT_LABELS[key] ?? null;
}

/**
 * Linked shipments show the HioBuy lifecycle. Unlinked shipments keep a local label
 * so they are not presented as confirmed by HioBuy.
 */
export function adminShipmentStatus(input: { hiobuyShipmentId: string | null; upstreamStatus: string | null; localStatus: CustomerShipmentStatus }): DisplayStatus {
  if (input.hiobuyShipmentId) {
    const remote = hiobuyShipmentDisplay(input.upstreamStatus);
    if (remote) return remote;
  }
  const local = shipmentDisplayStatus(input.localStatus);
  return { key: "local", label: LOCAL_SHIPMENT_LABELS[input.localStatus], tone: local.tone };
}

export const ADMIN_SHIPMENT_FILTERS = [
  { key: "all", label: "All" },
  { key: "pending", label: "Processing" },
  { key: "wait_payment", label: "Awaiting Payment" },
  { key: "wait_ship", label: "Ready to Ship" },
  { key: "shipped", label: "Shipped" },
  { key: "signed", label: "Delivered" },
  { key: "cancelled", label: "Cancelled" },
] as const;

export function adminShipmentMatches(view: DisplayStatus, filter: string) {
  if (filter === "all" || filter === "") return true;
  return view.key === filter;
}

export function customerPaymentLabel(localStatus: CustomerShipmentStatus, hasDueCharge: boolean) {
  if (hasDueCharge || localStatus === "TO_PAY") return "Customer due";
  if (localStatus === "READY_TO_SHIP" || localStatus === "SHIPPED" || localStatus === "IN_TRANSIT" || localStatus === "DELIVERED") return "Customer paid";
  return "Customer not billed";
}

export function hiobuyPaymentLabel(status: string | null | undefined) {
  if (status === "PAID") return "HioBuy paid";
  if (status === "PARTIAL") return "HioBuy partial";
  if (status === "UNPAID") return "HioBuy unpaid";
  return "HioBuy —";
}

export function interceptionDisplay(status: string | null | undefined): DisplayStatus | null {
  if (status === "REQUESTED") return { key: "requested", label: "Intercept requested", tone: "warning" };
  if (status === "PROCESSING") return { key: "processing", label: "Intercepting", tone: "warning" };
  if (status === "INTERCEPTED") return { key: "intercepted", label: "Intercepted", tone: "danger" };
  if (status === "FAILED") return { key: "failed", label: "Intercept failed", tone: "danger" };
  return null;
}

export const PACKAGE_FILTERS = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "received", label: "Received" },
  { key: "consolidated", label: "Consolidated" },
  { key: "shipped", label: "Shipped" },
  { key: "delivered", label: "Delivered" },
  { key: "exception", label: "Exceptions" },
] as const;

export const PACKAGE_MORE_FILTERS = [
  { key: "transferring", label: "Transferring" },
  { key: "discarded", label: "Discarded" },
  { key: "unclaimed", label: "Unclaimed" },
  { key: "archived", label: "Archived" },
] as const;

export const SHIPMENT_FILTERS = [
  { key: "all", label: "All" },
  { key: "consolidating", label: "Consolidating" },
  { key: "to_pay", label: "To Pay" },
  { key: "ready_to_ship", label: "Ready to Ship" },
  { key: "in_transit", label: "In Transit" },
  { key: "completed", label: "Completed" },
] as const;

/** Customer-facing label. Payment Received means the customer paid Forwarding while HioBuy is still WAIT_PAYMENT. */
export function customerShipmentDisplay(input: { status: CustomerShipmentStatus; upstreamStatus: string | null; linked: boolean }): DisplayStatus {
  if (!input.linked) return shipmentDisplayStatus(input.status);
  const remote = (input.upstreamStatus ?? "").trim().toUpperCase();
  const customerPaid = input.status === "READY_TO_SHIP" || input.status === "IN_TRANSIT" || input.status === "SHIPPED" || input.status === "DELIVERED";
  if (remote === "PENDING") return { key: "processing", label: "Processing", tone: "info" };
  if (remote === "WAIT_PAYMENT") {
    return customerPaid
      ? { key: "payment_received", label: "Payment Received", tone: "warning" }
      : { key: "to_pay", label: "To Pay", tone: "warning" };
  }
  if (remote === "WAIT_SHIP") return { key: "ready_to_ship", label: "Ready to Ship", tone: "success" };
  if (remote === "SHIPPED") return { key: "in_transit", label: "In Transit", tone: "info" };
  if (remote === "SIGNED") return { key: "completed", label: "Completed", tone: "success" };
  if (remote === "CANCELLED") return { key: "cancelled", label: "Cancelled", tone: "neutral" };
  return shipmentDisplayStatus(input.status);
}

export function customerShipmentMatches(displayKey: string, filter: string) {
  if (filter === "all" || filter === "") return true;
  if (filter === "consolidating") return displayKey === "consolidating" || displayKey === "processing" || displayKey === "waiting_for_weight";
  if (filter === "to_pay") return displayKey === "to_pay";
  if (filter === "ready_to_ship") return displayKey === "ready_to_ship";
  if (filter === "in_transit") return displayKey === "in_transit" || displayKey === "shipped";
  if (filter === "completed") return displayKey === "completed" || displayKey === "delivered";
  return displayKey === filter;
}
