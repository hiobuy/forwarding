import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { authClient } from "../../lib/auth";
import { marketingAccent, useBrand, useSiteMode } from "../../lib/brand";
import { LocaleSwitch, useI18n } from "../../lib/i18n";
import { Ms } from "./icon";

const NAV = [
  { href: "/#how-it-works", label: "How it works" },
  { href: "/#calculator", label: "Shipping rates" },
  { href: "/#services", label: "Services" },
  { href: "/#destinations", label: "Destinations" },
  { href: "/#faq", label: "FAQ" },
] as const;

export function PublicShell({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const brand = useBrand();
  const site = useSiteMode();
  const { data } = authClient.useSession();
  const [open, setOpen] = useState(false);
  const signedIn = Boolean(data);
  const showNav = site.mode === "integrated";
  const year = new Date().getFullYear();
  const company = brand.legalName.trim() || brand.name;
  const blurb = brand.description.trim() || t("A China warehouse address for your online orders, then one international shipment when you are ready.");

  return (
    <div className="pb-site min-h-dvh" style={marketingAccent(brand)}>
      <header className="fixed top-0 z-50 w-full bg-white/90 shadow-[0_12px_30px_rgba(22,78,65,0.06)] backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1120px] items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-6">
            <SiteLogo />
            {showNav ? (
              <nav className="hidden items-center gap-4 lg:flex" aria-label="Primary">
                {NAV.map((item) => (
                  <a key={item.href} className="px-1 py-1 text-[15px] leading-6 text-[var(--pb-muted)] transition-colors hover:text-[var(--pb-on)]" href={item.href}>
                    {t(item.label)}
                  </a>
                ))}
              </nav>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <LocaleSwitch />
            {showNav ? (
              <button
                type="button"
                className="grid size-9 place-items-center rounded-lg text-[var(--pb-on)] lg:hidden"
                aria-expanded={open}
                aria-controls="public-menu"
                onClick={() => setOpen((value) => !value)}
              >
                <Ms name={open ? "close" : "menu"} className="text-[22px]" />
                <span className="sr-only">{open ? t("Close menu") : t("Open menu")}</span>
              </button>
            ) : null}
            {signedIn ? null : (
              <Link className="hidden items-center px-4 py-1 text-[12px] leading-4 font-bold text-[var(--pb-muted)] hover:text-[var(--pb-on)] sm:inline-flex" to="/auth/login">
                {t("Sign in")}
              </Link>
            )}
            <Link
              className="inline-flex items-center justify-center rounded-lg bg-[var(--pb-primary)] px-4 py-1 text-[12px] leading-4 font-bold text-white shadow-[0_4px_14px_rgba(8,123,115,0.25)] transition hover:-translate-y-0.5 hover:bg-[var(--pb-primary-strong)]"
              to={signedIn ? "/app/dashboard" : "/auth/register"}
            >
              {signedIn ? t("Dashboard") : t("Sign up")}
            </Link>
            <Link to={signedIn ? "/app/dashboard" : "/auth/login"} className="ml-1 grid size-8 place-items-center rounded-full bg-[var(--pb-primary)] text-white" aria-label={signedIn ? t("Open customer center") : t("Sign in")}>
              <Ms name="person" className="text-[18px]" />
            </Link>
          </div>
        </div>
        {showNav && open ? (
          <nav id="public-menu" className="border-t border-[var(--pb-border)] bg-white px-4 py-3 lg:hidden" aria-label="Mobile">
            {NAV.map((item) => (
              <a key={item.href} className="block rounded-lg px-2 py-2.5 text-[15px] text-[var(--pb-on)] hover:bg-[var(--pb-subtle)]" href={item.href} onClick={() => setOpen(false)}>
                {t(item.label)}
              </a>
            ))}
            <Link className="mt-1 block rounded-lg px-2 py-2.5 text-[15px] font-bold text-[var(--pb-primary)] sm:hidden" to={signedIn ? "/app/dashboard" : "/auth/login"} onClick={() => setOpen(false)}>
              {signedIn ? t("Dashboard") : t("Sign in")}
            </Link>
          </nav>
        ) : null}
      </header>
      <main className="w-full bg-[var(--pb-surface)] pt-16">{children}</main>
      <footer className="w-full bg-[var(--pb-footer)] py-20 text-[#d5f7fd]">
        <div className="mx-auto max-w-[1120px] px-4 sm:px-6">
          <div className="grid grid-cols-1 gap-8 pb-14 md:grid-cols-2 lg:grid-cols-4">
            <div className="flex flex-col gap-4 lg:col-span-1">
              <div className="text-[22px] leading-7 font-bold tracking-[-0.015em] text-white">{brand.name}</div>
              <p className="max-w-sm text-[13px] leading-5 text-[var(--pb-accent-border)]">{blurb}</p>
            </div>
            <FooterColumn title={t("Customers")}>
              {showNav ? <FooterLink href="/#calculator">{t("Freight calculator")}</FooterLink> : <FooterLink to="/app/shipping-calculator">{t("Freight calculator")}</FooterLink>}
              {showNav ? <FooterLink href="/#how-it-works">{t("How it works")}</FooterLink> : null}
              {showNav ? <FooterLink href="/#services">{t("Services")}</FooterLink> : null}
              {showNav ? <FooterLink href="/#faq">{t("FAQ")}</FooterLink> : null}
              <FooterLink to={signedIn ? "/app/dashboard" : "/auth/register"}>{signedIn ? t("Customer center") : t("Create an account")}</FooterLink>
            </FooterColumn>
            <FooterColumn title={t("Legal")}>
              <PolicyFooter label={t("Privacy Policy")} external={brand.website.privacyUrl} to="/privacy" />
              <PolicyFooter label={t("Terms of Service")} external={brand.website.termsUrl} to="/terms" />
              {brand.supportEmail ? <FooterLink href={`mailto:${brand.supportEmail}`}>{brand.supportEmail}</FooterLink> : null}
            </FooterColumn>
            <FooterColumn title={t("Developers")}>
              <FooterLink href="https://developers.hiobuy.com">{t("Technical support")}</FooterLink>
              {site.githubUrl ? <FooterLink href={site.githubUrl}>{t("GitHub source code")}</FooterLink> : null}
            </FooterColumn>
          </div>
          <div className="flex flex-col items-start justify-between gap-3 border-t border-white/10 pt-6 text-[11px] leading-4 font-medium text-[var(--pb-accent-border)] sm:flex-row sm:items-center">
            <div>© {year} {company}. {t("All rights reserved.")}</div>
            <div>{t("Example legal pages stay marked as templates until the operator reviews them.")}</div>
          </div>
        </div>
      </footer>
    </div>
  );
}

function SiteLogo() {
  const brand = useBrand();
  const kind = brand.logos.primary ? "primary" : brand.logos.square ? "square" : null;
  const mark = kind ? (
    <img src={`/api/branding/assets/${kind}?v=${brand.updatedAt}`} alt={brand.name} className="h-10 w-auto max-w-[180px] object-contain object-left" />
  ) : (
    <span className="truncate text-[18px] font-extrabold tracking-tight text-[var(--pb-on)]">{brand.name}</span>
  );
  return (
    <Link to="/" className="flex min-w-0 items-center">
      {mark}
    </Link>
  );
}

function FooterColumn({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-4 text-[12px] leading-4 font-extrabold tracking-[0.12em] text-[#7bd6cc] uppercase">{title}</div>
      <ul className="flex flex-col gap-2">{children}</ul>
    </div>
  );
}

function FooterLink({ href, to, children }: { href?: string; to?: string; children: ReactNode }) {
  const className = "text-[13px] leading-5 text-[var(--pb-accent-border)] transition-colors hover:text-white";
  if (to) {
    return (
      <li>
        <Link className={className} to={to}>{children}</Link>
      </li>
    );
  }
  const external = href?.startsWith("http");
  return (
    <li>
      <a className={className} href={href} {...(external ? { target: "_blank", rel: "noreferrer" } : {})}>{children}</a>
    </li>
  );
}

function PolicyFooter({ label, external, to }: { label: string; external: string; to: string }) {
  if (external) return <FooterLink href={external}>{label}</FooterLink>;
  return <FooterLink to={to}>{label}</FooterLink>;
}

export function sectionWrap(className = "") {
  return `mx-auto w-full max-w-[1120px] px-4 sm:px-6 ${className}`;
}
