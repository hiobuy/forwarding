/** Developer Guide map. Markdown lives under docs/. The admin page only renders these files. */

export const GUIDE_SECTIONS = [
  "Getting Started",
  "Architecture",
  "Business Workflows",
  "Status Reference",
  "Customization",
  "Troubleshooting",
] as const;

export type GuideSection = (typeof GUIDE_SECTIONS)[number];

export type GuideEntry = {
  slug: string;
  title: string;
  section: GuideSection;
  file: string;
};

export const GUIDE: GuideEntry[] = [
  { slug: "getting-started", title: "Project", section: "Getting Started", file: "getting-started/index.md" },
  { slug: "getting-started/deploy", title: "Deploy and environment", section: "Getting Started", file: "getting-started/deploy.md" },
  { slug: "getting-started/developer-account", title: "HioBuy Developer Account", section: "Getting Started", file: "getting-started/developer-account.md" },
  { slug: "getting-started/api-key", title: "API key and warehouse authorization", section: "Getting Started", file: "getting-started/api-key.md" },
  { slug: "getting-started/wh-dev", title: "WH-DEV test environment", section: "Getting Started", file: "getting-started/wh-dev.md" },
  { slug: "getting-started/demo-admin", title: "Demo Admin Mode", section: "Getting Started", file: "getting-started/demo-admin.md" },
  { slug: "getting-started/public-site", title: "Public website deployment", section: "Getting Started", file: "getting-started/public-site.md" },
  { slug: "getting-started/production", title: "Production checklist", section: "Getting Started", file: "getting-started/production.md" },
  { slug: "architecture/system", title: "System architecture", section: "Architecture", file: "architecture/system.md" },
  { slug: "architecture/responsibilities", title: "Responsibilities", section: "Architecture", file: "architecture/responsibilities.md" },
  { slug: "architecture/data-model", title: "Data model", section: "Architecture", file: "architecture/data-model.md" },
  { slug: "architecture/api-client", title: "API client", section: "Architecture", file: "architecture/api-client.md" },
  { slug: "architecture/sync", title: "Sync tasks and logs", section: "Architecture", file: "architecture/sync.md" },
  { slug: "architecture/wallets", title: "Customer wallet and HioBuy wallet", section: "Architecture", file: "architecture/wallets.md" },
  { slug: "workflows/inbound-notice", title: "Package Pre-alert / Inbound Notice", section: "Business Workflows", file: "workflows/inbound-notice.md" },
  { slug: "workflows/receiving", title: "Warehouse Receiving", section: "Business Workflows", file: "workflows/receiving.md" },
  { slug: "workflows/package-sync", title: "Package Status Sync", section: "Business Workflows", file: "workflows/package-sync.md" },
  { slug: "workflows/shipment-create", title: "Shipment Creation", section: "Business Workflows", file: "workflows/shipment-create.md" },
  { slug: "workflows/quote", title: "Shipping Quote & Markup", section: "Business Workflows", file: "workflows/quote.md" },
  { slug: "workflows/customer-payment", title: "Customer Payment", section: "Business Workflows", file: "workflows/customer-payment.md" },
  { slug: "workflows/hiobuy-pay", title: "HioBuy Pay", section: "Business Workflows", file: "workflows/hiobuy-pay.md" },
  { slug: "workflows/shipping-tracking", title: "Shipping & Tracking", section: "Business Workflows", file: "workflows/shipping-tracking.md" },
  { slug: "workflows/cancel-intercept", title: "Cancellation / Interception", section: "Business Workflows", file: "workflows/cancel-intercept.md" },
  { slug: "workflows/exceptions-refunds", title: "Exceptions & Refunds", section: "Business Workflows", file: "workflows/exceptions-refunds.md" },
  { slug: "statuses/packages", title: "Package lifecycle", section: "Status Reference", file: "statuses/packages.md" },
  { slug: "statuses/shipments", title: "Shipment lifecycle", section: "Status Reference", file: "statuses/shipments.md" },
  { slug: "statuses/payment-and-sync", title: "Payment, interception, and sync", section: "Status Reference", file: "statuses/payment-and-sync.md" },
  { slug: "customization/branding", title: "Branding & Logo", section: "Customization", file: "customization/branding.md" },
  { slug: "customization/pricing", title: "Shipping Pricing", section: "Customization", file: "customization/pricing.md" },
  { slug: "customization/payments", title: "Payment Providers", section: "Customization", file: "customization/payments.md" },
  { slug: "customization/email", title: "Email Templates", section: "Customization", file: "customization/email.md" },
  { slug: "customization/advanced-settings", title: "Advanced settings", section: "Customization", file: "customization/advanced-settings.md" },
  { slug: "customization/customer-portal", title: "Customer Portal", section: "Customization", file: "customization/customer-portal.md" },
  { slug: "customization/admin-ui", title: "Admin UI", section: "Customization", file: "customization/admin-ui.md" },
  { slug: "customization/localization", title: "Localization", section: "Customization", file: "customization/localization.md" },
  { slug: "customization/new-features", title: "Adding New Features", section: "Customization", file: "customization/new-features.md" },
  { slug: "troubleshooting/invalid-api-key", title: "INVALID_API_KEY", section: "Troubleshooting", file: "troubleshooting/invalid-api-key.md" },
  { slug: "troubleshooting/insufficient-scope", title: "INSUFFICIENT_SCOPE", section: "Troubleshooting", file: "troubleshooting/insufficient-scope.md" },
  { slug: "troubleshooting/warehouse-authorization", title: "Warehouse Authorization", section: "Troubleshooting", file: "troubleshooting/warehouse-authorization.md" },
  { slug: "troubleshooting/inbound-sync", title: "Inbound Notice Sync Failed", section: "Troubleshooting", file: "troubleshooting/inbound-sync.md" },
  { slug: "troubleshooting/shipment-sync", title: "Shipment Sync Failed", section: "Troubleshooting", file: "troubleshooting/shipment-sync.md" },
  { slug: "troubleshooting/wallet-balance", title: "Insufficient HioBuy Wallet Balance", section: "Troubleshooting", file: "troubleshooting/wallet-balance.md" },
  { slug: "troubleshooting/payment-mismatch", title: "Payment State Mismatch", section: "Troubleshooting", file: "troubleshooting/payment-mismatch.md" },
  { slug: "troubleshooting/duplicate-webhook", title: "Duplicate Webhook / Retry", section: "Troubleshooting", file: "troubleshooting/duplicate-webhook.md" },
  { slug: "troubleshooting/quote-unavailable", title: "Quote Unavailable", section: "Troubleshooting", file: "troubleshooting/quote-unavailable.md" },
];

