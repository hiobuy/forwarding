import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useToast } from "../../components/toast";
import { Button, ErrorState, Field, LoadingBlock, inputClass } from "../../components/ui";
import { ApiError, api } from "../../lib/api";
import { cn } from "../../lib/utils";
import { Panel, filterControl, useDemoPreview } from "./shared";

type Smtp = {
  configured: boolean;
  host: string;
  port: number;
  encryption: "starttls" | "tls";
  username: string;
  passwordSet: boolean;
  passwordFromEnvironment: boolean;
  senderName: string;
  senderNameFallback: string;
  senderEmail: string;
  replyTo: string;
  platformName: string;
  hostFromEnvironment: boolean;
};
type Template = { id: string; name: string; variables: string[]; subject: string; body: string; customized: boolean };
type Rules = { security: { event: string; label: string; required: boolean }[]; business: { event: string; label: string; enabled: boolean }[] };
type Log = { id: string; to: string; event: string; subject: string; relatedType: string | null; relatedId: string | null; status: string; attempts: number; lastError: string | null; createdAt: string; sentAt: string | null };
type LogPage = { items: Log[]; page: number; total: number };

export function AdminEmail() {
  const demo = useDemoPreview();
  const [section, setSection] = useState<"smtp" | "templates" | "rules" | "logs">("smtp");
  return (
    <div>
      {demo ? <p className="mb-3 text-[13px] text-slate-500">Sample mailbox. Passwords stay hidden, and mail is not sent.</p> : null}
      <div className="mb-4 flex gap-1 overflow-x-auto" role="tablist" aria-label="Email">
        {(
          [
            ["smtp", "SMTP"],
            ["templates", "Templates"],
            ["rules", "Notifications"],
            ["logs", "Logs"],
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={section === id} className={cn("rounded-md px-2.5 py-1.5 text-[13px]", section === id ? "bg-slate-100 font-medium text-ink" : "text-slate-500 hover:text-ink")} onClick={() => setSection(id)}>
            {label}
          </button>
        ))}
      </div>
      {section === "smtp" ? <SmtpForm /> : null}
      {section === "templates" ? <TemplateEditor /> : null}
      {section === "rules" ? <RuleEditor /> : null}
      {section === "logs" ? <LogList /> : null}
    </div>
  );
}

