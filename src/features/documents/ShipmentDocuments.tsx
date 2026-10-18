import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileText } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { formatDateTime } from "../../domain/dates";
import { Button, Card, Money } from "../../components/ui";
import { useToast } from "../../components/toast";
import { ApiError, api } from "../../lib/api";
import { downloadPdf, openPdf } from "../../lib/download";

type Kind = "proforma" | "shipping_invoice" | "payment_receipt" | "credit_note";

type DocumentRow = {
  id: string;
  number: string;
  kind: Kind;
  title: string;
  status: string;
  paymentStatus: string;
  relationStatus: string;
  totalFen: number;
  issuedAt: string;
  filename: string;
  voidReason: string | null;
  relatedNumber: string | null;
  billToName: string;
};

type Profile = { id: string; label: string; name: string; isDefault: boolean };

type State = {
  documents: DocumentRow[];
  capabilities: { proforma: boolean; shippingInvoice: boolean; receipt: boolean };
  sellerReady: boolean;
  profiles: Profile[];
};

const labels: Record<Kind, string> = {
  proforma: "Proforma Invoice",
  shipping_invoice: "Shipping Invoice",
  payment_receipt: "Payment Receipt",
  credit_note: "Credit Note",
};

export function ShipmentDocuments({ shipmentId, admin = false }: { shipmentId: string; admin?: boolean }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [voiding, setVoiding] = useState<DocumentRow | null>(null);
  const [reason, setReason] = useState("");
  const [profileId, setProfileId] = useState("");
  const profilePicked = useRef(false);
  const base = admin ? `/api/admin/shipments/${shipmentId}/documents` : `/api/shipments/${shipmentId}/documents`;
  const pdfBase = admin ? "/api/admin/documents" : "/api/documents";
  const query = useQuery({ queryKey: ["documents", admin ? "admin" : "customer", shipmentId], queryFn: () => api<State>(base) });
  useEffect(() => {
    if (profilePicked.current) return;
    const profiles = query.data?.profiles ?? [];
    const fallback = profiles.find((item) => item.isDefault) ?? profiles[0];
    if (fallback) setProfileId(fallback.id);
  }, [query.data]);
  const issue = useMutation({
    mutationFn: (kind: Kind) => api<DocumentRow>(base, { method: "POST", body: JSON.stringify({ kind, profileId: profileId || null }) }),
    onSuccess: async (row) => {
      await queryClient.invalidateQueries({ queryKey: ["documents", admin ? "admin" : "customer", shipmentId] });
      toast({ title: `${row.number} is ready.`, tone: "success" });
    },
    onError: (error) => toast({ title: error instanceof ApiError ? error.message : "Could not issue the document.", tone: "danger" }),
  });
  const voidDoc = useMutation({
    mutationFn: () => api(`/api/admin/documents/${voiding?.id}/void`, { method: "POST", body: JSON.stringify({ reason }) }),
    onSuccess: async () => {
      setVoiding(null);
      setReason("");
      await queryClient.invalidateQueries({ queryKey: ["documents", "admin", shipmentId] });
      toast({ title: "Document voided. The original amounts stay on record.", tone: "success" });
    },
    onError: (error) => toast({ title: error instanceof ApiError ? error.message : "Could not void the document.", tone: "danger" }),
  });
  const data = query.data;
  const active = (kind: Kind) => data?.documents.find((row) => row.kind === kind && row.status === "active");
  async function save(row: DocumentRow) {
    try {
      await downloadPdf(`${pdfBase}/${row.id}/pdf`, row.filename);
    } catch (error) {
      toast({ title: error instanceof ApiError ? error.message : "Could not download the document.", tone: "danger" });
    }
  }
  async function preview(row: DocumentRow) {
    try {
      await openPdf(`${pdfBase}/${row.id}/pdf?inline=1`);
    } catch (error) {
      toast({ title: error instanceof ApiError ? error.message : "Could not preview the document.", tone: "danger" });
    }
  }

  return (
    <Card>
      <div className="text-[13px] font-semibold">Documents</div>
      <p className="mt-1 text-[12px] leading-5 text-slate-500">Shipping service documents. These are not customs commercial invoices. Choose invoice details before creating one. Issued documents keep that choice.</p>
      {data && !data.sellerReady ? (
        <p className="mt-3 text-[13px] leading-5 text-slate-600">
          {admin ? (
            <>Add the business name in <Link className="font-medium text-ink underline" to="/admin/settings?tab=invoicing">Settings → Invoice details</Link> before issuing a document.</>
          ) : (
            <>Invoices open after the operator adds a business name.</>
          )}
        </p>
      ) : null}
      {query.isLoading ? <p className="mt-3 text-[13px] text-slate-500">Loading documents…</p> : null}
      {query.error ? <p className="mt-3 text-[13px] text-red-700">Could not load documents.</p> : null}
      {data ? (
        <label className="mt-3 block text-[12px] font-medium text-slate-600">
          Invoice details
          <select className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-[13px]" value={profileId} onChange={(event) => { profilePicked.current = true; setProfileId(event.target.value); }}>
            <option value="">Account name</option>
            {data.profiles.map((item) => (
              <option key={item.id} value={item.id}>{item.label} · {item.name}{item.isDefault ? " · Default" : ""}</option>
            ))}
          </select>
          {admin ? null : <Link className="mt-1 inline-block font-normal text-slate-500 underline" to="/app/invoice-details">Manage invoice details</Link>}
        </label>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <IssueButton label={active("proforma") ? "Update proforma" : "Proforma"} show={Boolean(data?.sellerReady && data.capabilities.proforma)} loading={issue.isPending && issue.variables === "proforma"} onClick={() => issue.mutate("proforma")} />
        <IssueButton label={active("shipping_invoice")?.paymentStatus === "unpaid" ? "Update invoice" : "Invoice"} show={Boolean(data?.sellerReady && data.capabilities.shippingInvoice) && active("shipping_invoice")?.paymentStatus !== "paid"} loading={issue.isPending && issue.variables === "shipping_invoice"} onClick={() => issue.mutate("shipping_invoice")} />
        <IssueButton label="Receipt" show={Boolean(data?.sellerReady && data.capabilities.receipt) && !active("payment_receipt")} loading={issue.isPending && issue.variables === "payment_receipt"} onClick={() => issue.mutate("payment_receipt")} />
      </div>
      {data && data.documents.length === 0 ? <p className="mt-3 text-[13px] text-slate-500">No documents yet.</p> : null}
      {data && data.documents.length > 0 ? (
        <ul className="mt-3 divide-y divide-slate-100">
          {data.documents.map((row) => (
            <li key={row.id} className="py-2.5 text-[13px]">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium text-ink">{labels[row.kind]}</div>
                  <div className="mt-0.5 text-[12px] text-slate-500">
                    {row.number} · {formatDateTime(row.issuedAt)} · <Money fen={row.totalFen} />
                  </div>
                  <div className="mt-1 text-[12px] text-slate-500">
                    {statusLabel(row)}
                    {row.billToName ? ` · ${row.billToName}` : ""}
                    {row.relatedNumber ? ` · Ref ${row.relatedNumber}` : ""}
                    {row.voidReason ? ` · ${row.voidReason}` : ""}
                  </div>
                </div>
                <FileText size={15} className="mt-0.5 shrink-0 text-slate-400" aria-hidden="true" />
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={() => void preview(row)}>Preview</Button>
                <Button size="sm" variant="secondary" onClick={() => void save(row)}>
                  <Download size={13} aria-hidden="true" /> PDF
                </Button>
                {admin && row.status === "active" && row.paymentStatus === "unpaid" && (row.kind === "proforma" || row.kind === "shipping_invoice") ? (
                  <Button size="sm" variant="ghost" onClick={() => { setVoiding(row); setReason(""); }}>Void</Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {voiding ? (
        <form
          className="mt-3 border-t border-slate-100 pt-3"
          onSubmit={(event) => {
            event.preventDefault();
            voidDoc.mutate();
          }}
        >
          <label className="block text-[12px] font-medium text-slate-600">
            Reason for voiding {voiding.number}
            <input className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-[13px]" value={reason} onChange={(event) => setReason(event.target.value)} required />
          </label>
          <div className="mt-2 flex gap-2">
            <Button size="sm" type="submit" loading={voidDoc.isPending} disabled={!reason.trim()}>Void document</Button>
            <Button size="sm" type="button" variant="ghost" onClick={() => setVoiding(null)}>Cancel</Button>
          </div>
        </form>
      ) : null}
    </Card>
  );
}

function IssueButton({ label, show, loading, onClick }: { label: string; show: boolean; loading: boolean; onClick: () => void }) {
  if (!show) return null;
  return (
    <Button size="sm" variant="secondary" loading={loading} onClick={onClick}>
      {label}
    </Button>
  );
}

function statusLabel(row: DocumentRow) {
  const issued = row.status === "void" ? "Void" : paymentLabel(row.paymentStatus);
  if (row.relationStatus === "refunded") return `${issued} · Refunded`;
  if (row.relationStatus === "partially_refunded") return `${issued} · Partially refunded`;
  return issued;
}

function paymentLabel(status: string) {
  if (status === "paid") return "Paid";
  if (status === "partial") return "Partially paid";
  if (status === "refunded") return "Refunded";
  if (status === "partially_refunded") return "Partially refunded";
  return "Unpaid";
}
