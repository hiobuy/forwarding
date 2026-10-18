/** Safe mail copy. Placeholders are replaced as text. Nothing here is evaluated. */

export const EMAIL_VARIABLES = [
  "name",
  "customer_name",
  "platformName",
  "business_name",
  "actionUrl",
  "verification_url",
  "support_email",
  "expiration_minutes",
  "detail",
  "package_number",
  "shipment_number",
] as const;

const ACCOUNT_VARS = ["name", "customer_name", "platformName", "business_name", "actionUrl", "verification_url", "support_email", "expiration_minutes"] as const;
const BUSINESS_VARS = [...ACCOUNT_VARS, "detail", "package_number", "shipment_number"] as const;

export const EMAIL_TEMPLATES = [
  { id: "welcome", name: "Welcome Email", variables: ACCOUNT_VARS },
  { id: "verification", name: "Verify Email Address", variables: ACCOUNT_VARS },
  { id: "verify_new_email", name: "Verify New Email Address", variables: ACCOUNT_VARS },
  { id: "email_changed", name: "Email Address Changed", variables: ACCOUNT_VARS },
  { id: "password_reset", name: "Password Reset", variables: ACCOUNT_VARS },
  { id: "package_received", name: "Package Received", variables: BUSINESS_VARS },
  { id: "action_required", name: "Action Required", variables: BUSINESS_VARS },
  { id: "service_completed", name: "Service Completed", variables: BUSINESS_VARS },
  { id: "payment_due", name: "Shipment Payment Required", variables: BUSINESS_VARS },
  { id: "shipment_shipped", name: "Shipment Shipped", variables: BUSINESS_VARS },
  { id: "shipment_delivered", name: "Shipment Delivered", variables: BUSINESS_VARS },
  { id: "wallet_topup", name: "Wallet Top-up Successful", variables: ["name", "platformName", "detail", "actionUrl"] },
  { id: "bank_submitted", name: "Bank Transfer Submitted", variables: ["name", "platformName", "detail", "actionUrl"] },
  { id: "bank_approved", name: "Bank Transfer Approved", variables: ["name", "platformName", "detail", "actionUrl"] },
  { id: "bank_rejected", name: "Bank Transfer Rejected", variables: ["name", "platformName", "detail", "actionUrl"] },
  { id: "shipping_paid", name: "Shipping Payment Successful", variables: ["name", "platformName", "detail", "actionUrl"] },
  { id: "payment_failed", name: "Payment Failed", variables: ["name", "platformName", "detail", "actionUrl"] },
  { id: "refund_completed", name: "Refund Completed", variables: ["name", "platformName", "detail", "actionUrl"] },
] as const;

export type EmailTemplateId = (typeof EMAIL_TEMPLATES)[number]["id"];

export const BUSINESS_EMAIL_EVENTS = [
  { event: "package.received", template: "package_received", label: "Package received", preference: "packageReceived" },
  { event: "package.exception", template: "action_required", label: "Action required", preference: "actionRequired" },
  { event: "vas.completed", template: "service_completed", label: "Service completed", preference: "vasCompleted" },
  { event: "shipment.payment_due", template: "payment_due", label: "Payment due", preference: "paymentDue" },
  { event: "shipment.shipped", template: "shipment_shipped", label: "Shipment shipped", preference: "shipmentShipped" },
  { event: "shipment.delivered", template: "shipment_delivered", label: "Shipment delivered", preference: "shipmentDelivered" },
  { event: "wallet.topup", template: "wallet_topup", label: "Wallet top-up", preference: "paymentDue" },
  { event: "bank.submitted", template: "bank_submitted", label: "Bank transfer submitted", preference: "paymentDue" },
  { event: "bank.approved", template: "bank_approved", label: "Bank transfer approved", preference: "paymentDue" },
  { event: "bank.rejected", template: "bank_rejected", label: "Bank transfer rejected", preference: "paymentDue" },
  { event: "shipping.paid", template: "shipping_paid", label: "Shipping payment", preference: "paymentDue" },
  { event: "payment.failed", template: "payment_failed", label: "Payment failed", preference: "paymentDue" },
  { event: "refund.completed", template: "refund_completed", label: "Refund completed", preference: "paymentDue" },
] as const;

