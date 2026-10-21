import { Link } from "react-router";
import { usePageTitle } from "../../lib/brand";
import { useI18n } from "../../lib/i18n";
import { SITE_FAQ } from "./faq";
import { Ms } from "./icon";
import { PublicShell, sectionWrap } from "./PublicShell";
import { SiteCalculator, useOpenCountries } from "./SiteCalculator";

const STEPS = [
  { n: "01", icon: "badge", title: "Register and get your address", body: "Create an account and open the warehouse address with your member code. That code is how inbound parcels are matched to you.", note: "Shown in your account" },
  { n: "02", icon: "shopping_bag", title: "Shop from Chinese stores", body: "Use the warehouse address as the shipping address when you buy. Add the parcel with its tracking number before it arrives.", note: "Pre-alert with the tracking number" },
  { n: "03", icon: "photo_library", title: "Receive and consolidate", body: "The warehouse records the parcel. Photos, weight, and size show on the package. Combine what is ready into one shipment.", note: "Freight is quoted after packing" },
  { n: "04", icon: "rocket_launch", title: "Pay and track delivery", body: "Pay the international freight from your wallet after the warehouse finishes packing, then follow the shipment in the customer center.", note: "Final charge after packing" },
] as const;

const SERVICES = [
  { icon: "warehouse", title: "China warehouse address", body: "Your account includes a warehouse address and a member code. Use both when a Chinese seller asks for a shipping address.", points: ["Recipient, phone, and address fields", "Member code on the recipient line"] },
  { icon: "inventory", title: "Consolidation", body: "Parcels that are ready can be packed into one shipment. You pay freight after the warehouse records the packed weight and size.", points: ["Choose the parcels to combine", "No freight charge when you submit"] },
  { icon: "photo_camera", title: "Warehouse photos", body: "Photos taken at the warehouse appear on the package. You can request extra photos or a content check before shipping.", points: ["Photos on the package page", "Extra photo requests when offered"] },
  { icon: "all_inclusive", title: "Repacking requests", body: "Before a shipment is packed, you can ask for extra handling that the warehouse lists as a service. The request is not a separate shipping lane.", points: ["Requested from the package", "Shown with the warehouse status"] },
  { icon: "assignment_turned_in", title: "Declarations you provide", body: "You enter contents, value, and cargo type. The shipment documents follow that declaration. Restricted goods can be refused.", points: ["Contents and value are yours to declare", "Cargo type is part of the quote"] },
  { icon: "troubleshoot", title: "Tracking", body: "After the shipment is handed to the carrier, tracking events show in the customer center. A tracking number that is not yours does not reveal another account.", points: ["Shipment timeline in your account", "Public lookup does not show charges"] },
] as const;

export function HomePage() {
  const { t, currency } = useI18n();
  usePageTitle(t("Shop in China"));
  const countries = useOpenCountries();
  const open = countries.data?.countries ?? [];
  return (
    <PublicShell>
      <Hero count={countries.data ? open.length : null} />
      <HowItWorks />
      <section className="w-full bg-[var(--pb-surface)] py-16 sm:py-20" id="calculator">
        <div className={sectionWrap()}>
          <div className="mb-8 max-w-xl">
            <span className="text-[12px] leading-4 font-extrabold tracking-[0.12em] text-[var(--pb-primary)] uppercase">{t("Shipping calculator")}</span>
            <h2 className="mt-2 text-[28px] leading-[34px] font-bold tracking-[-0.02em] sm:text-[36px] sm:leading-[44px] sm:tracking-[-0.03em]">{t("Know your shipping cost upfront")}</h2>
            <p className="mt-2 text-[15px] leading-6 text-[var(--pb-muted)]">{t("Destinations are the countries this workspace has opened. The price is the {currency} amount a customer would pay, after the operator's markup and exchange rate.", { currency })}</p>
          </div>
          <SiteCalculator />
        </div>
      </section>
      <Services />
      <Destinations names={open.map((item) => item.name)} loading={countries.isLoading} failed={countries.isError} />
      <PortalPreview />
      <Faq />
      <Closing />
    </PublicShell>
  );
}

