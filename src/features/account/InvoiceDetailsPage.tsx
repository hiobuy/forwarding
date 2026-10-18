import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, ReceiptText, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button, Card, ConfirmDialog, Dialog, EmptyState, ErrorState, Field, LoadingBlock, PageHeader, inputClass } from "../../components/ui";
import { useToast } from "../../components/toast";
import { ApiError, api } from "../../lib/api";

type Kind = "individual" | "business";

export type InvoiceProfile = {
  id: string;
  label: string;
  kind: Kind;
  name: string;
  taxId: string;
  email: string;
  address: string;
  countryRegion: string;
  isDefault: boolean;
};

const empty = { label: "", kind: "individual" as Kind, name: "", taxId: "", email: "", address: "", countryRegion: "", isDefault: false };

export function InvoiceDetailsPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<(typeof empty & { id?: string }) | null>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const query = useQuery({ queryKey: ["invoice-profiles"], queryFn: () => api<InvoiceProfile[]>("/api/invoice-profiles") });
  const save = useMutation({
    mutationFn: (body: typeof empty & { id?: string }) =>
      api<InvoiceProfile>(body.id ? `/api/invoice-profiles/${body.id}` : "/api/invoice-profiles", {
        method: body.id ? "PATCH" : "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: async () => {
      setEditing(null);
      toast({ title: "Invoice details saved.", tone: "success" });
      await queryClient.invalidateQueries({ queryKey: ["invoice-profiles"] });
      await queryClient.invalidateQueries({ queryKey: ["documents"] });
    },
    onError: (error) => toast({ title: error instanceof ApiError ? error.message : "Could not save invoice details.", tone: "danger" }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/invoice-profiles/${id}`, { method: "DELETE" }),
    onSuccess: async () => {
      setRemoveId(null);
      toast({ title: "Invoice details deleted.", tone: "success" });
      await queryClient.invalidateQueries({ queryKey: ["invoice-profiles"] });
    },
    onError: (error) => toast({ title: error instanceof ApiError ? error.message : "Could not delete invoice details.", tone: "danger" }),
  });
  const makeDefault = useMutation({
    mutationFn: (id: string) => api(`/api/invoice-profiles/${id}/default`, { method: "POST" }),
    onSuccess: async () => {
      toast({ title: "Default invoice details updated.", tone: "success" });
      await queryClient.invalidateQueries({ queryKey: ["invoice-profiles"] });
    },
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    save.mutate(editing);
  }

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Invoice details"
        subtitle="Save the name and tax details to print on shipping documents. Pick one when you download."
        action={<Button onClick={() => setEditing({ ...empty })}><Plus size={15} aria-hidden="true" /> Add details</Button>}
      />
      {query.isLoading ? <LoadingBlock rows={3} /> : null}
      {query.error ? <ErrorState message="Could not load invoice details." onRetry={() => void query.refetch()} /> : null}
      {query.data && query.data.length === 0 ? (
        <EmptyState icon={ReceiptText} title="No invoice details yet" body="Add a personal or business profile. New documents use the default one unless you choose another." />
      ) : null}
      {query.data && query.data.length > 0 ? (
        <ul className="space-y-3">
          {query.data.map((item) => (
            <li key={item.id}>
              <Card>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-ink">{item.label}</span>
                      {item.isDefault ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">Default</span> : null}
                    </div>
                    <p className="mt-1 text-[13px] text-slate-600">{item.name}</p>
                    <p className="mt-0.5 text-[12px] text-slate-500">
                      {item.kind === "business" ? "Business" : "Individual"}
                      {item.taxId ? ` · ${item.taxId}` : ""}
                      {item.email ? ` · ${item.email}` : ""}
                    </p>
                    {item.address || item.countryRegion ? <p className="mt-1 text-[12px] text-slate-500">{[item.address, item.countryRegion].filter(Boolean).join(", ")}</p> : null}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button size="sm" variant="ghost" aria-label={`Edit ${item.label}`} onClick={() => setEditing(item)}><Pencil size={14} aria-hidden="true" /></Button>
                    <Button size="sm" variant="ghost" aria-label={`Delete ${item.label}`} onClick={() => setRemoveId(item.id)}><Trash2 size={14} aria-hidden="true" /></Button>
                  </div>
                </div>
                {item.isDefault ? null : (
                  <Button className="mt-3" size="sm" variant="secondary" onClick={() => makeDefault.mutate(item.id)}>Use as default</Button>
                )}
              </Card>
            </li>
          ))}
        </ul>
      ) : null}
      {editing ? (
        <Dialog open title={editing.id ? "Edit invoice details" : "Add invoice details"} onClose={() => setEditing(null)}>
          <form className="space-y-4" onSubmit={onSubmit}>
            <Field label="Label" hint="Only you see this. For example, Personal or Company.">
              <input className={inputClass} value={editing.label} onChange={(event) => setEditing({ ...editing, label: event.target.value })} required />
            </Field>
            <Field label="Type">
              <select className={inputClass} value={editing.kind} onChange={(event) => setEditing({ ...editing, kind: event.target.value as Kind })}>
                <option value="individual">Individual</option>
                <option value="business">Business</option>
              </select>
            </Field>
            <Field label="Name on the document">
              <input className={inputClass} value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} required />
            </Field>
            {editing.kind === "business" ? (
              <Field label="Tax ID">
                <input className={inputClass} value={editing.taxId} onChange={(event) => setEditing({ ...editing, taxId: event.target.value })} required />
              </Field>
            ) : null}
            <Field label="Email" optional>
              <input className={inputClass} type="email" value={editing.email} onChange={(event) => setEditing({ ...editing, email: event.target.value })} />
            </Field>
            <Field label="Address" optional>
              <textarea className="min-h-20 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" value={editing.address} onChange={(event) => setEditing({ ...editing, address: event.target.value })} />
            </Field>
            <Field label="Country / region" optional>
              <input className={inputClass} value={editing.countryRegion} onChange={(event) => setEditing({ ...editing, countryRegion: event.target.value })} />
            </Field>
            <label className="flex items-center gap-2 text-[13px] text-slate-700">
              <input type="checkbox" checked={editing.isDefault} onChange={(event) => setEditing({ ...editing, isDefault: event.target.checked })} />
              Use as the default
            </label>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
              <Button type="submit" loading={save.isPending}>Save</Button>
            </div>
          </form>
        </Dialog>
      ) : null}
      <ConfirmDialog
        open={Boolean(removeId)}
        title="Delete these invoice details?"
        body="Documents already issued keep the details they were created with."
        confirmLabel="Delete"
        danger
        pending={remove.isPending}
        onClose={() => setRemoveId(null)}
        onConfirm={() => { if (removeId) remove.mutate(removeId); }}
      />
    </div>
  );
}
