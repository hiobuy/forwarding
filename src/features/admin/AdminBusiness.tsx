import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Button, ErrorState, Field, LoadingBlock, inputClass } from "../../components/ui";
import { useToast } from "../../components/toast";
import { DEFAULT_PRIMARY_COLOR, type BusinessInput } from "../../domain/business";
import { ApiError, api } from "../../lib/api";
import { LogoField } from "./LogoField";
import { Panel } from "./shared";

type Audit = { id: string; actor: string; summary: string; createdAt: string };
type View = {
  stored: BusinessInput;
  brand: { name: string };
  appUrlTrusted: boolean;
  linkOrigin: string | null;
  requestOrigin: string;
  siteMode: "integrated" | "app-only";
  logos: { primary: boolean; square: boolean; favicon: boolean };
  updatedAt: number;
  audit: Audit[];
};

export function AdminBusiness({ canWrite, active, onDirty }: { canWrite: boolean; active: boolean; onDirty: (value: boolean) => void }) {
  const query = useQuery({ queryKey: ["admin", "business"], queryFn: () => api<View>("/api/admin/settings/business") });
  if (query.isLoading) return <LoadingBlock rows={4} />;
  if (query.error || !query.data) return <ErrorState message="Could not load business settings." onRetry={() => void query.refetch()} />;
  return <BusinessForm key={query.data.updatedAt} initial={query.data} canWrite={canWrite} active={active} onDirty={onDirty} />;
}

