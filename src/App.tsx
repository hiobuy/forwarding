import { Navigate, Outlet, Route, Routes } from "react-router";
import { brandHomeHref, homeDecision } from "./domain/site";
import { BrandLockup, marketingAccent, useBrand, useSiteMode } from "./lib/brand";
import { LocaleSwitch, useI18n } from "./lib/i18n";
import { authClient } from "./lib/auth";
import { AppShell } from "./layouts/AppShell";
import { AccountPage } from "./features/account/AccountPage";
import { InvoiceDetailsPage } from "./features/account/InvoiceDetailsPage";
import { AddressesPage } from "./features/addresses/AddressesPage";
import { ForgotPage, LoginPage, RegisterPage, ResetPage, VerifyPage, ConfirmEmailPage } from "./features/auth/AuthPages";
import { InvitePage } from "./features/auth/InvitePage";
import { CalculatorPage } from "./features/calculator/CalculatorPage";
import { HomePage } from "./features/site/HomePage";
import { PrivacyPolicyPage, TermsOfServicePage } from "./features/site/LegalPages";
import { Ms } from "./features/site/icon";
import { CheckoutPage, CheckoutReturnPage } from "./features/checkout/CheckoutPage";
import { ClaimsPage } from "./features/claims/ClaimsPage";
import { ConsolidatePage } from "./features/consolidation/ConsolidatePage";
import { DashboardPage } from "./features/dashboard/DashboardPage";
import { PackageDetailPage, PackagesPage, PrealertPage } from "./features/packages/PackagePages";
import { ShipmentDetailPage, ShipmentsPage } from "./features/shipments/ShipmentPages";
import { WalletPage, TopUpPage, TransferRequestsPage } from "./features/wallet/WalletPages";
import { WarehousePage } from "./features/warehouse/WarehousePage";
import { AdminAssistant } from "./features/admin/AdminAssistant";
import { AdminCalculator } from "./features/admin/AdminCalculator";
import { AdminPayments } from "./features/admin/AdminPayments";
import { AdminOverview } from "./features/admin/AdminOverview";
import { AdminPackageDetail } from "./features/admin/AdminPackageDetail";
import { AdminPackages } from "./features/admin/AdminPackages";
import { RequireAdmin, RequireDemo } from "./features/admin/AdminShell";
import { AdminShipmentDetail } from "./features/admin/AdminShipmentDetail";
import { AdminShipments } from "./features/admin/AdminShipments";
import { AdminSettings } from "./features/admin/AdminSettings";
import { AdminGuide } from "./features/admin/AdminGuide";
import { AdminUsers } from "./features/admin/AdminUsers";

function FullScreenStatus({ label }: { label: string }) {
  const { t } = useI18n();
  return (
    <div className="grid min-h-screen place-items-center text-sm text-slate-500" role="status">
      {t(label)}
    </div>
  );
}

function RequireAuth() {
  const { data, isPending } = authClient.useSession();
  if (isPending) return <FullScreenStatus label="Loading your workspace…" />;
  if (!data) return <Navigate to="/auth/login" replace />;
  return <AppShell />;
}

function GuestOnly() {
  const { data, isPending } = authClient.useSession();
  if (isPending) return <FullScreenStatus label="Loading…" />;
  if (data) return <Navigate to="/app/dashboard" replace />;
  return <AuthOutlet />;
}

