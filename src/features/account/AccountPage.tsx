import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { COUNTRIES } from "../../domain/countries";
import { Button, Field, Notice, PageHeader, PasswordInput, inputClass } from "../../components/ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { useToast } from "../../components/toast";
import { ApiError, api } from "../../lib/api";
import { useBrand } from "../../lib/brand";
import { authClient } from "../../lib/auth";

type Preferences = {
  emailEnabled: boolean;
  packageReceived: boolean;
  actionRequired: boolean;
  vasCompleted: boolean;
  paymentDue: boolean;
  shipmentShipped: boolean;
  shipmentDelivered: boolean;
};

type AccountMe = {
  name: string;
  email: string;
  phone: string | null;
  country: string | null;
  memberCode: string;
  preferences: Preferences | null;
  emailDeliveryConfigured: boolean;
  hasPassword: boolean;
  googleLinked: boolean;
  googleSignIn: boolean;
  pendingEmail: { email: string; expiresAt: string } | null;
};

export function AccountPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const brand = useBrand();
  const { data: session, refetch } = authClient.useSession();
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => api<AccountMe>("/api/me"),
  });
  const [passwordError, setPasswordError] = useState("");
  const [passwordPending, setPasswordPending] = useState(false);
  const [country, setCountry] = useState<string | null>(null);
  const [preferenceDraft, setPreferenceDraft] = useState<Preferences | null>(null);
  const save = useMutation({
    mutationFn: (body: { name: string; phone: string | null; country: string | null }) => api("/api/me", { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: async () => {
      await refetch();
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      toast({ title: "Profile saved.", tone: "success" });
    },
  });
  const prefs = useMutation({
    mutationFn: (body: Preferences) => api("/api/me/preferences", { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      setPreferenceDraft(null);
      toast({ title: "Notification preferences saved.", tone: "success" });
    },
  });

  async function onPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordError("");
    const target = event.currentTarget;
    const form = new FormData(target);
    setPasswordPending(true);
    const result = await authClient.changePassword({
      currentPassword: String(form.get("current") ?? ""),
      newPassword: String(form.get("next") ?? ""),
      revokeOtherSessions: true,
    });
    setPasswordPending(false);
    if (result.error) {
      setPasswordError(result.error.message ?? "Could not change the password.");
      return;
    }
    toast({ title: "Password changed. Other devices were signed out.", tone: "success" });
    target.reset();
  }

  async function logout() {
    await authClient.signOut();
    queryClient.clear();
    navigate("/auth/login");
  }

  const profile = me.data;
  const countryValue = country ?? profile?.country ?? "none";
  const preferences = preferenceDraft ?? profile?.preferences ?? null;

  const prefItems = [
    ["packageReceived", "Package received", "The warehouse checked in a parcel."],
    ["actionRequired", "Action required", "A parcel has an exception that needs your answer."],
    ["vasCompleted", "Service completed", "Extra photos or checks you asked for are done."],
    ["paymentDue", "Payment due", "Final freight is ready to pay."],
    ["shipmentShipped", "Shipment shipped", "The carrier picked up your shipment."],
    ["shipmentDelivered", "Shipment delivered", "The carrier confirmed delivery."],
  ] as const;

  return (
    <div className="max-w-3xl">
      <PageHeader title="Account" subtitle="Your profile, password, and notification settings." />
      <div className="divide-y divide-slate-200">
        <Section title="Profile" body="Your member code is fixed. It stays on every parcel sent to the warehouse.">
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              save.mutate({
                name: String(form.get("name") ?? ""),
                phone: String(form.get("phone") ?? "") || null,
                country: countryValue === "none" ? null : countryValue,
              });
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name"><input className={inputClass} name="name" required autoComplete="name" defaultValue={profile?.name ?? session?.user.name ?? ""} key={profile?.name} /></Field>
              <Field label="Member code"><input className={`${inputClass} font-mono`} value={profile?.memberCode ?? session?.user.memberCode ?? ""} readOnly aria-readonly="true" /></Field>
              <div className="sm:col-span-2">
                <Field label="Current email"><input className={inputClass} value={profile?.email ?? session?.user.email ?? ""} readOnly aria-readonly="true" /></Field>
              </div>
              <Field label="Phone" optional><input className={inputClass} name="phone" type="tel" autoComplete="tel" defaultValue={profile?.phone ?? ""} key={profile?.phone ?? "phone"} /></Field>
              <Field label="Country" optional>
                <Select value={countryValue} onValueChange={setCountry}>
                  <SelectTrigger aria-label="Country">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Not set</SelectItem>
                    {COUNTRIES.map((country) => <SelectItem key={country.code} value={country.code}>{country.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <Button type="submit" loading={save.isPending}>Save profile</Button>
          </form>
          {profile ? <EmailChange profile={profile} /> : null}
        </Section>
        <Section title="Password" body="Changing it signs you out on other devices.">
          <form className="space-y-4" onSubmit={(event) => void onPassword(event)}>
            <Field label="Current password"><PasswordInput name="current" autoComplete="current-password" /></Field>
            <Field label="New password" hint="At least 8 characters."><PasswordInput name="next" autoComplete="new-password" minLength={8} /></Field>
            {passwordError ? <Notice tone="danger">{passwordError}</Notice> : null}
            <Button type="submit" variant="secondary" loading={passwordPending}>Change password</Button>
          </form>
        </Section>
        {preferences ? (
          <Section title="Email notifications" body={profile?.emailDeliveryConfigured ? "Choose the business updates you want by email. Sign-in and password emails are always sent." : "Your choices are saved. Business email is sent after the operator connects a mail server. Sign-in and password emails are always attempted."}>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                prefs.mutate(preferences);
              }}
            >
              <label className="flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white px-4 py-3">
                <span>
                  <span className="block text-sm font-medium">Business emails</span>
                  <span className="block text-[12px] text-slate-500">Turns the optional updates below on or off. It does not stop security email.</span>
                </span>
                <Switch checked={preferences.emailEnabled} onChange={(value) => setPreferenceDraft({ ...preferences, emailEnabled: value })} label="Business emails" />
              </label>
              <div className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
                <div className="flex items-center justify-between gap-4 px-4 py-2.5">
                  <span>
                    <span className="block text-[13px] font-medium">Email verification and password reset</span>
                    <span className="block text-[12px] text-slate-500">Required account mail. You cannot turn these off.</span>
                  </span>
                  <Switch checked disabled onChange={() => undefined} label="Required account mail" />
                </div>
              </div>
              <div className={`mt-2 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white transition-opacity ${preferences.emailEnabled ? "" : "pointer-events-none opacity-50"}`} aria-disabled={!preferences.emailEnabled}>
                {prefItems.map(([key, label, hint]) => (
                  <label key={key} className="flex cursor-pointer items-center justify-between gap-4 px-4 py-2.5">
                    <span>
                      <span className="block text-[13px] font-medium">{label}</span>
                      <span className="block text-[12px] text-slate-500">{hint}</span>
                    </span>
                    <Switch checked={preferences[key]} disabled={!preferences.emailEnabled} onChange={(value) => setPreferenceDraft({ ...preferences, [key]: value })} label={label} />
                  </label>
                ))}
              </div>
              <Button className="mt-4" variant="secondary" type="submit" loading={prefs.isPending} disabled={!preferenceDraft}>
                Save preferences
              </Button>
            </form>
          </Section>
        ) : null}
        <Section title="Sign out" body={`Sign out of ${brand.name} on this device.`}>
          <Button variant="secondary" onClick={() => void logout()}>
            <LogOut size={15} aria-hidden="true" /> Log out
          </Button>
        </Section>
      </div>
    </div>
  );
}

function EmailChange({ profile }: { profile: AccountMe }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [unlinkPassword, setUnlinkPassword] = useState("");
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["me"] });
  const change = useMutation({
    mutationFn: () => api("/api/me/email", { method: "POST", body: JSON.stringify({ email, password, code }) }),
    onSuccess: async () => {
      setPassword("");
      setCode("");
      await refresh();
      toast({ title: "Check the new inbox. The current email stays active until you confirm.", tone: "success" });
    },
    onError: (reason) => toast({ title: reason instanceof ApiError ? reason.message : "Could not start the email change.", tone: "danger" }),
  });
  const challenge = useMutation({
    mutationFn: () => api("/api/me/email/challenge", { method: "POST", body: "{}" }),
    onSuccess: () => toast({ title: "Confirmation code sent to your current email.", tone: "success" }),
    onError: (reason) => toast({ title: reason instanceof ApiError ? reason.message : "Could not send the code.", tone: "danger" }),
  });
  const resend = useMutation({
    mutationFn: () => api("/api/me/email/resend", { method: "POST", body: "{}" }),
    onSuccess: async () => {
      await refresh();
      toast({ title: "Verification email sent again.", tone: "success" });
    },
    onError: (reason) => toast({ title: reason instanceof ApiError ? reason.message : "Could not resend.", tone: "danger" }),
  });
  const cancel = useMutation({
    mutationFn: () => api("/api/me/email/cancel", { method: "POST", body: "{}" }),
    onSuccess: async () => {
      await refresh();
      toast({ title: "Email change cancelled.", tone: "success" });
    },
    onError: (reason) => toast({ title: reason instanceof ApiError ? reason.message : "Could not cancel.", tone: "danger" }),
  });
  const unlink = useMutation({
    mutationFn: () => api("/api/me/google/unlink", { method: "POST", body: JSON.stringify({ password: unlinkPassword }) }),
    onSuccess: async () => {
      setUnlinkPassword("");
      await refresh();
      toast({ title: "Google was unlinked.", tone: "success" });
    },
    onError: (reason) => toast({ title: reason instanceof ApiError ? reason.message : "Could not unlink Google.", tone: "danger" }),
  });
  return (
    <div className="mt-6 space-y-4 border-t border-slate-100 pt-4">
      <h3 className="text-[13px] font-semibold">Change email</h3>
      {profile.pendingEmail ? (
        <div className="space-y-3">
          <Notice tone="warning">Verification pending for {profile.pendingEmail.email}. This account still uses {profile.email}.</Notice>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" loading={resend.isPending} onClick={() => resend.mutate()}>Resend verification</Button>
            <Button type="button" variant="ghost" loading={cancel.isPending} onClick={() => cancel.mutate()}>Cancel email change</Button>
          </div>
        </div>
      ) : (
        <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); change.mutate(); }}>
          <Field label="New email"><input className={inputClass} type="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></Field>
          {profile.hasPassword ? (
            <Field label="Current password"><PasswordInput value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" /></Field>
          ) : (
            <div className="space-y-2">
              <Field label="Code from your current email"><input className={inputClass} inputMode="numeric" value={code} onChange={(event) => setCode(event.target.value)} /></Field>
              <Button type="button" variant="secondary" loading={challenge.isPending} onClick={() => challenge.mutate()}>Email me a code</Button>
            </div>
          )}
          <Button type="submit" variant="secondary" loading={change.isPending}>Send verification</Button>
        </form>
      )}
      {profile.googleSignIn ? (
        <div className="space-y-2">
          {profile.googleLinked ? (
            <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); unlink.mutate(); }}>
              <p className="text-[13px] text-slate-500">Google is linked to this account.</p>
              <Field label="Password to unlink Google"><PasswordInput value={unlinkPassword} onChange={(event) => setUnlinkPassword(event.target.value)} autoComplete="current-password" /></Field>
              <Button type="submit" variant="secondary" loading={unlink.isPending}>Unlink Google</Button>
            </form>
          ) : (
            <Button type="button" variant="secondary" onClick={() => void authClient.linkSocial({ provider: "google", callbackURL: "/app/account" })}>Link Google</Button>
          )}
        </div>
      ) : null}
    </div>
  );
}

function Section({ title, body, children }: { title: string; body: string; children: ReactNode }) {
  return (
    <section className="grid gap-4 py-6 first:pt-0 md:grid-cols-[220px_minmax(0,1fr)] md:gap-8">
      <div>
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        <p className="mt-1 text-[13px] leading-5 text-slate-500">{body}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (value: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 focus-visible:outline-none ${checked ? "bg-brand" : "bg-slate-300"}`}
    >
      <span className={`inline-block size-4 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-[18px]" : "translate-x-0.5"}`} />
    </button>
  );
}
