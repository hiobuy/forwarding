import { useEffect, useState, type ReactNode } from "react";
import { useBrand, usePageTitle } from "../../lib/brand";
import { Ms } from "./icon";
import { PublicShell } from "./PublicShell";

type Block =
  | { kind: "p"; text: string }
  | { kind: "cards"; items: { title: string; body: string }[] }
  | { kind: "rows"; items: { title: string; body: string; tag: string }[] };

type Section = { id: string; title: string; blocks: Block[] };

const UPDATED = "October 17, 2026";

export function PrivacyPolicyPage() {
  usePageTitle("Privacy Policy");
  const brand = useBrand();
  const company = brand.legalName.trim() || brand.name;
  const contact = brand.supportEmail || brand.email;
  return (
    <LegalDocument
      kicker="Privacy Policy"
      title="Privacy Policy"
      lead={`This example explains how ${brand.name} may collect and use personal information for parcel forwarding. It is a template. It is not a statement that the text complies with every privacy law.`}
      notice="This is demonstration content, not a finalized privacy policy. Replace the example with the operator’s actual practices, name the service providers in use, and obtain legal review before accepting real customers."
      sections={privacySections(brand.name, company, contact, brand.address, brand.country)}
    />
  );
}

export function TermsOfServicePage() {
  usePageTitle("Terms of Service");
  const brand = useBrand();
  const company = brand.legalName.trim() || brand.name;
  const contact = brand.supportEmail || brand.email;
  return (
    <LegalDocument
      kicker="Terms of Service"
      title={<>Terms of <span className="text-[var(--pb-primary)]">Service</span></>}
      lead={`These example terms describe use of ${brand.name} to receive purchases in China and arrange international delivery. They are not ready to publish.`}
      notice="This is illustrative text, not ready-to-publish legal terms. Before accepting real orders, the operator must supply its legal entity, service territory, prohibited-goods policy, fee schedule, refund terms, liability provisions, dispute process, and obtain legal review."
      sections={termsSections(brand.name, company, contact, brand.address, brand.country)}
    />
  );
}

function privacySections(name: string, company: string, contact: string, address: string, country: string): Section[] {
  return [
    {
      id: "sec-1",
      title: "Information we collect",
      blocks: [
        { kind: "p", text: `${name} may store the account name and email, delivery addresses and phone numbers, package and shipment records, support messages, payment references, and the technical data needed to keep the session secure.` },
        {
          kind: "cards",
          items: [
            { title: "Account", body: "Name, verified email, and the credentials used to sign in. Passwords are not shown back to the operator." },
            { title: "Parcels", body: "Warehouse address use, tracking numbers, photos, declared contents, and shipment charges on the account." },
            { title: "Payments", body: "Wallet entries and the references a payment provider returns. Card numbers stay with that provider when a card checkout is enabled." },
          ],
        },
      ],
    },
    {
      id: "sec-2",
      title: "How information is used",
      blocks: [
        { kind: "p", text: "Records are used to match inbound parcels, consolidate shipments, calculate freight, take payment, show tracking, answer support, and reduce abuse of the public calculator." },
        {
          kind: "cards",
          items: [
            { title: "Warehouse matching", body: "The member code on the recipient line is how a parcel is attached to an account." },
            { title: "Shipping and payment", body: "Declared weight, size, and cargo type are sent to the fulfillment service to price a lane. The customer sees the final USD price." },
            { title: "Notices", body: "Email is used for verification, password reset, and account messages the operator has turned on." },
          ],
        },
      ],
    },
    {
      id: "sec-3",
      title: "Service providers",
      blocks: [
        { kind: "p", text: `${company} may need to share shipment details with the warehouse operator, carriers, a payment provider, and an email or hosting provider. The operator should name the providers actually in use. This template does not list a vendor as active unless the deployment has configured it.` },
      ],
    },
    {
      id: "sec-4",
      title: "Cookies and account security",
      blocks: [
        { kind: "p", text: "Sign-in uses an HTTP-only session cookie. The public shipping calculator is rate limited. Optional bot checks appear only when the operator enables them." },
      ],
    },
    {
      id: "sec-5",
      title: "Retention",
      blocks: [
        { kind: "p", text: "Keep account, shipping, and payment records only as long as the service and applicable law require. This template does not set a retention period. The operator must choose one." },
        {
          kind: "rows",
          items: [
            { title: "Account profile", body: "Name, email, and saved addresses", tag: "Set by the operator" },
            { title: "Shipment records", body: "Declarations, charges, and tracking", tag: "Set by the operator" },
            { title: "Warehouse photos", body: "Images attached to a package", tag: "Set by the operator" },
          ],
        },
      ],
    },
    {
      id: "sec-6",
      title: "Choices and requests",
      blocks: [
        { kind: "p", text: "Depending on the law that applies to the operator and the customer, a person may be able to ask for access, correction, or deletion. This page does not create those rights by itself. Send requests to the contact below." },
      ],
    },
    {
      id: "sec-7",
      title: "Contact",
      blocks: [
        { kind: "p", text: contactLine(company, contact, address, country) },
      ],
    },
  ];
}