const DEFAULTS: Record<EmailTemplateId, { subject: string; body: string }> = {
  welcome: {
    subject: "Welcome to {{business_name}}",
    body: "Hello {{customer_name}},\n\nYour forwarding account is ready. Verify your email if you have not already, then use your member code on parcels sent to the warehouse.\n\n{{actionUrl}}",
  },
  verification: {
    subject: "Verify your {{business_name}} email",
    body: "Hello {{customer_name}},\n\nConfirm this email address to start forwarding. This link expires in {{expiration_minutes}} minutes and works once.\n\n{{verification_url}}",
  },
  verify_new_email: {
    subject: "Confirm your new {{business_name}} email",
    body: "Hello {{customer_name}},\n\nConfirm {{detail}} as your sign-in email. Until you open this link, your current email stays active. The link expires in {{expiration_minutes}} minutes and works once.\n\n{{verification_url}}",
  },
  email_changed: {
    subject: "Your {{business_name}} email was changed",
    body: "Hello {{customer_name}},\n\nThe sign-in email for this account is now {{detail}}. If you did not make this change, contact {{support_email}}.",
  },
  password_reset: {
    subject: "Reset your {{business_name}} password",
    body: "Hello {{customer_name}},\n\nUse this link to choose a new password. It expires in {{expiration_minutes}} minutes and works once.\n\n{{verification_url}}",
  },
  package_received: {
    subject: "Package {{package_number}} received",
    body: "Hello {{customer_name}},\n\n{{detail}}\n\n{{actionUrl}}",
  },
  action_required: {
    subject: "A package needs your decision",
    body: "Hello {{name}},\n\n{{detail}}\n\n{{actionUrl}}",
  },
  service_completed: {
    subject: "Warehouse service completed",
    body: "Hello {{name}},\n\n{{detail}}\n\n{{actionUrl}}",
  },
  payment_due: {
    subject: "Shipment {{shipment_number}} is ready to pay",
    body: "Hello {{customer_name}},\n\n{{detail}}\n\n{{actionUrl}}",
  },
  shipment_shipped: {
    subject: "Shipment {{shipment_number}} is on the way",
    body: "Hello {{customer_name}},\n\n{{detail}}\n\n{{actionUrl}}",
  },
  shipment_delivered: {
    subject: "Shipment {{shipment_number}} was delivered",
    body: "Hello {{customer_name}},\n\n{{detail}}\n\n{{actionUrl}}",
  },
  wallet_topup: { subject: "Wallet topped up", body: "Hello {{name}},\n\n{{detail}}\n\n{{actionUrl}}" },
  bank_submitted: { subject: "Bank transfer received for review", body: "Hello {{name}},\n\n{{detail}}\n\n{{actionUrl}}" },
  bank_approved: { subject: "Bank transfer added to your wallet", body: "Hello {{name}},\n\n{{detail}}\n\n{{actionUrl}}" },
  bank_rejected: { subject: "Bank transfer was not confirmed", body: "Hello {{name}},\n\n{{detail}}\n\n{{actionUrl}}" },
  shipping_paid: { subject: "Freight payment received", body: "Hello {{name}},\n\n{{detail}}\n\n{{actionUrl}}" },
  payment_failed: { subject: "A payment needs attention", body: "Hello {{name}},\n\n{{detail}}\n\n{{actionUrl}}" },
  refund_completed: { subject: "Refund completed", body: "Hello {{name}},\n\n{{detail}}\n\n{{actionUrl}}" },
};

export function defaultTemplate(id: EmailTemplateId) {
  return DEFAULTS[id];
}

export function isTemplateId(value: string): value is EmailTemplateId {
  return value in DEFAULTS;
}

const LINK_REQUIRED = new Set<EmailTemplateId>(["verification", "password_reset", "verify_new_email"]);

export function templateProblem(id: string, body: string): string | null {
  if (!isTemplateId(id) || !LINK_REQUIRED.has(id)) return null;
  if (/\{\{\s*(actionUrl|verification_url)\s*\}\}/.test(body)) return null;
  return "This email must include the verification link.";
}

export function mailVariables(input: Record<string, string | null | undefined>, supportEmail = "") {
  const name = input.name || input.customer_name || "there";
  const actionUrl = input.actionUrl || input.verification_url || "";
  const platformName = input.platformName || input.business_name || "";
  const vars: Record<string, string> = {};
  for (const key of EMAIL_VARIABLES) vars[key] = "";
  vars.name = name;
  vars.customer_name = name;
  vars.platformName = platformName;
  vars.business_name = platformName;
  vars.actionUrl = actionUrl;
  vars.verification_url = actionUrl;
  vars.support_email = input.support_email || supportEmail;
  vars.expiration_minutes = input.expiration_minutes || "60";
  vars.detail = input.detail || "";
  vars.package_number = input.package_number || "";
  vars.shipment_number = input.shipment_number || "";
  return vars;
}