function BusinessForm({ initial, canWrite, active, onDirty }: { initial: View; canWrite: boolean; active: boolean; onDirty: (value: boolean) => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState(initial.stored);
  const [logos, setLogos] = useState(initial.logos);
  const [version, setVersion] = useState(initial.updatedAt);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial.stored);
  useEffect(() => {
    if (active) onDirty(dirty);
  }, [active, dirty, onDirty]);
  useEffect(() => {
    if (!dirty) return;
    const onLeave = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [dirty]);
  const save = useMutation({
    mutationFn: () => api<View>("/api/admin/settings/business", { method: "PUT", body: JSON.stringify(form) }),
    onSuccess: async (next) => {
      setForm(next.stored);
      setLogos(next.logos);
      setVersion(next.updatedAt);
      await queryClient.invalidateQueries({ queryKey: ["admin", "business"] });
      await queryClient.invalidateQueries({ queryKey: ["branding"] });
      toast({ title: "Business settings saved.", tone: "success" });
    },
    onError: (error) => toast({ title: error instanceof ApiError ? error.message : "Could not save business settings.", tone: "danger" }),
  });
  function set<K extends keyof BusinessInput>(key: K, value: BusinessInput[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }
  return (
    <form
      className="max-w-2xl space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (canWrite) save.mutate();
      }}
    >
      {!canWrite ? <p className="text-[13px] text-slate-500">Only an owner can change the company profile and brand.</p> : null}
      <Panel>
        <Section title="Business profile" body="The business name is what customers see. The legal name is printed on commercial documents." />
        <div className="grid gap-4 px-4 py-4 sm:grid-cols-2">
          <Field label="Business name">
            <input className={inputClass} required disabled={!canWrite} value={form.name} placeholder={initial.brand.name} onChange={(event) => set("name", event.target.value)} />
          </Field>
          <Field label="Legal company name" optional>
            <input className={inputClass} disabled={!canWrite} value={form.legalName} onChange={(event) => set("legalName", event.target.value)} />
          </Field>
          <Field label="Business email">
            <input className={inputClass} type="email" required disabled={!canWrite} value={form.email} onChange={(event) => set("email", event.target.value)} />
          </Field>
          <Field label="Support email" optional>
            <input className={inputClass} type="email" disabled={!canWrite} value={form.supportEmail} onChange={(event) => set("supportEmail", event.target.value)} />
          </Field>
          <Field label="Support phone" optional>
            <input className={inputClass} disabled={!canWrite} value={form.phone} onChange={(event) => set("phone", event.target.value)} />
          </Field>
          <Field label="WhatsApp" optional hint="Country code and number, for example +86 138 0000 0000. An icon appears next to the language switch in the customer app.">
            <input className={inputClass} inputMode="tel" autoComplete="tel" disabled={!canWrite} value={form.whatsapp} placeholder="+86 138 0000 0000" onChange={(event) => set("whatsapp", event.target.value)} />
          </Field>
          <Field label="Country / region" optional>
            <input className={inputClass} disabled={!canWrite} value={form.country} onChange={(event) => set("country", event.target.value)} />
          </Field>
          <Field label="Business address" optional>
            <textarea className={`${inputClass} h-24 py-2`} disabled={!canWrite} value={form.address} onChange={(event) => set("address", event.target.value)} />
          </Field>
          <Field label="Business description" optional>
            <textarea className={`${inputClass} h-24 py-2`} disabled={!canWrite} value={form.description} onChange={(event) => set("description", event.target.value)} />
          </Field>
        </div>
      </Panel>
      <Panel>
        <Section title="Branding" body="Logos and colors apply to the customer app, admin mark, email, and invoice rule. Status colors stay the same." />
        <div className="grid gap-3 px-4 py-4">
          <LogoField kind="primary" label="Primary logo" hint="Header and email. PNG, JPEG, WebP, or SVG, up to 1 MB. Raster files can be cropped first." present={logos.primary} version={version} canWrite={canWrite} onChange={(present, nextVersion) => { setLogos((current) => ({ ...current, primary: present })); setVersion(nextVersion); }} />
          <LogoField kind="square" label="Square icon" hint="Used when the sidebar is narrow. Cropped to a square." present={logos.square} version={version} canWrite={canWrite} onChange={(present, nextVersion) => { setLogos((current) => ({ ...current, square: present })); setVersion(nextVersion); }} />
          <LogoField kind="favicon" label="Favicon" hint="Browser tab icon. Cropped to a square, up to 256 KB." present={logos.favicon} version={version} canWrite={canWrite} onChange={(present, nextVersion) => { setLogos((current) => ({ ...current, favicon: present })); setVersion(nextVersion); }} />
          <div className="grid gap-4 sm:grid-cols-2">
            <ColorField label="Primary color" value={form.primaryColor} disabled={!canWrite} onChange={(value) => set("primaryColor", value)} />
            <ColorField label="Accent color" optional value={form.accentColor} disabled={!canWrite} onChange={(value) => set("accentColor", value)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Browser title" optional hint="Pages use this after the page name.">
              <input className={inputClass} disabled={!canWrite} value={form.browserTitle} placeholder={form.name || initial.brand.name} onChange={(event) => set("browserTitle", event.target.value)} />
            </Field>
            <Field label="Default meta description" optional>
              <textarea className={`${inputClass} h-20 py-2`} disabled={!canWrite} value={form.metaDescription} onChange={(event) => set("metaDescription", event.target.value)} />
            </Field>
          </div>
        </div>
      </Panel>
      <Panel>
        <Section title="Website" body="The public website is the logo, return, and email link. Leave it empty to use PUBLIC_WEBSITE_URL. Site mode is a deployment setting and is not saved here." />
        <p className="border-b border-slate-100 px-4 py-3 text-[13px] text-slate-600">
          Public site mode: {initial.siteMode === "app-only" ? "App-only. The home page sends visitors to sign in or the customer dashboard." : "Integrated. The home page is the built-in public site."}
        </p>
        <div className="grid gap-4 px-4 py-4 sm:grid-cols-2">
          <Field label="Public website URL" optional hint="Overrides PUBLIC_WEBSITE_URL for this workspace.">
            <input className={inputClass} disabled={!canWrite} value={form.publicUrl} placeholder="https://example.com" onChange={(event) => set("publicUrl", event.target.value)} />
          </Field>
          <Field label="Customer app URL" optional hint={form.appUrl && !initial.appUrlTrusted ? "Email and password links stay on this deployment until the URL matches it or TRUSTED_APP_ORIGINS." : `Links in email use ${initial.linkOrigin || initial.requestOrigin}.`}>
            <input className={inputClass} disabled={!canWrite} value={form.appUrl} placeholder={initial.requestOrigin} onChange={(event) => set("appUrl", event.target.value)} />
          </Field>
          <Field label="Support URL" optional>
            <input className={inputClass} disabled={!canWrite} value={form.supportUrl} placeholder="https://" onChange={(event) => set("supportUrl", event.target.value)} />
          </Field>
          <Field label="Privacy policy URL" optional>
            <input className={inputClass} disabled={!canWrite} value={form.privacyUrl} placeholder="https://" onChange={(event) => set("privacyUrl", event.target.value)} />
          </Field>
          <Field label="Terms of service URL" optional>
            <input className={inputClass} disabled={!canWrite} value={form.termsUrl} placeholder="https://" onChange={(event) => set("termsUrl", event.target.value)} />
          </Field>
        </div>
      </Panel>
      <p className="text-[13px] text-slate-500">
        Invoice tax id, prefix, footer, and currency stay in <Link className="font-medium text-brand" to="/admin/settings?tab=invoicing">Invoice details</Link>. New documents copy the legal name and address from here. Issued documents keep the copy they were created with.
      </p>
      {canWrite ? (
        <div className="flex items-center gap-3">
          <Button type="submit" loading={save.isPending} disabled={!dirty}>Save changes</Button>
          {dirty ? <span className="text-[12px] text-slate-500">Unsaved changes</span> : <span className="text-[12px] text-slate-400">Saved</span>}
        </div>
      ) : null}
      {initial.audit.length ? (
        <ul className="space-y-1 text-[12px] text-slate-500">
          {initial.audit.map((item) => (
            <li key={item.id}>{item.summary} · {item.actor} · {new Date(item.createdAt).toLocaleString()}</li>
          ))}
        </ul>
      ) : null}
    </form>
  );
}

function Section({ title, body }: { title: string; body: string }) {
  return (
    <div className="border-b border-slate-100 px-4 py-3">
      <h2 className="text-[13px] font-semibold">{title}</h2>
      <p className="mt-1 text-[13px] leading-5 text-slate-500">{body}</p>
    </div>
  );
}

function ColorField({ label, value, optional, disabled, onChange }: { label: string; value: string; optional?: boolean; disabled: boolean; onChange: (value: string) => void }) {
  return (
    <Field label={label} optional={optional}>
      <span className="flex items-center gap-2">
        <input type="color" aria-label={label} disabled={disabled} value={value || DEFAULT_PRIMARY_COLOR} className="h-10 w-12 cursor-pointer rounded-lg border border-slate-200 bg-white p-1 disabled:cursor-not-allowed" onChange={(event) => onChange(event.target.value.toUpperCase())} />
        <input className={inputClass} disabled={disabled} value={value} placeholder={optional ? "Optional" : "#4F46E5"} onChange={(event) => onChange(event.target.value)} />
      </span>
    </Field>
  );
}