function termsSections(name: string, company: string, contact: string, address: string, country: string): Section[] {
  return [
    {
      id: "services",
      title: "Services",
      blocks: [{ kind: "p", text: `${name} provides a customer account, a China warehouse address when one is available, parcel records, consolidation, a shipping estimate, freight payment, and tracking. A calculator result is not a booking.` }],
    },
    {
      id: "customer-responsibilities",
      title: "Customer responsibilities",
      blocks: [{ kind: "p", text: "You are responsible for the member code on inbound parcels, tracking numbers, declared contents, value, and cargo attributes. Parcels without the member code may sit unmatched until you claim them." }],
    },
    {
      id: "restricted",
      title: "Restricted and prohibited goods",
      blocks: [{ kind: "p", text: "Goods the warehouse or carrier will not handle can be refused, returned, or held. The prohibited list in the warehouse profile controls what this deployment refuses. This page does not replace that list." }],
    },
    {
      id: "payments",
      title: "Quotes, charges, and payments",
      blocks: [{ kind: "p", text: "Public and account quotes are estimates from declared weight and size. The payable freight is set after packing. Checkout totals are calculated on the server. A quote can expire." }],
    },
    {
      id: "storage",
      title: "Receiving, storage, and consolidation",
      blocks: [{ kind: "p", text: "Free storage runs from the day a parcel is received, for the number of days in the warehouse profile. Submitting a consolidation does not charge freight. You pay after the packed weight, dimensions, and charges are recorded." }],
    },
    {
      id: "delivery",
      title: "Delivery and customs",
      blocks: [{ kind: "p", text: "International delivery follows the lane you pay for. Duties, taxes, and inspections at the destination are not included unless that charge is shown on the bill. You provide the declaration." }],
    },
    {
      id: "cancellation",
      title: "Cancellation and claims",
      blocks: [{ kind: "p", text: "A consolidation can be cancelled from the shipment only before warehouse processing starts. After that, contact support with the shipment id. Refunds follow the payment record, not a promise on this page." }],
    },
    {
      id: "accounts",
      title: "Accounts",
      blocks: [{ kind: "p", text: "The account is personal. Keep the sign-in email and password under your control. Verification and password-reset links expire." }],
    },
    {
      id: "liability",
      title: "Liability",
      blocks: [{ kind: "p", text: `${company} must replace this section with a liability limit, a dispute process, and a governing law that a lawyer has reviewed. Until then, do not treat this template as the contract.` }],
    },
    {
      id: "contact",
      title: "Contact",
      blocks: [{ kind: "p", text: contactLine(company, contact, address, country) }],
    },
  ];
}

function contactLine(company: string, contact: string, address: string, country: string) {
  const bits = [company, address, country, contact].map((item) => item.trim()).filter(Boolean);
  if (!contact) return `${bits.join(" · ") || company}. Add a support email in Business Settings before you publish this page.`;
  return bits.join(" · ");
}

