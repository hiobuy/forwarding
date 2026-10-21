/** Fixed staff roles. There is no custom role editor. */

export const STAFF_ROLES = ["owner", "manager", "support"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const PERMISSIONS = [
  "team.manage",
  "secrets.write",
  "settings.read",
  "settings.write",
  "business.write",
  "payments.read",
  "payments.money",
  "earnings.read",
  "wallet.read",
  "fulfillment.read",
  "fulfillment.write",
  "customers.read",
  "packages.read",
  "packages.write",
  "packages.exception",
  "shipments.read",
  "shipments.write",
  "shipments.pay",
  "assistant.write",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const MANAGER: readonly Permission[] = [
  "settings.read",
  "payments.read",
  "payments.money",
  "earnings.read",
  "wallet.read",
  "fulfillment.read",
  "fulfillment.write",
  "customers.read",
  "packages.read",
  "packages.write",
  "packages.exception",
  "shipments.read",
  "shipments.write",
  "shipments.pay",
  "assistant.write",
];

const SUPPORT: readonly Permission[] = [
  "customers.read",
  "packages.read",
  "packages.exception",
  "shipments.read",
  "assistant.write",
];

const ROLE_PERMISSIONS: Record<Exclude<StaffRole, "owner">, ReadonlySet<Permission>> = {
  manager: new Set(MANAGER),
  support: new Set(SUPPORT),
};

export function isStaffRole(value: string): value is StaffRole {
  return (STAFF_ROLES as readonly string[]).includes(value);
}

export function can(role: StaffRole, permission: Permission): boolean {
  if (role === "owner") return true;
  return ROLE_PERMISSIONS[role].has(permission);
}

export function permissionsOf(role: StaffRole): Permission[] {
  if (role === "owner") return [...PERMISSIONS];
  return PERMISSIONS.filter((permission) => ROLE_PERMISSIONS[role].has(permission));
}

/** True when this change would leave the workspace with no active owner. */
export function lastOwnerBlocked(input: {
  activeOwnerCount: number;
  targetRole: StaffRole;
  targetStatus: "active" | "disabled";
  action: "role" | "disable" | "remove";
  nextRole?: StaffRole;
}): boolean {
  if (input.targetRole !== "owner" || input.targetStatus !== "active") return false;
  if (input.activeOwnerCount > 1) return false;
  if (input.action === "role" && input.nextRole === "owner") return false;
  return true;
}

export function inviteState(invite: { usedAt: number | null; expiresAt: number }, now: number): "open" | "used" | "expired" {
  if (invite.usedAt != null) return "used";
  if (invite.expiresAt <= now) return "expired";
  return "open";
}

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type Gate = Permission | "staff" | "deny";

const RULES: { method?: string; re: RegExp; permission: Exclude<Gate, "deny"> }[] = [
  { method: "GET", re: /^\/me$/, permission: "staff" },
  { re: /^\/team\/[^/]+\/reset-2fa$/, permission: "team.manage" },
  { re: /^\/team(\/|$)/, permission: "team.manage" },
  { re: /^\/email(\/|$)/, permission: "secrets.write" },
  { re: /^\/payments\/settings(\/|$)/, permission: "secrets.write" },
  { method: "POST", re: /^\/payments\/topups\/[^/]+$/, permission: "payments.money" },
  { method: "POST", re: /^\/payments\/[^/]+\/refund$/, permission: "payments.money" },
  { method: "POST", re: /^\/payments\/[^/]+\/retry-hiobuy$/, permission: "payments.money" },
  { method: "GET", re: /^\/payments(\/|$)/, permission: "payments.read" },
  { method: "GET", re: /^\/settings\/fulfillment-sync(\/|$)/, permission: "fulfillment.read" },
  { re: /^\/settings\/fulfillment-sync(\/|$)/, permission: "fulfillment.write" },
  { method: "PUT", re: /^\/settings\/hiobuy-webhook$/, permission: "secrets.write" },
  { method: "GET", re: /^\/settings\/hiobuy-webhook$/, permission: "fulfillment.read" },
  { method: "DELETE", re: /^\/settings\/hiobuy-webhook\/balance-alert$/, permission: "fulfillment.write" },
  { method: "GET", re: /^\/settings\/locale$/, permission: "settings.read" },
  { method: "PUT", re: /^\/settings\/locale$/, permission: "settings.write" },
  { method: "GET", re: /^\/settings\/tracking-events$/, permission: "settings.read" },
  { method: "PUT", re: /^\/settings\/tracking-events$/, permission: "settings.write" },
  { method: "GET", re: /^\/settings\/business$/, permission: "settings.read" },
  { re: /^\/settings\/business(\/|$)/, permission: "business.write" },
  { method: "GET", re: /^\/settings\/invoicing(\/|$)/, permission: "settings.read" },
  { re: /^\/settings\/invoicing(\/|$)/, permission: "settings.write" },
  { re: /^\/settings\/advanced(\/|$)/, permission: "secrets.write" },
  { method: "GET", re: /^\/settings\/hiobuy-wallet(\/|$)/, permission: "wallet.read" },
  { method: "PUT", re: /^\/settings\/package-sync$/, permission: "settings.write" },
  { method: "PUT", re: /^\/settings\/api-key$/, permission: "secrets.write" },
  { method: "PUT", re: /^\/settings\/pricing$/, permission: "settings.write" },
  { method: "POST", re: /^\/settings\/connect$/, permission: "secrets.write" },
  { method: "POST", re: /^\/settings\/test$/, permission: "fulfillment.write" },
  { method: "PUT", re: /^\/settings\/countries(\/|$)/, permission: "settings.write" },
  { method: "POST", re: /^\/settings\/sync\/(channels|warehouse)$/, permission: "fulfillment.write" },
  { method: "GET", re: /^\/settings$/, permission: "settings.read" },
  { method: "GET", re: /^\/overview$/, permission: "staff" },
  { method: "GET", re: /^\/earnings$/, permission: "earnings.read" },
  { re: /^\/calculator(\/|$)/, permission: "staff" },
  { method: "POST", re: /^\/packages\/[^/]+\/exception$/, permission: "packages.exception" },
  { method: "GET", re: /^\/packages(\/|$)/, permission: "packages.read" },
  { method: "GET", re: /^\/vas\/catalog$/, permission: "packages.read" },
  { re: /^\/packages(\/|$)/, permission: "packages.write" },
  { re: /^\/shipments\/hiobuy-pay$/, permission: "shipments.pay" },
  { re: /^\/shipments\/[^/]+\/hiobuy-pay$/, permission: "shipments.pay" },
  { method: "POST", re: /^\/shipments\/[^/]+\/earnings\//, permission: "payments.money" },
  { method: "GET", re: /^\/shipments(\/|$)/, permission: "shipments.read" },
  { re: /^\/shipments(\/|$)/, permission: "shipments.write" },
  { method: "GET", re: /^\/documents\/[^/]+\/pdf$/, permission: "shipments.read" },
  { method: "POST", re: /^\/documents\/[^/]+\/void$/, permission: "shipments.write" },
  { method: "POST", re: /^\/users\/[^/]+\/wallet$/, permission: "payments.money" },
  { method: "GET", re: /^\/users(\/|$)/, permission: "customers.read" },
  { method: "GET", re: /^\/assistant$/, permission: "staff" },
  { re: /^\/assistant(\/|$)/, permission: "assistant.write" },
];

export function adminPath(path: string): string {
  const clean = path.split("?")[0] ?? "/";
  const marker = "/api/admin";
  const index = clean.indexOf(marker);
  const rest = (index >= 0 ? clean.slice(index + marker.length) : clean) || "/";
  return rest.length > 1 && rest.endsWith("/") ? rest.slice(0, -1) : rest;
}

/** Permission required for an admin route. `staff` means any active staff member. Unknown routes are denied. */
export function permissionFor(method: string, path: string): Gate {
  const verb = method.toUpperCase();
  const normalized = adminPath(path);
  for (const rule of RULES) {
    if (rule.method && rule.method !== verb) continue;
    if (rule.re.test(normalized)) return rule.permission;
  }
  return "deny";
}
