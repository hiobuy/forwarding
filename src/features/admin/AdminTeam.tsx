import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { STAFF_ROLES, type StaffRole } from "../../domain/staff";
import { formatDateTime } from "../../domain/dates";
import { Button, ConfirmDialog, Dialog, Field, Notice, inputClass } from "../../components/ui";
import { useToast } from "../../components/toast";
import { ApiError, api } from "../../lib/api";
import { authClient } from "../../lib/auth";
import { useAdminAccess, useDemoPreview } from "./shared";

type Member = { userId: string; name: string; email: string; role: StaffRole; status: string; lastLoginAt: string | null };
type Invite = { id: string; email: string; role: string; expiresAt: string; state: "open" | "used" | "expired" };
type Audit = { id: string; actorEmail: string; action: string; target: string | null; createdAt: string };
type Team = { members: Member[]; invites: Invite[]; audit: Audit[] };

const ROLE_LABEL: Record<StaffRole, string> = { owner: "Owner", manager: "Manager", support: "Support" };

export function AdminTeam() {
  const query = useQuery({ queryKey: ["admin", "team"], queryFn: () => api<Team>("/api/admin/team") });
  const access = useAdminAccess();
  const demo = useDemoPreview();
  const [open, setOpen] = useState(false);
  if (query.isLoading) return <p className="text-sm text-slate-500">Loading team…</p>;
  if (query.error || !query.data) return <Notice tone="danger">{query.error instanceof ApiError ? query.error.message : "Could not load the team."}</Notice>;
  return (
    <fieldset disabled={demo} className="min-w-0 space-y-4 border-0 p-0 disabled:opacity-100">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] text-slate-500">{demo ? "Sample team. Invites and role changes are turned off." : "Invite a manager or support account. Links expire in 7 days and work once."}</p>
        <Button size="sm" disabled={demo} onClick={() => setOpen(true)}>Invite</Button>
      </div>
      <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
        {query.data.members.map((member) => (
          <MemberRow
            key={member.userId}
            member={member}
            self={access.data?.email === member.email}
            canReset={access.data?.role === "owner" && access.data.email !== member.email}
            soleOwner={member.role === "owner" && member.status === "active" && query.data.members.filter((item) => item.role === "owner" && item.status === "active").length <= 1}
          />
        ))}
      </ul>
      {query.data.invites.length ? (
        <section>
          <h2 className="mb-2 text-[13px] font-semibold">Open invites</h2>
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
            {query.data.invites.map((invite) => (
              <li key={invite.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-[13px]">
                <div>
                  <div className="font-medium text-ink">{invite.email}</div>
                  <div className="text-[12px] text-slate-500">{ROLE_LABEL[invite.role as StaffRole] ?? invite.role} · {invite.state} · {formatDateTime(invite.expiresAt)}</div>
                </div>
                {invite.state === "open" ? <Revoke id={invite.id} /> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <MfaCard enabled={Boolean(access.data?.mfaEnabled)} required={Boolean(access.data?.hiobuyPay2fa) && (access.data?.role === "owner" || access.data?.role === "manager")} />
      <section>
        <h2 className="mb-2 text-[13px] font-semibold">Recent sensitive activity</h2>
        {query.data.audit.length === 0 ? <p className="text-[13px] text-slate-500">No staff, payment, or secret changes yet.</p> : (
          <ul className="divide-y divide-slate-100 text-[13px]">
            {query.data.audit.map((entry) => (
              <li key={entry.id} className="flex flex-wrap justify-between gap-2 py-2">
                <span><span className="font-medium text-ink">{entry.action}</span> <span className="text-slate-500">{entry.actorEmail}</span></span>
                <span className="text-[12px] text-slate-400">{formatDateTime(entry.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <InviteDialog open={open} onClose={() => setOpen(false)} />
    </fieldset>
  );
}

function MemberRow({ member, self, soleOwner, canReset }: { member: Member; self: boolean; soleOwner: boolean; canReset: boolean }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [remove, setRemove] = useState(false);
  const role = useMutation({
    mutationFn: (next: StaffRole) => api(`/api/admin/team/${member.userId}`, { method: "PATCH", body: JSON.stringify({ role: next }) }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "team"] });
      toast({ title: "Role updated.", tone: "success" });
    },
    onError: (reason) => toast({ title: reason instanceof ApiError ? reason.message : "Could not change the role.", tone: "danger" }),
  });
  const status = useMutation({
    mutationFn: (next: "active" | "disabled") => api(`/api/admin/team/${member.userId}/${next === "disabled" ? "disable" : "enable"}`, { method: "POST", body: "{}" }),
    onSuccess: async (_data, next) => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "team"] });
      toast({ title: next === "disabled" ? "Staff member disabled. Their sessions were signed out." : "Staff member enabled.", tone: "success" });
    },
    onError: (reason) => toast({ title: reason instanceof ApiError ? reason.message : "Could not update this person.", tone: "danger" }),
  });
  const drop = useMutation({
    mutationFn: () => api(`/api/admin/team/${member.userId}`, { method: "DELETE" }),
    onSuccess: async () => {
      setRemove(false);
      await queryClient.invalidateQueries({ queryKey: ["admin", "team"] });
      toast({ title: "Removed from the team.", tone: "success" });
    },
    onError: (reason) => toast({ title: reason instanceof ApiError ? reason.message : "Could not remove this person.", tone: "danger" }),
  });
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <div className="truncate text-[13px] font-medium text-ink">{member.name}{self ? " · You" : ""}</div>
        <div className="truncate text-[12px] text-slate-500">{member.email}</div>
        <div className="text-[12px] text-slate-400">{member.status === "active" ? "Active" : "Disabled"} · Last login {member.lastLoginAt ? formatDateTime(member.lastLoginAt) : "—"}</div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select
          className={`${inputClass} h-8 w-32`}
          aria-label={`Role for ${member.email}`}
          value={member.role}
          disabled={soleOwner || role.isPending || member.status !== "active"}
          onChange={(event) => role.mutate(event.target.value as StaffRole)}
        >
          {STAFF_ROLES.map((item) => (
            <option key={item} value={item}>{ROLE_LABEL[item]}</option>
          ))}
        </select>
        {soleOwner ? <span className="text-[12px] text-slate-400">At least one owner is required</span> : null}
        {!soleOwner && member.status === "active" ? (
          <Button size="sm" variant="secondary" loading={status.isPending} onClick={() => status.mutate("disabled")}>Disable</Button>
        ) : null}
        {!soleOwner && member.status !== "active" ? (
          <Button size="sm" variant="secondary" loading={status.isPending} onClick={() => status.mutate("active")}>Enable</Button>
        ) : null}
        {!soleOwner ? <Button size="sm" variant="ghost" className="text-red-700" onClick={() => setRemove(true)}>Remove</Button> : null}
        {canReset ? <ResetFactor userId={member.userId} name={member.name} /> : null}
      </div>
      <ConfirmDialog open={remove} title={`Remove ${member.name}?`} body="They keep their customer account and lose admin access. Open sessions are signed out." confirmLabel="Remove" danger pending={drop.isPending} onClose={() => setRemove(false)} onConfirm={() => drop.mutate()} />
    </li>
  );
}

function Revoke({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const revoke = useMutation({
    mutationFn: () => api(`/api/admin/team/invites/${id}`, { method: "DELETE" }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "team"] });
      toast({ title: "Invite revoked.", tone: "success" });
    },
    onError: (reason) => toast({ title: reason instanceof ApiError ? reason.message : "Could not revoke the invite.", tone: "danger" }),
  });
  return <Button size="sm" variant="ghost" loading={revoke.isPending} onClick={() => revoke.mutate()}>Revoke</Button>;
}

function InviteDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<StaffRole>("support");
  const [link, setLink] = useState("");
  const invite = useMutation({
    mutationFn: () => api<{ inviteUrl: string }>("/api/admin/team/invites", { method: "POST", body: JSON.stringify({ email, role }) }),
    onSuccess: async (result) => {
      setLink(result.inviteUrl);
      setEmail("");
      await queryClient.invalidateQueries({ queryKey: ["admin", "team"] });
      toast({ title: "Invite created.", tone: "success" });
    },
    onError: (reason) => toast({ title: reason instanceof ApiError ? reason.message : "Could not send the invite.", tone: "danger" }),
  });
  return (
    <Dialog
      open={open}
      title="Invite staff"
      description="They set a password if they are new, or sign in if they already have an account."
      onClose={() => {
        setLink("");
        onClose();
      }}
      footer={<Button loading={invite.isPending} disabled={!email.trim()} onClick={() => invite.mutate()}>Create invite</Button>}
    >
      <div className="space-y-3">
        <Field label="Email">
          <input className={inputClass} type="email" value={email} autoComplete="off" onChange={(event) => setEmail(event.target.value)} />
        </Field>
        <Field label="Role">
          <select className={inputClass} value={role} onChange={(event) => setRole(event.target.value as StaffRole)}>
            {STAFF_ROLES.map((item) => (
              <option key={item} value={item}>{ROLE_LABEL[item]}</option>
            ))}
          </select>
        </Field>
        {link ? (
          <div className="space-y-2">
            <p className="text-[13px] text-slate-600">Copy this link. It is shown once.</p>
            <input className={inputClass} readOnly value={link} onFocus={(event) => event.currentTarget.select()} />
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}

function ResetFactor({ userId, name }: { userId: string; name: string }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const reset = useMutation({
    mutationFn: () => api(`/api/admin/team/${userId}/reset-2fa`, { method: "POST", body: "{}" }),
    onSuccess: async () => {
      setOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["admin", "team"] });
      toast({ title: "Authenticator reset. They must set it up again before paying HioBuy.", tone: "success" });
    },
    onError: (reason) => toast({ title: reason instanceof ApiError ? reason.message : "Could not reset the authenticator.", tone: "danger" }),
  });
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>Reset 2FA</Button>
      <ConfirmDialog open={open} title={`Reset authenticator for ${name}?`} body="Their current authenticator and recovery codes stop working. This is written to the audit log." confirmLabel="Reset 2FA" danger pending={reset.isPending} onClose={() => setOpen(false)} onConfirm={() => reset.mutate()} />
    </>
  );
}

function MfaCard({ enabled, required }: { enabled: boolean; required: boolean }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [password, setPassword] = useState("");
  const [setup, setSetup] = useState<{ secret: string; backupCodes: string[] } | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");

  async function enable() {
    setError("");
    const result = await authClient.twoFactor.enable({ password });
    if (result.error || !result.data || result.data.method !== "totp") {
      setError(result.error?.message ?? "Could not start authenticator setup.");
      return;
    }
    const secret = new URL(result.data.totpURI).searchParams.get("secret") ?? result.data.totpURI;
    setSetup({ secret, backupCodes: result.data.backupCodes });
  }

  async function confirm() {
    setError("");
    const result = await authClient.twoFactor.verifyTotp({ code });
    if (result.error) {
      setError(result.error.message ?? "That code was not accepted.");
      return;
    }
    await api("/api/admin/team/security", { method: "POST", body: JSON.stringify({ event: "mfa.enabled" }) }).catch(() => undefined);
    setSetup(null);
    setPassword("");
    setCode("");
    await queryClient.invalidateQueries({ queryKey: ["admin", "me"] });
    await queryClient.invalidateQueries({ queryKey: ["admin", "team"] });
    toast({ title: "Authenticator is on.", tone: "success" });
  }

  async function disable() {
    setError("");
    const result = await authClient.twoFactor.disable({ password });
    if (result.error) {
      setError(result.error.message ?? "Could not turn off the authenticator.");
      return;
    }
    await api("/api/admin/team/security", { method: "POST", body: JSON.stringify({ event: "mfa.disabled" }) }).catch(() => undefined);
    setPassword("");
    await queryClient.invalidateQueries({ queryKey: ["admin", "me"] });
    toast({ title: "Authenticator turned off.", tone: "success" });
  }

  return (
    <section className="rounded-xl border border-slate-200 px-4 py-3">
      <h2 className="text-[13px] font-semibold">Authenticator</h2>
      <p className="mt-1 text-[13px] text-slate-500">{required ? "An authenticator is required before you can pay HioBuy." : enabled ? "An authenticator app is required at sign-in." : "Optional. Add an authenticator app for this staff account."}</p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
        <Field label="Current password">
          <input className={`${inputClass} sm:w-64`} type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </Field>
        {enabled && !required ? (
          <Button variant="secondary" disabled={password.length < 8} onClick={() => void disable()}>Turn off</Button>
        ) : enabled ? null : (
          <Button variant="secondary" disabled={password.length < 8 || Boolean(setup)} onClick={() => void enable()}>Set up</Button>
        )}
      </div>
      {error ? <p className="mt-2 text-[13px] text-red-700">{error}</p> : null}
      {setup ? (
        <div className="mt-3 space-y-2 text-[13px]">
          <p>Add this key in your authenticator app, then enter the 6-digit code.</p>
          <input className={inputClass} readOnly value={setup.secret} onFocus={(event) => event.currentTarget.select()} />
          {setup.backupCodes.length ? <p className="text-slate-600">Backup codes: {setup.backupCodes.join(" ")}</p> : null}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <Field label="Code">
              <input className={`${inputClass} sm:w-40`} inputMode="numeric" value={code} onChange={(event) => setCode(event.target.value)} />
            </Field>
            <Button disabled={code.trim().length < 6} onClick={() => void confirm()}>Confirm</Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