export const GUIDE_HOME = "getting-started";

export function guideBySlug(slug: string) {
  return GUIDE.find((entry) => entry.slug === slug) ?? null;
}

export function headingId(text: string, used: Set<string>) {
  const base = text
    .toLowerCase()
    .replace(/[`*_]/g, "")
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-|-$/g, "") || "section";
  let id = base;
  let n = 2;
  while (used.has(id)) {
    id = `${base}-${n}`;
    n += 1;
  }
  used.add(id);
  return id;
}

export type ResolvedHref =
  | { kind: "external"; href: string }
  | { kind: "hash"; hash: string }
  | { kind: "guide"; slug: string; hash: string }
  | { kind: "invalid" };

/** Resolve a markdown link against the file that contains it. */
export function resolveDocHref(fromFile: string, href: string): ResolvedHref {
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith("//")) return { kind: "invalid" };
  if (trimmed.startsWith("#")) return { kind: "hash", hash: decodeURIComponent(trimmed.slice(1)) };
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return { kind: "external", href: trimmed };
  const hashIndex = trimmed.indexOf("#");
  const path = hashIndex === -1 ? trimmed : trimmed.slice(0, hashIndex);
  const hash = hashIndex === -1 ? "" : decodeURIComponent(trimmed.slice(hashIndex + 1));
  const dir = fromFile.includes("/") ? fromFile.slice(0, fromFile.lastIndexOf("/")) : "";
  const parts = [...(dir ? dir.split("/") : []), ...path.split("/")];
  const stack: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!stack.length) return { kind: "invalid" };
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  const file = stack.join("/");
  if (!file.endsWith(".md")) return { kind: "invalid" };
  const entry = GUIDE.find((item) => item.file === file);
  if (!entry) return { kind: "invalid" };
  return { kind: "guide", slug: entry.slug, hash };
}

export function markdownHeadings(markdown: string) {
  const used = new Set<string>();
  const headings: { level: number; text: string; id: string }[] = [];
  let inFence = false;
  for (const line of markdown.split("\n")) {
    if (line.trim().startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = /^(#{1,3})\s+(.+?)\s*$/.exec(line);
    if (!match) continue;
    const text = match[2].replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").trim();
    headings.push({ level: match[1].length, text, id: headingId(text, used) });
  }
  return headings;
}

export function markdownLinks(markdown: string) {
  const links: { href: string }[] = [];
  let inFence = false;
  for (const line of markdown.split("\n")) {
    if (line.trim().startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const pattern = /\[[^\]]+\]\(([^)\s]+)\)/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(line))) links.push({ href: match[1] });
  }
  return links;
}