export function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function headerSafe(value: string) {
  return value.replace(/[\r\n]+/g, " ").trim().slice(0, 200);
}

export function safeHttpUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Reject hosts that would point SMTP at the local machine or a private network. */
export function smtpHostProblem(host: string): string | null {
  const value = host.trim().toLowerCase().replace(/\.$/, "");
  if (!value || value.length > 253 || /[\s/\\@]/.test(value)) return "Enter a public SMTP hostname.";
  if (value === "localhost" || value.endsWith(".localhost") || value.endsWith(".local") || value.endsWith(".internal") || value === "metadata.google.internal") {
    return "That SMTP host is not allowed.";
  }
  if (value.includes(":")) {
    const bare = value.replace(/^\[|\]$/g, "");
    if (bare === "::1" || bare.startsWith("fe80:") || bare.startsWith("fc") || bare.startsWith("fd")) return "That SMTP host is not allowed.";
    return null;
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) {
    const parts = value.split(".").map(Number);
    if (parts.some((part) => part > 255)) return "Enter a public SMTP hostname.";
    const [a, b] = parts;
    const blocked = a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
    if (blocked) return "That SMTP host is not allowed.";
  }
  return null;
}

export function renderTemplate(input: {
  subject: string;
  body: string;
  vars: Record<string, string>;
  platformName: string;
  logoUrl: string | null;
  appUrl: string | null;
  primaryColor?: string;
  supportEmail?: string;
  websiteUrl?: string | null;
}) {
  const color = input.primaryColor && /^#[0-9A-Fa-f]{6}$/.test(input.primaryColor) ? input.primaryColor : "#4F46E5";
  const vars = mailVariables({ ...input.vars, platformName: input.vars.platformName || input.platformName }, input.supportEmail);
  const subject = headerSafe(fill(input.subject, vars, false, color));
  const text = fill(input.body, vars, false, color);
  const htmlBody = fill(escapeHtml(input.body), vars, true, color).replaceAll("\n", "<br>");
  const logo = input.logoUrl ? safeHttpUrl(input.logoUrl) : null;
  const home = input.appUrl ? safeHttpUrl(input.appUrl) : null;
  const site = input.websiteUrl ? safeHttpUrl(input.websiteUrl) : null;
  const support = input.supportEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.supportEmail) ? input.supportEmail : "";
  const footer = [
    home ? `<a href="${escapeHtml(home)}" style="color:${color};text-decoration:none">${escapeHtml(input.platformName)}</a>` : "",
    site ? `<a href="${escapeHtml(site)}" style="color:#64748b;text-decoration:none">${escapeHtml(new URL(site).host)}</a>` : "",
    support ? escapeHtml(support) : "",
  ].filter(Boolean);
  const html = `<!doctype html><html><body style="margin:0;background:#f6f7f8;color:#121826;font-family:Inter,Arial,sans-serif"><div style="max-width:560px;margin:0 auto;padding:32px 20px"><div style="background:#fff;border:1px solid #e6e8ee;border-radius:12px;padding:28px">${logo ? `<img src="${escapeHtml(logo)}" alt="" width="120" style="display:block;margin:0 0 20px;max-width:120px;height:auto">` : `<div style="font-weight:600;margin-bottom:20px;color:${color}">${escapeHtml(input.platformName)}</div>`}<div style="font-size:15px;line-height:1.6">${htmlBody}</div>${footer.length ? `<p style="margin:24px 0 0;font-size:12px;color:#64748b">${footer.join(" · ")}</p>` : ""}</div></div></body></html>`;
  return { subject, text, html };
}

function fill(source: string, vars: Record<string, string>, html: boolean, color: string) {
  return source.replace(/\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g, (match, key: string) => {
    if (!(EMAIL_VARIABLES as readonly string[]).includes(key)) return match;
    const raw = vars[key] ?? "";
    if (key === "actionUrl" || key === "verification_url") {
      const url = safeHttpUrl(raw);
      if (!url) return "";
      return html ? `<a href="${escapeHtml(url)}" style="display:inline-block;margin-top:16px;background:${color};color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:8px">${escapeHtml(url)}</a>` : url;
    }
    return html ? escapeHtml(raw) : raw.replace(/[\r\n]+/g, "\n");
  });
}
