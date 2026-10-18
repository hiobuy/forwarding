import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { Button, ErrorState, Field, LoadingBlock, inputClass } from "../../components/ui";
import { useToast } from "../../components/toast";
import { ApiError, api } from "../../lib/api";
import { openPdf } from "../../lib/download";
import { Panel } from "./shared";

type Settings = {
  businessName: string;
  businessAddress: string;
  countryRegion: string;
  taxId: string;
  contactEmail: string;
  invoicePrefix: string;
  invoiceFooter: string;
  paymentInstructions: string;
  defaultCurrency: string;
  taxRateBps: number;
  hasLogo: boolean;
  seller?: { businessName: string; businessAddress: string; countryRegion: string; contactEmail: string };
  fromBusiness?: boolean;
};

export function AdminInvoicing() {
  const query = useQuery({ queryKey: ["admin", "invoicing"], queryFn: () => api<Settings>("/api/admin/settings/invoicing") });
  if (query.isLoading) return <LoadingBlock rows={4} />;
  if (query.error || !query.data) return <ErrorState message="Could not load invoicing settings." onRetry={() => void query.refetch()} />;
  return <InvoicingForm key={query.dataUpdatedAt} initial={query.data} />;
}

function InvoicingForm({ initial }: { initial: Settings }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState(initial);
  const [logoVersion, setLogoVersion] = useState(0);
  const save = useMutation({
    mutationFn: () => api<Settings>("/api/admin/settings/invoicing", { method: "PUT", body: JSON.stringify(payload(form)) }),
    onSuccess: async (next) => {
      setForm(next);
      await queryClient.invalidateQueries({ queryKey: ["admin", "invoicing"] });
      toast({ title: "Invoicing settings saved. Issued documents keep their original details.", tone: "success" });
    },
    onError: (error) => toast({ title: error instanceof ApiError ? error.message : "Could not save invoicing settings.", tone: "danger" }),
  });
  const upload = useMutation({
    mutationFn: (file: File) => {
      const body = new FormData();
      body.set("file", file);
      return api("/api/admin/settings/invoicing/logo", { method: "POST", body });
    },
    onSuccess: async () => {
      setLogoVersion((value) => value + 1);
      setForm((current) => ({ ...current, hasLogo: true }));
      toast({ title: "Logo saved.", tone: "success" });
    },
    onError: (error) => toast({ title: error instanceof ApiError ? error.message : "Could not upload the logo.", tone: "danger" }),
  });
  const clear = useMutation({
    mutationFn: () => api("/api/admin/settings/invoicing/logo", { method: "DELETE" }),
    onSuccess: () => {
      setForm((current) => ({ ...current, hasLogo: false }));
      toast({ title: "Logo removed.", tone: "success" });
    },
  });
  function set<K extends keyof Settings>(key: K, value: Settings[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }
  return (
    <form
      className="max-w-3xl space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <Panel>
        <div className="border-b border-slate-100 px-4 py-3">
          <h2 className="text-[13px] font-semibold">Your business on the invoice</h2>
          <p className="mt-1 text-[13px] leading-5 text-slate-500">
            These details print on new shipping documents. Saving them does not change documents that are already issued. This is one fixed layout, and it does not turn a receipt into a local tax invoice unless you enter the tax id and rate required where you operate.
          </p>
        </div>
        <div className="grid gap-4 px-4 py-4 sm:grid-cols-2">
          {form.fromBusiness && form.seller ? (
            <div className="sm:col-span-2 rounded-lg bg-slate-50 px-3 py-3 text-[13px] leading-5 text-slate-600">
              <p className="font-medium text-ink">{form.seller.businessName || "Business name not set"}</p>
              {form.seller.businessAddress ? <p className="mt-1 whitespace-pre-wrap">{form.seller.businessAddress}</p> : null}
              {form.seller.countryRegion ? <p>{form.seller.countryRegion}</p> : null}
              <p className="mt-2"><Link className="font-medium text-brand" to="/admin/settings?tab=business">Edit company details in Business</Link></p>
            </div>
          ) : (
            <>
              <Field label="Business name" hint="Used until Business settings has a name. The PDF uses a standard font.">
                <input className={inputClass} value={form.businessName} onChange={(event) => set("businessName", event.target.value)} />
              </Field>
              <Field label="Business address" optional>
                <textarea className={`${inputClass} h-24 py-2`} value={form.businessAddress} onChange={(event) => set("businessAddress", event.target.value)} />
              </Field>
              <Field label="Country / region" optional>
                <input className={inputClass} value={form.countryRegion} onChange={(event) => set("countryRegion", event.target.value)} />
              </Field>
            </>
          )}
          <Field label="Invoice contact email" optional hint="Leave blank to use the business email.">
            <input className={inputClass} type="email" value={form.contactEmail} onChange={(event) => set("contactEmail", event.target.value)} />
          </Field>
          <Field label="Tax ID / VAT number" optional hint="Leave this empty if you are not issuing a statutory tax invoice.">
            <input className={inputClass} value={form.taxId} onChange={(event) => set("taxId", event.target.value)} />
          </Field>
          <Field label="Invoice prefix" hint={`2 to 8 letters or numbers. Numbers look like ${form.invoicePrefix.length >= 2 ? form.invoicePrefix : "INV"}-${new Date().getFullYear()}-0001.`}>
            <input className={inputClass} value={form.invoicePrefix} maxLength={8} onChange={(event) => set("invoicePrefix", event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8))} />
          </Field>
          <Field label="Default currency">
            <input className={inputClass} value={form.defaultCurrency} maxLength={3} onChange={(event) => set("defaultCurrency", event.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3))} />
          </Field>
          <Field label="Tax rate %" optional hint="Included in the billed freight. 0 means tax is not applied. The customer total stays the amount already charged.">
            <input
              className={inputClass}
              inputMode="decimal"
              value={bpsToPercent(form.taxRateBps)}
              onChange={(event) => set("taxRateBps", percentToBps(event.target.value))}
            />
          </Field>
          <Field label="Invoice logo" optional hint="PNG or JPEG, up to 512 KB. New documents use the Business primary logo when that file is a PNG or JPEG.">
            <div className="flex items-center gap-3">
              {form.hasLogo ? <img src={`/api/admin/settings/invoicing/logo?v=${logoVersion}`} alt="Business logo" className="h-10 max-w-24 object-contain" /> : <span className="text-[13px] font-normal text-slate-400">No logo</span>}
              <input
                type="file"
                accept="image/png,image/jpeg"
                className="text-[12px]"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) upload.mutate(file);
                }}
              />
              {form.hasLogo ? (
                <Button type="button" size="sm" variant="ghost" onClick={() => clear.mutate()}>
                  Remove
                </Button>
              ) : null}
            </div>
          </Field>
          <Field label="Invoice footer" optional>
            <textarea className={`${inputClass} h-20 py-2`} value={form.invoiceFooter} onChange={(event) => set("invoiceFooter", event.target.value)} />
          </Field>
          <Field label="Payment instructions" optional>
            <textarea className={`${inputClass} h-20 py-2`} value={form.paymentInstructions} onChange={(event) => set("paymentInstructions", event.target.value)} />
          </Field>
        </div>
      </Panel>
      <div className="flex gap-2">
        <Button type="submit" loading={save.isPending}>Save</Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            void openPdf("/api/admin/settings/invoicing/preview", { method: "POST", body: JSON.stringify(payload(form)) }).catch((error) => {
              toast({ title: error instanceof ApiError ? error.message : "Could not preview the template.", tone: "danger" });
            });
          }}
        >
          Preview template
        </Button>
      </div>
    </form>
  );
}

function payload(form: Settings) {
  return {
    businessName: form.businessName,
    businessAddress: form.businessAddress,
    countryRegion: form.countryRegion,
    taxId: form.taxId,
    contactEmail: form.contactEmail,
    invoicePrefix: form.invoicePrefix || "INV",
    invoiceFooter: form.invoiceFooter,
    paymentInstructions: form.paymentInstructions,
    defaultCurrency: form.defaultCurrency || "USD",
    taxRateBps: form.taxRateBps,
  };
}

function bpsToPercent(bps: number) {
  return (bps / 100).toString();
}

function percentToBps(value: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.min(10_000, Math.round(parsed * 100));
}