function AuthOutlet() {
  const { t } = useI18n();
  const brand = useBrand();
  const site = useSiteMode();
  const { data } = authClient.useSession();
  const home = site.ready ? brandHomeHref({ mode: site.mode, publicUrl: brand.website.publicUrl, signedIn: Boolean(data) }) : brand.website.publicUrl || undefined;
  const help = brand.supportEmail ? `mailto:${brand.supportEmail}` : brand.website.supportUrl || "";
  return (
    <div className="flex min-h-dvh flex-col bg-slate-50 text-slate-800 lg:flex-row" style={marketingAccent(brand)}>
      <aside aria-label={t("How forwarding works")} className="auth-grid relative flex min-h-[420px] flex-1 flex-col justify-between overflow-hidden p-8 text-white sm:p-12 lg:min-h-dvh lg:p-16">
        <div aria-hidden="true" className="pointer-events-none absolute -top-32 -left-32 size-96 rounded-full bg-teal-500/10 blur-3xl" />
        <div aria-hidden="true" className="pointer-events-none absolute right-0 -bottom-32 h-[480px] w-[480px] rounded-full bg-teal-600/15 blur-[120px]" />
        <div className="relative z-10">
          <BrandLockup tone="light" href={home} />
        </div>
        <div className="relative z-10 my-10 max-w-xl lg:my-0">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-teal-500/20 bg-teal-900/40 px-3 py-1.5 text-xs font-medium text-teal-300">
            <span className="size-2 animate-pulse rounded-full bg-teal-400" />
            {t("China warehouse address")}
          </div>
          <h1 className="text-3xl leading-[1.18] font-extrabold tracking-tight text-white sm:text-4xl lg:text-5xl">
            {t("Your China warehouse,")}{" "}
            <span className="bg-gradient-to-r from-teal-200 via-teal-100 to-emerald-300 bg-clip-text text-transparent">{t("then the shipment.")}</span>
          </h1>
          <p className="mt-5 text-base leading-relaxed text-slate-300 sm:text-lg">{t("Add domestic parcels, consolidate what is ready, and pay freight after the warehouse finishes packing.")}</p>
        </div>
        <ol className="relative z-10 grid grid-cols-1 gap-6 border-t border-slate-800/80 pt-8 md:grid-cols-3">
          <li><span className="font-mono text-xs font-semibold tracking-wider text-teal-400">01</span><p className="mt-2 text-sm font-medium text-slate-300">{t("Copy the warehouse address with your member code.")}</p></li>
          <li><span className="font-mono text-xs font-semibold tracking-wider text-teal-400">02</span><p className="mt-2 text-sm font-medium text-slate-300">{t("Add the package with its tracking number before it arrives.")}</p></li>
          <li><span className="font-mono text-xs font-semibold tracking-wider text-teal-400">03</span><p className="mt-2 text-sm font-medium text-slate-300">{t("Consolidate, then pay the final freight from your wallet.")}</p></li>
        </ol>
      </aside>
      <main className="flex flex-1 flex-col justify-between bg-white px-6 py-8 sm:px-12 lg:px-16">
        <div className="flex items-center justify-end gap-4 text-xs font-medium text-slate-500">
          <LocaleSwitch tone="muted" />
          {help ? (
            <a className="inline-flex items-center gap-1.5 hover:text-[#087b73]" href={help}>
              <Ms name="help" className="text-[16px] text-slate-400" />
              {t("Need help?")}
            </a>
          ) : null}
        </div>
        <div className="mx-auto my-auto w-full max-w-md py-8">
          <Outlet />
        </div>
        <p className="sr-only">{brand.name}</p>
      </main>
    </div>
  );
}

function adminPages() {
  return [
    <Route key="index" index element={<AdminOverview />} />,
    <Route key="settings" path="settings" element={<AdminSettings />} />,
    <Route key="guide" path="guide" element={<AdminGuide />} />,
    <Route key="guide-rest" path="guide/*" element={<AdminGuide />} />,
    <Route key="payments" path="payments" element={<AdminPayments />} />,
    <Route key="freight" path="freight" element={<AdminFreightRedirect />} />,
    <Route key="packages" path="packages" element={<AdminPackages />} />,
    <Route key="package" path="packages/:id" element={<AdminPackageDetail />} />,
    <Route key="shipments" path="shipments" element={<AdminShipments />} />,
    <Route key="shipment" path="shipments/:id" element={<AdminShipmentDetail />} />,
    <Route key="users" path="users" element={<AdminUsers />} />,
    <Route key="assistant" path="assistant" element={<AdminAssistant />} />,
    <Route key="calculator" path="calculator" element={<AdminCalculator />} />,
  ];
}