function SmtpForm() {
  const demo = useDemoPreview();
  const toast = useToast();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["admin", "email", "smtp"], queryFn: () => api<Smtp>("/api/admin/email/smtp") });
  const [draft, setDraft] = useState<Smtp | null>(null);
  const [password, setPassword] = useState("");
  const [testTo, setTestTo] = useState("");
  const form = draft ?? query.data ?? null;
  const save = useMutation({
    mutationFn: () => api("/api/admin/email/smtp", { method: "PUT", body: JSON.stringify({ ...(form ?? {}), password }) }),
    onSuccess: async () => {
      setPassword("");
      setDraft(null);
      await queryClient.invalidateQueries({ queryKey: ["admin", "email", "smtp"] });
      toast({ title: "Email settings saved.", tone: "success" });
    },
    onError: (reason) => toast({ title: reason instanceof ApiError ? reason.message : "Could not save email settings.", tone: "danger" }),
  });
  const test = useMutation({
    mutationFn: () => api("/api/admin/email/smtp/test", { method: "POST", body: "{}" }),
    onSuccess: () => toast({ title: "SMTP accepted the login. No message was sent.", tone: "success" }),
    onError: (reason) => toast({ title: reason instanceof ApiError ? reason.message : "SMTP test failed.", tone: "danger" }),
  });
  const send = useMutation({
    mutationFn: () => api("/api/admin/email/smtp/send-test", { method: "POST", body: JSON.stringify({ to: testTo }) }),
    onSuccess: () => toast({ title: "Test email handed to the mail server.", tone: "success" }),
    onError: (reason) => toast({ title: reason instanceof ApiError ? reason.message : "Could not send the test.", tone: "danger" }),
  });
  if (query.isLoading) return <LoadingBlock rows={4} />;
  if (!form) return <ErrorState message="Could not load email settings." onRetry={() => void query.refetch()} />;
  function set<K extends keyof Smtp>(key: K, value: Smtp[K]) {
    setDraft({ ...form!, [key]: value });
  }
  return (
    <Panel>
      <form className="space-y-4 px-4 py-4" onSubmit={(event) => { event.preventDefault(); if (!demo) save.mutate(); }}>
        <div>
          <h2 className="text-[13px] font-semibold">SMTP</h2>
          <p className="mt-1 text-[13px] text-slate-500">{form.configured ? "Mail delivery is configured." : "Messages stay queued until a mail server is configured."} {form.passwordFromEnvironment ? "The password comes from the environment." : form.passwordSet ? "A password is saved on the server." : "No password saved yet."}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="SMTP host"><input className={inputClass} value={form.host} onChange={(event) => set("host", event.target.value)} placeholder="smtp.example.com" /></Field>
          <Field label="Port"><input className={inputClass} inputMode="numeric" value={String(form.port || "")} onChange={(event) => set("port", Number(event.target.value.replace(/\D/g, "")) || 0)} /></Field>
          <Field label="Encryption">
            <select className={inputClass} value={form.encryption} onChange={(event) => set("encryption", event.target.value as Smtp["encryption"])}>
              <option value="starttls">STARTTLS</option>
              <option value="tls">SSL/TLS</option>
            </select>
          </Field>
          <Field label="Username"><input className={inputClass} value={form.username} onChange={(event) => set("username", event.target.value)} autoComplete="off" /></Field>
          <Field label="Password" hint={form.passwordSet ? "Leave blank to keep the saved password." : "Stored encrypted. It is never shown again."}>
            <input className={inputClass} type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" placeholder={form.passwordSet ? "••••••••" : ""} />
          </Field>
          <Field label="Sender name" optional hint={form.senderNameFallback ? `Leave blank to use ${form.senderNameFallback}.` : "Leave blank to use the business name."}><input className={inputClass} value={form.senderName} onChange={(event) => set("senderName", event.target.value)} /></Field>
          <Field label="Sender email"><input className={inputClass} type="email" value={form.senderEmail} onChange={(event) => set("senderEmail", event.target.value)} /></Field>
          <Field label="Reply-To" optional><input className={inputClass} type="email" value={form.replyTo} onChange={(event) => set("replyTo", event.target.value)} /></Field>
          <p className="text-[13px] leading-5 text-slate-500 sm:col-span-2">The name in the message, the logo, the button color, and customer links come from Business settings. SMTP stays here.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={save.isPending} disabled={demo}>Save configuration</Button>
          <Button type="button" variant="secondary" loading={test.isPending} disabled={demo} onClick={() => test.mutate()}>Test connection</Button>
        </div>
      </form>
      <form className="flex flex-col gap-3 border-t border-slate-100 px-4 py-4 sm:flex-row sm:items-end" onSubmit={(event) => { event.preventDefault(); send.mutate(); }}>
        <Field label="Send a test to"><input className={cn(inputClass, "sm:w-72")} type="email" required value={testTo} onChange={(event) => setTestTo(event.target.value)} placeholder="you@example.com" /></Field>
        <Button type="submit" variant="secondary" loading={send.isPending} disabled={demo}>Send test email</Button>
      </form>
    </Panel>
  );
}