function LegalDocument({ kicker, title, lead, notice, sections }: { kicker: string; title: ReactNode; lead: string; notice: string; sections: Section[] }) {
  const [active, setActive] = useState(sections[0]?.id ?? "");
  const sectionIds = sections.map((section) => section.id).join("|");
  useEffect(() => {
    const nodes = sectionIds.split("|").map((id) => document.getElementById(id)).filter((node): node is HTMLElement => Boolean(node));
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible?.target.id) setActive(visible.target.id);
      },
      { rootMargin: "-20% 0px -60% 0px", threshold: [0.1, 0.4] },
    );
    for (const node of nodes) observer.observe(node);
    return () => observer.disconnect();
  }, [sectionIds]);

  return (
    <PublicShell>
      <section className="relative overflow-hidden bg-gradient-to-b from-[#daf9ff]/60 to-[var(--pb-surface)] pt-10 pb-8">
        <div className="pointer-events-none absolute -top-32 right-10 size-96 rounded-full bg-[#99efe5]/20 blur-3xl" />
        <div className="relative mx-auto max-w-[1120px] px-4 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-6">
            <div className="inline-flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--pb-primary)]/10 px-3 py-1 text-[12px] leading-4 font-extrabold tracking-[0.12em] text-[var(--pb-primary)] uppercase">
                <span className="size-1.5 rounded-full bg-[var(--pb-primary)]" />
                {kicker}
              </span>
            </div>
            <div className="flex items-center gap-2 rounded-lg bg-white/80 px-3 py-1.5 text-[11px] leading-4 font-medium text-[var(--pb-text-muted)] shadow-sm">
              <Ms name="schedule" className="text-[15px] text-[var(--pb-primary)]" />
              <span>Template updated {UPDATED}</span>
            </div>
          </div>
          <div className="max-w-3xl">
            <h1 className="mb-4 text-[40px] leading-[44px] font-extrabold tracking-[-0.03em] sm:text-[56px] sm:leading-[62px] sm:tracking-[-0.04em]">{title}</h1>
            <p className="text-[17px] leading-[30px] text-[var(--pb-muted)]">{lead}</p>
          </div>
          <div className="relative mt-8 overflow-hidden rounded-xl bg-white p-6 shadow-[0_12px_30px_rgba(22,78,65,0.08)]">
            <div className="absolute inset-y-0 left-0 w-1.5 bg-[var(--pb-kraft)]" />
            <div className="flex items-start gap-4">
              <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-[var(--pb-container)] text-[var(--pb-kraft)]">
                <Ms name="info" className="text-[20px]" />
              </div>
              <div>
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <span className="text-[16px] leading-[22px] font-bold">Template notice</span>
                  <span className="rounded bg-[var(--pb-container)] px-2 py-0.5 text-[10px] font-extrabold tracking-[0.12em] text-[var(--pb-muted)] uppercase">Needs review</span>
                </div>
                <p className="text-[13px] leading-5 text-[var(--pb-muted)]">{notice}</p>
              </div>
            </div>
          </div>
        </div>
      </section>
      <section className="w-full py-8 sm:py-12">
        <div className="mx-auto grid max-w-[1120px] grid-cols-1 items-start gap-8 px-4 sm:px-6 lg:grid-cols-12">
          <aside className="lg:sticky lg:top-24 lg:col-span-4">
            <nav className="rounded-xl bg-white p-6 shadow-[0_12px_30px_rgba(22,78,65,0.06)]" aria-label="On this page">
              <div className="mb-4 flex items-center gap-2 text-[12px] leading-4 font-extrabold tracking-[0.12em] text-[var(--pb-primary)] uppercase">
                <Ms name="format_list_bulleted" className="text-[18px]" />
                On this page
              </div>
              <div className="space-y-1">
                {sections.map((section, index) => (
                  <a
                    key={section.id}
                    href={`#${section.id}`}
                    className={`flex items-center justify-between rounded-lg px-3 py-2.5 text-[13px] leading-5 transition ${active === section.id ? "bg-[var(--pb-container)] font-bold text-[var(--pb-primary)]" : "text-[var(--pb-on)] hover:bg-[var(--pb-subtle)]"}`}
                    aria-current={active === section.id ? "true" : undefined}
                  >
                    <span className="truncate">{index + 1}. {section.title}</span>
                    <Ms name="chevron_right" className="text-[16px] text-[var(--pb-text-muted)]" />
                  </a>
                ))}
              </div>
            </nav>
          </aside>
          <div className="space-y-8 lg:col-span-8">
            {sections.map((section, index) => (
              <article key={section.id} id={section.id} className="scroll-mt-24 rounded-2xl bg-white p-6 shadow-[0_12px_30px_rgba(22,78,65,0.06)] sm:p-8">
                <div className="mb-3 flex items-center gap-3">
                  <span className="grid size-7 place-items-center rounded-lg bg-[var(--pb-container)] text-[13px] font-bold text-[var(--pb-primary)]">{String(index + 1).padStart(2, "0")}</span>
                  <h2 className="text-[28px] leading-[34px] font-bold tracking-[-0.02em] sm:text-[32px] sm:leading-10">{section.title}</h2>
                </div>
                <SectionBody blocks={section.blocks} />
              </article>
            ))}
          </div>
        </div>
      </section>
    </PublicShell>
  );
}

function SectionBody({ blocks }: { blocks: Block[] }) {
  return (
    <div className="space-y-4">
      {blocks.map((block, index) => {
        if (block.kind === "p") return <p key={index} className="text-[15px] leading-6 text-[var(--pb-muted)]">{block.text}</p>;
        if (block.kind === "rows") {
          return (
            <div key={index} className="space-y-3">
              {block.items.map((item) => (
                <div key={item.title} className="flex flex-col justify-between gap-2 rounded-xl bg-[var(--pb-subtle)] p-4 sm:flex-row sm:items-center">
                  <div>
                    <span className="block text-[16px] leading-[22px] font-bold">{item.title}</span>
                    <span className="text-[13px] leading-5 text-[var(--pb-muted)]">{item.body}</span>
                  </div>
                  <span className="self-start rounded bg-[var(--pb-container)] px-3 py-1 text-[12px] leading-4 font-extrabold tracking-[0.04em] text-[var(--pb-primary)] sm:self-auto">{item.tag}</span>
                </div>
              ))}
            </div>
          );
        }
        return (
          <div key={index} className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {block.items.map((item) => (
              <div key={item.title} className="rounded-xl bg-[var(--pb-subtle)] p-4">
                <h3 className="text-[16px] leading-[22px] font-bold">{item.title}</h3>
                <p className="mt-1 text-[13px] leading-5 text-[var(--pb-muted)]">{item.body}</p>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