function AdminFreightRedirect() {
  const demo = window.location.pathname.startsWith("/admin/demo");
  return <Navigate to={demo ? "/admin/demo/settings" : "/admin/settings"} replace />;
}

function OpenAuth() {
  return <AuthOutlet />;
}

function HomeRoute() {
  const { t } = useI18n();
  const site = useSiteMode();
  const { data, isPending } = authClient.useSession();
  if (site.failed) {
    return (
      <div className="grid min-h-screen place-items-center px-6 text-center">
        <div>
          <p className="text-sm text-slate-600">{t("Could not load site settings.")}</p>
          <button type="button" className="mt-3 text-sm font-medium text-ink underline" onClick={site.retry}>
            {t("Try again")}
          </button>
        </div>
      </div>
    );
  }
  if (!site.ready || (site.mode === "app-only" && isPending)) return <FullScreenStatus label="Loading…" />;
  const decision = homeDecision(site.mode, Boolean(data));
  if (decision.kind === "redirect") return <Navigate to={decision.to} replace />;
  return <HomePage />;
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<HomeRoute />} />
      <Route path="/privacy" element={<PrivacyPolicyPage />} />
      <Route path="/terms" element={<TermsOfServicePage />} />
      <Route path="/auth/privacy" element={<Navigate to="/privacy" replace />} />
      <Route path="/auth/terms" element={<Navigate to="/terms" replace />} />
      <Route path="/auth/invite" element={<InvitePage />} />
      <Route element={<GuestOnly />}>
        <Route path="/auth/login" element={<LoginPage />} />
        <Route path="/auth/register" element={<RegisterPage />} />
        <Route path="/auth/verify-email" element={<VerifyPage />} />
        <Route path="/auth/forgot-password" element={<ForgotPage />} />
        <Route path="/auth/reset-password" element={<ResetPage />} />
      </Route>
      <Route element={<OpenAuth />}>
        <Route path="/auth/confirm-email" element={<ConfirmEmailPage />} />
      </Route>
      <Route element={<RequireAuth />}>
        <Route path="/app/dashboard" element={<DashboardPage />} />
        <Route path="/app/packages" element={<PackagesPage />} />
        <Route path="/app/packages/pre-alert" element={<PrealertPage />} />
        <Route path="/app/packages/:id" element={<PackageDetailPage />} />
        <Route path="/app/claim-packages" element={<ClaimsPage />} />
        <Route path="/app/consolidate" element={<ConsolidatePage />} />
        <Route path="/app/shipments" element={<ShipmentsPage />} />
        <Route path="/app/shipments/:id" element={<ShipmentDetailPage />} />
        <Route path="/app/checkout/:id/return" element={<CheckoutReturnPage />} />
        <Route path="/app/checkout/:id" element={<CheckoutPage />} />
        <Route path="/app/shipping-calculator" element={<CalculatorPage />} />
        <Route path="/app/warehouse" element={<WarehousePage />} />
        <Route path="/app/wallet" element={<WalletPage />} />
        <Route path="/app/wallet/transfers" element={<TransferRequestsPage />} />
        <Route path="/app/wallet/top-up" element={<TopUpPage />} />
        <Route path="/app/addresses" element={<AddressesPage />} />
        <Route path="/app/invoice-details" element={<InvoiceDetailsPage />} />
        <Route path="/app/account" element={<AccountPage />} />
      </Route>
      <Route path="/admin" element={<RequireAdmin />}>
        {adminPages()}
      </Route>
      <Route path="/admin/demo" element={<RequireDemo />}>
        {adminPages()}
      </Route>
      <Route path="*" element={<Navigate to="/app/dashboard" replace />} />
    </Routes>
  );
}
