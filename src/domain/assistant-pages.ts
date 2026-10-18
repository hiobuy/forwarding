export const assistantPages = [
  { path: "/app/dashboard", title: "Dashboard", when: "home, what needs attention" },
  { path: "/app/packages", title: "Packages", when: "parcels already in the account" },
  { path: "/app/packages/pre-alert", title: "Package Pre-alert", when: "add a package with a domestic tracking number" },
  { path: "/app/claim-packages", title: "Claim packages", when: "parcels waiting to be claimed" },
  { path: "/app/consolidate", title: "Consolidate and ship", when: "create a shipment" },
  { path: "/app/shipments", title: "Shipments", when: "shipment list and paying freight" },
  { path: "/app/shipping-calculator", title: "Shipping calculator", when: "estimate freight" },
  { path: "/app/warehouse", title: "Warehouse address", when: "China warehouse address" },
  { path: "/app/wallet", title: "Wallet", when: "balance and transactions" },
  { path: "/app/wallet/transfers", title: "Transfer requests", when: "bank transfer status, pending, approved, rejected" },
  { path: "/app/wallet/top-up", title: "Top up", when: "add money, recharge, 充值" },
  { path: "/app/addresses", title: "Addresses", when: "delivery addresses" },
  { path: "/app/invoice-details", title: "Invoice details", when: "billing name and tax id for invoices" },
  { path: "/app/account", title: "Account", when: "profile and password" },
] as const;

export function assistantPage(path: string) {
  return assistantPages.find((page) => page.path === path) ?? null;
}
