export const appConfig = {
  currency: "USD" as const,
  freeStorageDays: 30,
  storageFeeFenPerDay: 200,
  lowBalanceFen: 10000,
  quoteTtlMs: 30 * 60 * 1000,
  checkoutTtlMs: 30 * 60 * 1000,
  supportEmail: "support@hiobuy.com",
};

export const exceptionActions = [
  { code: "ACCEPT", label: "Accept and continue" },
  { code: "INSPECTION", label: "Request inspection" },
  { code: "RETURN", label: "Request return" },
  { code: "DISPOSAL", label: "Request disposal" },
  { code: "SUPPORT", label: "Contact support" },
] as const;