function TemplateEditor() {
  const demo = useDemoPreview();
  const toast = useToast();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["admin", "email", "templates"], queryFn: () => api<Template[]>("/api/admin/email/templates") });
  const [selected, setSelected] = useState("verification");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [dirty, setDirty] = useState(false);
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null);
  const [testTo, setTestTo] = useState("");
  const current = query.data?.find((item) => item.id === selected);
  const shownSubject = dirty ? subject : current?.subject ?? "";
  const shownBody = dirty ? body : current?.body ?? "";
  const save = useMutation({
    mutationFn: () => api(`/api/admin/email/templates/${selected}`, { method: "PUT", body: JSON.stringify({ subject: shownSubject, body: shownBody }) }),
    onSuccess: async () => {
      setDirty(false);
      await queryClient.invalidateQueries({ queryKey: ["admin", "email", "templates"] });
      toast({ title: "Template saved.", tone: "success" });
    },
    onError: (reason) => toast({ title: reason instanceof ApiError ? reason.message : "Could not save the template.", tone: "danger" }),
  });
  const reset = useMutation({
    mutationFn: () => api(`/api/admin/email/templates/${selected}/reset`, { method: "POST", body: "{}" }),
    onSuccess: async () => {
      setDirty(false);
      await queryClient.invalidateQueries({ queryKey: ["admin", "email", "templates"] });
      toast({ title: "Template restored.", tone: "success" });
    },
    onError: (reason) => toast({ title: reason instanceof ApiError ? reason.message : "Could not restore the template.", tone: "danger" }),
  });
  const previewQuery = useMutation({
    mutationFn: () => api<{ subject: string; html: string }>(`/api/admin/email/templates/${selected}/preview`, { method: "POST", body: JSON.stringify({ subject: shownSubject, body: shownBody }) }),
    onSuccess: (result) => setPreview(result),
    onError: (reason) => toast({ title: reason instanceof ApiError ? reason.message : "Could not preview the template.", tone: "danger" }),
  });
  const send = useMutation({
    mutationFn: () => api(`/api/admin/email/templates/${selected}/test`, { method: "POST", body: JSON.stringify({ to: testTo }) }),
    onSuccess: () => toast({ title: "Template test handed to the mail server.", tone: "success" }),
    onError: (reason) => toast({ title: reason instanceof ApiError ? reason.message : "Could not send the template test.", tone: "danger" }),
  });
  if (query.isLoading) return <LoadingBlock rows={4} />;
  if (!query.data || !current) return <ErrorState message="Could not load templates." onRetry={() => void query.refetch()} />;
  return (
    <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
      <Panel>
        <ul className="py-1">
          {query.data.map((item) => (
            <li key={item.id}>
              <button type="button" className={cn("w-full px-3 py-2 text-left text-[13px]", item.id === selected ? "bg-slate-100 font-medium text-ink" : "text-slate-600 hover:bg-slate-50")} onClick={() => { setSelected(item.id); setDirty(false); setPreview(null); }}>
                {item.name}
              </button>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel>
        <form className="space-y-3 px-4 py-4" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[13px] font-semibold">{current.name}</h2>
            <Button type="button" variant="ghost" size="sm" loading={reset.isPending} disabled={demo} onClick={() => reset.mutate()}>Restore default</Button>
          </div>
          <p className="text-[12px] text-slate-500">Variables: {current.variables.map((item) => `{{${item}}}`).join(", ")}. A link can carry a button label, for example {`{{verification_url:Verify email}}`}.</p>
          <Field label="Subject"><input className={inputClass} value={shownSubject} onChange={(event) => { setSubject(event.target.value); setDirty(true); }} /></Field>
          <Field label="Body"><textarea className={cn(inputClass, "h-40 py-2")} value={shownBody} onChange={(event) => { setBody(event.target.value); setDirty(true); }} /></Field>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" loading={save.isPending} disabled={demo}>Save template</Button>
            <Button type="button" variant="secondary" loading={previewQuery.isPending} disabled={demo} onClick={() => previewQuery.mutate()}>Preview</Button>
          </div>
        </form>
        {preview ? (
          <div className="border-t border-slate-100 px-4 py-4">
            <p className="text-[13px] font-medium">{preview.subject}</p>
            <iframe title="Email preview" sandbox="" srcDoc={preview.html} className="mt-3 h-80 w-full rounded-md border border-slate-200 bg-white" />
          </div>
        ) : null}
        <form className="flex flex-col gap-3 border-t border-slate-100 px-4 py-4 sm:flex-row sm:items-end" onSubmit={(event) => { event.preventDefault(); send.mutate(); }}>
          <Field label="Send test"><input className={cn(inputClass, "sm:w-72")} type="email" required value={testTo} onChange={(event) => setTestTo(event.target.value)} /></Field>
          <Button type="submit" variant="secondary" loading={send.isPending} disabled={demo}>Send test</Button>
        </form>
      </Panel>
    </div>
  );
}

function RuleEditor() {
  const demo = useDemoPreview();
  const toast = useToast();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["admin", "email", "rules"], queryFn: () => api<Rules>("/api/admin/email/rules") });
  const save = useMutation({
    mutationFn: (enabled: Record<string, boolean>) => api("/api/admin/email/rules", { method: "PUT", body: JSON.stringify({ enabled }) }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "email", "rules"] });
      toast({ title: "Notification rules saved.", tone: "success" });
    },
    onError: (reason) => toast({ title: reason instanceof ApiError ? reason.message : "Could not save rules.", tone: "danger" }),
  });
  if (query.isLoading || !query.data) return query.isLoading ? <LoadingBlock rows={3} /> : <ErrorState message="Could not load notification rules." onRetry={() => void query.refetch()} />;
  const data = query.data;
  return (
    <Panel>
      <div className="border-b border-slate-100 px-4 py-3">
        <h2 className="text-[13px] font-semibold">Who receives mail</h2>
        <p className="mt-1 text-[13px] text-slate-500">Security mail is always sent. Business mail also follows each customer's own switches.</p>
      </div>
      <ul className="divide-y divide-slate-100">
        {data.security.map((item) => (
          <li key={item.event} className="flex items-center justify-between gap-3 px-4 py-3 text-[13px]">
            <span>{item.label}</span>
            <span className="text-[12px] text-slate-400">Always on</span>
          </li>
        ))}
        {data.business.map((item) => (
          <li key={item.event} className="flex items-center justify-between gap-3 px-4 py-3 text-[13px]">
            <span>{item.label}</span>
            <input type="checkbox" className="size-4" checked={item.enabled} disabled={demo} aria-label={item.label} onChange={(event) => {
              const enabled = Object.fromEntries(data.business.map((rule) => [rule.event, rule.event === item.event ? event.target.checked : rule.enabled]));
              save.mutate(enabled);
            }} />
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function LogList() {
  const demo = useDemoPreview();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const query = useQuery({
    queryKey: ["admin", "email", "logs", status, search, from, to, page],
    queryFn: () => api<LogPage>(`/api/admin/email/logs?${new URLSearchParams({ ...(status ? { status } : {}), ...(search ? { q: search } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}), page: String(page) })}`),
  });
  const retry = useMutation({
    mutationFn: (id: string) => api(`/api/admin/email/logs/${id}/retry`, { method: "POST", body: "{}" }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "email", "logs"] });
      toast({ title: "Retry queued.", tone: "success" });
    },
    onError: (reason) => toast({ title: reason instanceof ApiError ? reason.message : "Could not retry.", tone: "danger" }),
  });
  return (
    <Panel>
      <form className="flex flex-col gap-2 border-b border-slate-100 px-3 py-2 sm:flex-row sm:flex-wrap sm:items-center" onSubmit={(event) => { event.preventDefault(); setSearch(q.trim()); setPage(1); }}>
        <input className={cn(filterControl, "sm:w-40")} placeholder="Recipient" aria-label="Search recipient" value={q} onChange={(event) => setQ(event.target.value)} />
        <select className={cn(filterControl, "sm:w-32")} aria-label="Status" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
          <option value="">Any status</option>
          <option value="queued">Queued</option>
          <option value="sent">Accepted</option>
          <option value="failed">Failed</option>
        </select>
        <input className={cn(filterControl, "sm:w-36")} type="date" aria-label="From" value={from} onChange={(event) => { setFrom(event.target.value); setPage(1); }} />
        <input className={cn(filterControl, "sm:w-36")} type="date" aria-label="To" value={to} onChange={(event) => { setTo(event.target.value); setPage(1); }} />
        <Button type="submit" variant="secondary" size="sm">Search</Button>
      </form>
      <p className="border-b border-slate-100 px-4 py-2 text-[12px] text-slate-400">Sent means the mail server accepted the message. It is not a delivery receipt.</p>
      {query.isLoading ? <LoadingBlock rows={4} /> : null}
      {query.error ? <div className="p-4"><ErrorState message="Could not load email logs." onRetry={() => void query.refetch()} /></div> : null}
      {query.data && query.data.items.length === 0 ? <p className="px-4 py-10 text-center text-[13px] text-slate-500">No email in this view.</p> : null}
      <ul className="divide-y divide-slate-100">
        {query.data?.items.map((item) => (
          <li key={item.id} className="grid gap-1 px-4 py-3 text-[13px] sm:grid-cols-[minmax(0,1.2fr)_8rem_7rem_auto] sm:items-center">
            <span className="min-w-0">
              <span className="block truncate font-medium text-ink">{item.to}</span>
              <span className="block truncate text-[12px] text-slate-400">{item.event}{item.relatedId ? ` · ${item.relatedId}` : ""}</span>
            </span>
            <span className="text-[12px] text-slate-500">{item.status === "sent" ? "Accepted by mail server" : item.status}</span>
            <span className="text-[12px] text-slate-400">{new Date(item.createdAt).toLocaleString()}</span>
            <span className="text-right">
              {item.status === "failed" ? <Button size="sm" variant="ghost" loading={retry.isPending} disabled={demo} onClick={() => retry.mutate(item.id)}>Retry</Button> : null}
            </span>
            {item.lastError ? <span className="text-[12px] text-red-700 sm:col-span-4">{item.lastError}</span> : null}
          </li>
        ))}
      </ul>
      {query.data && query.data.total > 20 ? (
        <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2 text-[12px] text-slate-500">
          <span>{query.data.total} messages</span>
          <span className="flex gap-2">
            <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</Button>
            <Button size="sm" variant="secondary" disabled={page * 20 >= query.data.total} onClick={() => setPage((value) => value + 1)}>Next</Button>
          </span>
        </div>
      ) : null}
    </Panel>
  );
}