function Hero({ count }: { count: number | null }) {
  const { t } = useI18n();
  return (
    <section className="relative w-full overflow-hidden pt-14 pb-16 sm:pt-16 sm:pb-20">
      <div className="pointer-events-none absolute -top-24 left-1/2 -z-10 h-[450px] w-[900px] max-w-none -translate-x-1/2 bg-gradient-to-tr from-[#99efe5]/30 via-[#97f3e8]/20 to-transparent blur-[120px]" />
      <div className="pointer-events-none absolute top-40 -right-20 -z-10 size-[420px] bg-[var(--pb-primary)]/10 blur-[100px]" />
      <div className={sectionWrap()}>
        <div className="grid grid-cols-1 items-center gap-8 lg:grid-cols-12">
          <div className="flex flex-col items-start gap-6 lg:col-span-7">
            <div className="inline-flex items-center gap-2 rounded-full bg-[var(--pb-container)] px-3.5 py-1.5 text-[12px] leading-4 font-extrabold tracking-[0.12em] text-[var(--pb-primary)] uppercase shadow-sm">
              <span className="size-2 animate-pulse rounded-full bg-[var(--pb-primary)]" />
              {t("China warehouse address")}
            </div>
            <h1 className="text-[40px] leading-[44px] font-extrabold tracking-[-0.03em] sm:text-[56px] sm:leading-[62px] sm:tracking-[-0.04em]">
              {t("Shop in China.")}
              <br />
              <span className="text-[var(--pb-primary-strong)]">{t("Ship worldwide.")}</span>
            </h1>
            <p className="max-w-xl text-[17px] leading-[30px] text-[var(--pb-muted)]">
              {t("Get a personal China warehouse address, send purchases there, consolidate the parcels that are ready, and pay international shipping after the warehouse packs the shipment.")}
            </p>
            <div className="flex w-full flex-wrap items-center gap-4 sm:w-auto">
              <Link className="inline-flex items-center justify-center gap-1 rounded-lg bg-[var(--pb-primary)] px-6 py-3.5 text-[12px] leading-4 font-bold text-white shadow-[0_12px_24px_rgba(8,123,115,0.22)] transition hover:-translate-y-0.5 hover:bg-[var(--pb-primary-strong)]" to="/auth/register">
                {t("Get your free address")}
                <Ms name="arrow_forward" className="text-[18px]" />
              </Link>
              <a className="inline-flex items-center justify-center gap-1 rounded-lg border border-[var(--pb-control)] bg-white px-6 py-3.5 text-[12px] leading-4 font-bold text-[var(--pb-on)] shadow-sm transition hover:bg-[var(--pb-subtle)]" href="#calculator">
                <Ms name="calculate" className="text-[18px] text-[var(--pb-primary)]" />
                {t("Calculate shipping")}
              </a>
            </div>
            <ul className="flex flex-wrap items-center gap-x-8 gap-y-2 pt-2 text-[13px] leading-5 text-[var(--pb-muted)]">
              {["Personal warehouse address", "Consolidate ready parcels", "Warehouse photos on the package"].map((item) => (
                <li key={item} className="flex items-center gap-2">
                  <Ms name="check_circle" className="text-[20px] text-[var(--pb-primary)]" />
                  {t(item)}
                </li>
              ))}
            </ul>
          </div>
          <div className="relative lg:col-span-5">
            <div className="relative mx-auto w-full max-w-[460px] p-2">
              <div className="absolute inset-0 -z-10 scale-95 -rotate-1 rounded-3xl bg-gradient-to-br from-white/90 via-[var(--pb-container)] to-[#c7e8ef]/40 shadow-[0_20px_50px_rgba(22,78,65,0.12)]" />
              <div className="flex flex-col gap-4 rounded-2xl bg-white p-6 shadow-[0_14px_40px_rgba(22,78,65,0.14)] sm:p-8">
                <div className="flex items-center justify-between border-b border-[var(--pb-border)] pb-2">
                  <div className="flex items-center gap-2">
                    <span className="size-3 animate-ping rounded-full bg-[var(--pb-primary)]" />
                    <span className="text-[16px] leading-[22px] font-bold">{t("Example parcel path")}</span>
                  </div>
                  <span className="rounded-full bg-[var(--pb-container)] px-2.5 py-1 text-[11px] leading-4 font-extrabold tracking-[0.12em] text-[var(--pb-primary)]">{t("EXAMPLE")}</span>
                </div>
                <ExampleCard icon="inventory_2" title={t("Package received")} meta={t("Seller tracking matched to your member code")} badge={t("STORED")} badgeClass="bg-[var(--pb-secondary-container)]/50 text-[var(--pb-secondary)]" />
                <div className="rounded-xl bg-[var(--pb-subtle)] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Ms name="layers" className="text-[24px] text-[var(--pb-primary)]" />
                      <div>
                        <div className="text-[16px] leading-[22px] font-bold">{t("Ready to consolidate")}</div>
                        <div className="mt-0.5 text-[11px] leading-4 font-medium text-[var(--pb-text-muted)]">{t("Several parcels can leave as one shipment")}</div>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="rounded-xl bg-[var(--pb-banner)] p-4 text-white shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Ms name="flight_takeoff" className="text-[26px] text-[var(--pb-primary-fixed)]" />
                      <div>
                        <div className="text-[16px] leading-[22px] font-bold text-white">{t("Pay, then track")}</div>
                        <div className="mt-0.5 text-[11px] leading-4 font-medium text-[var(--pb-accent-border)]">{t("Freight is charged after packing")}</div>
                      </div>
                    </div>
                    <span className="rounded bg-[#4f7473]/80 px-2.5 py-0.5 text-[11px] leading-4 font-semibold tracking-[0.12em] text-white">{t("SHIP")}</span>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 border-t border-[var(--pb-border)]/50 pt-2 text-center">
                  <Stat value={t("Free")} label={t("Storage window")} />
                  <Stat value={count == null ? "—" : String(count)} label={t("Open countries")} />
                  <Stat value={t("Warehouse photos")} label={t("On the package")} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function ExampleCard({ icon, title, meta, badge, badgeClass }: { icon: string; title: string; meta: string; badge: string; badgeClass: string }) {
  return (
    <div className="rounded-xl bg-[var(--pb-subtle)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Ms name={icon} className="text-[24px] text-[var(--pb-primary)]" />
          <div>
            <div className="text-[16px] leading-[22px] font-bold">{title}</div>
            <div className="mt-0.5 text-[11px] leading-4 font-medium text-[var(--pb-text-muted)]">{meta}</div>
          </div>
        </div>
        <span className={`rounded px-2 py-0.5 text-[11px] leading-4 font-extrabold tracking-[0.08em] ${badgeClass}`}>{badge}</span>
      </div>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-lg bg-[var(--pb-subtle)] p-2.5">
      <div className="text-[16px] leading-[22px] font-extrabold text-[var(--pb-primary)]">{value}</div>
      <div className="mt-0.5 text-[11px] leading-4 font-medium text-[var(--pb-text-muted)]">{label}</div>
    </div>
  );
}

function HowItWorks() {
  const { t } = useI18n();
  return (
    <section className="w-full bg-white py-16 sm:py-20" id="how-it-works">
      <div className={sectionWrap()}>
        <div className="mx-auto mb-14 flex max-w-2xl flex-col items-center text-center">
          <span className="mb-2 text-[12px] leading-4 font-extrabold tracking-[0.12em] text-[var(--pb-primary)] uppercase">{t("Four steps")}</span>
          <h2 className="text-[28px] leading-[34px] font-bold tracking-[-0.02em] sm:text-[36px] sm:leading-[44px] sm:tracking-[-0.03em]">{t("How it works")}</h2>
          <p className="mt-2 text-[15px] leading-6 text-[var(--pb-muted)]">{t("From a purchase in China to one international shipment, in the order the customer center actually uses.")}</p>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step) => (
            <article key={step.n} className="group flex flex-col justify-between rounded-2xl bg-[var(--pb-subtle)] p-6 transition hover:bg-[var(--pb-container)]">
              <div>
                <div className="mb-4 flex items-center justify-between">
                  <span className="text-[22px] leading-7 font-extrabold text-[var(--pb-primary)]/30 transition group-hover:text-[var(--pb-primary)]">{step.n}</span>
                  <div className="grid size-10 place-items-center rounded-xl bg-white text-[var(--pb-primary)] shadow-sm">
                    <Ms name={step.icon} className="text-[20px]" />
                  </div>
                </div>
                <h3 className="mb-2 text-[16px] leading-[22px] font-bold">{t(step.title)}</h3>
                <p className="text-[13px] leading-5 text-[var(--pb-muted)]">{t(step.body)}</p>
              </div>
              <div className="mt-6 flex items-center gap-1 border-t border-[var(--pb-border)] pt-2 text-[11px] leading-4 font-medium text-[var(--pb-primary)]">
                <span>{t(step.note)}</span>
                <Ms name="check" className="text-[14px]" />
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function Services() {
  const { t } = useI18n();
  return (
    <section className="w-full bg-white py-16 sm:py-20" id="services">
      <div className={sectionWrap()}>
        <div className="mb-14 flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div>
            <span className="text-[12px] leading-4 font-extrabold tracking-[0.12em] text-[var(--pb-primary)] uppercase">{t("What you can do")}</span>
            <h2 className="mt-2 text-[28px] leading-[34px] font-bold tracking-[-0.02em] sm:text-[36px] sm:leading-[44px] sm:tracking-[-0.03em]">{t("Services in this workspace")}</h2>
          </div>
          <p className="max-w-md text-[15px] leading-6 text-[var(--pb-muted)]">{t("These are the forwarding steps the customer center already supports. A quote does not add a service the warehouse has not offered.")}</p>
        </div>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {SERVICES.map((service) => (
            <article key={service.title} className="flex flex-col gap-2 rounded-2xl bg-[var(--pb-subtle)] p-6 transition hover:bg-[var(--pb-container)]">
              <div className="grid size-12 place-items-center rounded-xl bg-white text-[var(--pb-primary)] shadow-sm">
                <Ms name={service.icon} className="text-[24px]" />
              </div>
              <h3 className="text-[16px] leading-[22px] font-bold">{t(service.title)}</h3>
              <p className="text-[13px] leading-5 text-[var(--pb-muted)]">{t(service.body)}</p>
              <ul className="mt-2 space-y-1 text-[11px] leading-4 font-medium text-[var(--pb-primary)]">
                {service.points.map((point) => (
                  <li key={point} className="flex items-center gap-1.5">
                    <Ms name="check" className="text-[14px]" />
                    {t(point)}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function Destinations({ names, loading, failed }: { names: string[]; loading: boolean; failed: boolean }) {
  const { t } = useI18n();
  return (
    <section className="w-full bg-[var(--pb-surface)] py-16 sm:py-20" id="destinations">
      <div className={sectionWrap()}>
        <div className="mb-8 max-w-xl">
          <span className="text-[12px] leading-4 font-extrabold tracking-[0.12em] text-[var(--pb-primary)] uppercase">{t("Destinations")}</span>
          <h2 className="mt-2 text-[28px] leading-[34px] font-bold tracking-[-0.02em] sm:text-[36px] sm:leading-[44px] sm:tracking-[-0.03em]">{t("Countries open for quotes")}</h2>
          <p className="mt-2 text-[15px] leading-6 text-[var(--pb-muted)]">{t("Only countries enabled in Admin Settings are listed. Channel names stay inside the calculator result.")}</p>
        </div>
        {loading ? <p className="text-[15px] text-[var(--pb-muted)]" role="status">{t("Loading open countries…")}</p> : null}
        {failed ? <p className="text-[15px] text-[#ba1a1a]">{t("Open countries could not be loaded.")}</p> : null}
        {!loading && !failed && names.length === 0 ? <p className="rounded-2xl bg-white p-6 text-[15px] text-[var(--pb-muted)]">{t("No destination countries are open yet.")}</p> : null}
        {names.length ? (
          <ul className="flex flex-wrap gap-2">
            {names.map((name) => (
              <li key={name} className="rounded-full bg-white px-4 py-2 text-[13px] leading-5 font-bold text-[var(--pb-on)] shadow-[0_4px_16px_rgba(22,78,65,0.05)]">{name}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}

function PortalPreview() {
  const { t } = useI18n();
  const rows = [
    ["checkroom", "Parcel ready to ship", "Tracking number on file"],
    ["inventory_2", "Second parcel in the same account", "Waiting with the first"],
    ["photo_camera", "Warehouse photo attached", "Visible on the package"],
  ];
  return (
    <section className="w-full overflow-hidden bg-[var(--pb-surface)] py-16 sm:py-20">
      <div className={sectionWrap()}>
        <div className="relative rounded-3xl bg-[var(--pb-banner)] p-6 text-[#d5f7fd] shadow-[0_24px_60px_rgba(10,73,71,0.25)] sm:p-10 lg:p-14">
          <div className="pointer-events-none absolute -right-20 -bottom-20 size-[450px] bg-[#97f3e8]/10 blur-[90px]" />
          <div className="grid grid-cols-1 items-center gap-8 lg:grid-cols-12">
            <div className="flex flex-col gap-4 lg:col-span-5">
              <span className="text-[12px] leading-4 font-extrabold tracking-[0.12em] text-[var(--pb-primary-fixed)] uppercase">{t("Customer center")}</span>
              <h2 className="text-[28px] leading-[34px] font-bold tracking-[-0.02em] text-white sm:text-[36px] sm:leading-[44px]">{t("Parcels, then one shipment.")}</h2>
              <p className="text-[15px] leading-6 text-[var(--pb-accent-border)]">{t("Sign in to copy the warehouse address, combine parcels, pay the packed freight, and read tracking on the shipment.")}</p>
              <ul className="space-y-3 pt-1 text-[13px] leading-5 text-white">
                {["Warehouse address with your member code", "Consolidation before the freight charge", "Wallet payment after packing"].map((item) => (
                  <li key={item} className="flex items-center gap-3">
                    <span className="grid size-6 place-items-center rounded-full bg-[var(--pb-primary-fixed)] text-[var(--pb-banner)]">
                      <Ms name="check" className="text-[16px]" />
                    </span>
                    {t(item)}
                  </li>
                ))}
              </ul>
              <div className="pt-2">
                <Link className="inline-flex items-center justify-center gap-2 rounded-lg bg-white px-6 py-3 text-[12px] leading-4 font-bold text-[var(--pb-primary)] shadow transition hover:bg-[var(--pb-subtle)]" to="/auth/register">
                  {t("Create an account")}
                  <Ms name="arrow_forward" className="text-[18px]" />
                </Link>
              </div>
            </div>
            <div className="lg:col-span-7">
              <div className="rounded-2xl bg-white p-4 text-[var(--pb-on)] shadow-[0_16px_40px_rgba(0,0,0,0.3)]" aria-hidden="true">
                <div className="mb-3 flex items-center justify-between border-b border-[var(--pb-border)] pb-3">
                  <div className="flex items-center gap-2">
                    <span className="size-2.5 rounded-full bg-[#ba1a1a]" />
                    <span className="size-2.5 rounded-full bg-[var(--pb-secondary)]" />
                    <span className="size-2.5 rounded-full bg-[#7bd6cc]" />
                    <span className="ml-2 text-[11px] leading-4 font-medium text-[var(--pb-text-muted)]">{t("Customer center")}</span>
                  </div>
                </div>
                <div className="flex flex-col gap-2.5">
                  {rows.map(([icon, title, meta]) => (
                    <div key={title} className="flex items-center justify-between rounded-xl bg-[var(--pb-subtle)] p-2">
                      <div className="flex items-center gap-2">
                        <div className="grid size-10 place-items-center rounded-lg bg-[var(--pb-container-high)] text-[var(--pb-primary)]">
                          <Ms name={icon!} className="text-[20px]" />
                        </div>
                        <div>
                          <div className="text-[16px] leading-[22px] font-bold">{t(title!)}</div>
                          <div className="text-[11px] leading-4 font-medium text-[var(--pb-text-muted)]">{t(meta!)}</div>
                        </div>
                      </div>
                      <span className="rounded bg-[var(--pb-primary-fixed)]/50 px-2 py-0.5 text-[11px] leading-4 font-extrabold tracking-[0.08em] text-[var(--pb-primary)]">{t("READY")}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Faq() {
  const { t } = useI18n();
  return (
    <section className="w-full bg-white py-16 sm:py-20" id="faq">
      <div className="mx-auto max-w-[800px] px-4 sm:px-6">
        <div className="mb-14 text-center">
          <span className="text-[12px] leading-4 font-extrabold tracking-[0.12em] text-[var(--pb-primary)] uppercase">{t("Frequently asked questions")}</span>
          <h2 className="mt-2 text-[28px] leading-[34px] font-bold tracking-[-0.02em] sm:text-[36px] sm:leading-[44px] sm:tracking-[-0.03em]">{t("Clear answers before you ship")}</h2>
        </div>
        <div className="flex flex-col divide-y divide-[var(--pb-border)]">
          {SITE_FAQ.map((item) => (
            <details key={item.question} className="group py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[16px] leading-[22px] font-bold">
                <span>{t(item.question)}</span>
                <Ms name="add" className="shrink-0 text-[22px] text-[var(--pb-primary)] transition-transform duration-200 group-open:rotate-45" />
              </summary>
              <p className="mt-3 text-[15px] leading-6 text-[var(--pb-muted)]">{t(item.answer)}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function Closing() {
  const { t } = useI18n();
  return (
    <section className="w-full bg-[var(--pb-container)] py-16 sm:py-20">
      <div className={sectionWrap()}>
        <div className="flex flex-col items-center gap-4 rounded-3xl bg-[var(--pb-primary-strong)] px-6 py-10 text-center text-white shadow-[0_20px_50px_rgba(8,123,115,0.3)] sm:px-14 sm:py-14">
          <span className="rounded-full bg-white/20 px-3 py-1 text-[12px] leading-4 font-extrabold tracking-[0.12em] text-white uppercase">{t("Account required for a warehouse address")}</span>
          <h2 className="max-w-2xl text-[28px] leading-[34px] font-bold tracking-[-0.02em] sm:text-[36px] sm:leading-[44px]">{t("Ready to shop in China and ship one parcel home?")}</h2>
          <p className="max-w-xl text-[17px] leading-[30px] text-[var(--pb-on-primary-container)]">{t("Create an account to receive the warehouse address. Shipping is paid later, after the warehouse packs what you consolidate.")}</p>
          <div className="flex w-full flex-col items-center gap-2 pt-2 sm:w-auto sm:flex-row">
            <Link className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-white px-8 py-3.5 text-[12px] leading-4 font-bold text-[var(--pb-primary)] shadow transition hover:-translate-y-0.5 hover:bg-[var(--pb-subtle)] sm:w-auto" to="/auth/register">
              {t("Get your personal address now")}
              <Ms name="arrow_forward" className="text-[18px]" />
            </Link>
            <a className="inline-flex w-full items-center justify-center rounded-lg border border-white/30 px-6 py-3.5 text-[12px] leading-4 font-bold text-white transition hover:bg-white/10 sm:w-auto" href="#calculator">
              {t("Try rate calculator")}
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
