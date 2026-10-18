import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Button, Field, Notice, PasswordInput, inputClass } from "../../components/ui";
import { Ms } from "../site/icon";
import { Checkbox } from "../../components/ui/checkbox";
import { api } from "../../lib/api";
import { useBrand, usePageTitle } from "../../lib/brand";
import { authClient } from "../../lib/auth";
import { authHeaders, TurnstileField } from "./TurnstileField";

function AuthFrame({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  usePageTitle(title);
  return (
    <section>
      <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">{title}</h1>
      {subtitle ? <p className="mt-2 text-sm leading-6 text-slate-500">{subtitle}</p> : null}
      <div className="mt-6">{children}</div>
      {footer ? <div className="mt-6 border-t border-slate-200 pt-4 text-sm text-slate-500">{footer}</div> : null}
    </section>
  );
}

type PublicSecurity = { google: { enabled: boolean }; turnstile: { enabled: boolean; siteKey: string; login: boolean; register: boolean; reset: boolean } };

function GoogleButton({ callbackURL }: { callbackURL: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="mt-4">
      <div className="mb-4 flex items-center gap-3 text-[12px] text-slate-400"><span className="h-px flex-1 bg-slate-200" />or<span className="h-px flex-1 bg-slate-200" /></div>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Button
        className="w-full"
        size="lg"
        variant="secondary"
        type="button"
        loading={pending}
        onClick={() => {
          setPending(true);
          setError("");
          void authClient.signIn.social({ provider: "google", callbackURL }).then((result) => {
            if (result.error) {
              setPending(false);
              setError(result.error.message ?? "Google sign-in did not start.");
            }
          });
        }}
      >
        Continue with Google
      </Button>
    </div>
  );
}

function LegalLinks() {
  const brand = useBrand();
  return (
    <p className="text-[13px] text-slate-400">
      <PolicyLink href={brand.website.termsUrl} to="/terms">Terms</PolicyLink>
      <span className="px-1.5">·</span>
      <PolicyLink href={brand.website.privacyUrl} to="/privacy">Privacy</PolicyLink>
      {brand.supportEmail ? (
        <>
          <span className="px-1.5">·</span>
          <a className="underline decoration-slate-300 underline-offset-2 hover:text-ink" href={`mailto:${brand.supportEmail}`}>{brand.supportEmail}</a>
        </>
      ) : null}
    </p>
  );
}

function PolicyLink({ href, to, children }: { href: string; to: string; children: ReactNode }) {
  const className = "underline decoration-slate-300 underline-offset-2 hover:text-ink";
  if (href) return <a className={className} href={href}>{children}</a>;
  return <Link className={className} to={to}>{children}</Link>;
}

export function LoginPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [needsCode, setNeedsCode] = useState(false);
  const [useBackup, setUseBackup] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileReset, setTurnstileReset] = useState(0);
  const security = useQuery({ queryKey: ["security-public"], queryFn: () => api<PublicSecurity>("/api/security/public") });
  const next = params.get("next");
  const destination = safeNext(next);
  const turnstileOn = Boolean(security.data?.turnstile.enabled && security.data.turnstile.login && security.data.turnstile.siteKey);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (turnstileOn && !turnstileToken) {
      setError("Complete the security check and try again.");
      return;
    }
    setPending(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "");
    const result = await authClient.signIn.email({ email, password: String(form.get("password") ?? ""), ...authHeaders(turnstileToken) });
    setPending(false);
    if (result.error) {
      setTurnstileToken("");
      setTurnstileReset((value) => value + 1);
      setError(result.error.message ?? "Could not sign in.");
      if (result.error.code === "EMAIL_NOT_VERIFIED") navigate(`/auth/verify-email?email=${encodeURIComponent(email)}`);
      return;
    }
    if (result.data && "twoFactorRedirect" in result.data && result.data.twoFactorRedirect) {
      setNeedsCode(true);
      return;
    }
    navigate(destination);
  }

  async function onCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const code = String(new FormData(event.currentTarget).get("code") ?? "").trim();
    const result = useBackup ? await authClient.twoFactor.verifyBackupCode({ code }) : await authClient.twoFactor.verifyTotp({ code });
    setPending(false);
    if (result.error) {
      setError(result.error.message ?? "That code was not accepted.");
      return;
    }
    navigate(destination);
  }

  return (
    <AuthFrame
      title="Sign in"
      subtitle="Use the email you verified for your forwarding account."
      footer={<div className="flex items-center justify-between gap-3"><LegalLinks /><Link className="font-medium text-ink" to={next ? `/auth/register?next=${encodeURIComponent(destination)}` : "/auth/register"}>Create account</Link></div>}
    >
      {needsCode ? (
        <form className="space-y-4" onSubmit={(event) => void onCode(event)}>
          {error ? <Notice tone="danger">{error}</Notice> : null}
          <Field label={useBackup ? "Backup code" : "Authenticator code"}>
            <input className={inputClass} name="code" inputMode={useBackup ? "text" : "numeric"} autoComplete="one-time-code" required autoFocus />
          </Field>
          <Button type="submit" className="w-full" loading={pending}>{useBackup ? "Use backup code" : "Verify"}</Button>
          <button type="button" className="text-[13px] font-medium text-slate-500 hover:text-ink" onClick={() => { setUseBackup((value) => !value); setError(""); }}>
            {useBackup ? "Use an authenticator code" : "Use a backup code"}
          </button>
        </form>
      ) : (
        <>
          <form className="space-y-5" onSubmit={(event) => void onSubmit(event)}>
            {params.get("reset") ? <Notice tone="success">Password updated. Sign in with the new one.</Notice> : null}
            <label className="block text-sm font-semibold text-slate-700" htmlFor="login-email">
              Email address
              <span className="relative mt-1.5 block">
                <Ms name="mail" className="pointer-events-none absolute top-3.5 left-3.5 text-[16px] text-slate-400" />
                <input id="login-email" className="auth-input" name="email" type="email" autoComplete="email" placeholder="name@email.com" required autoFocus />
              </span>
            </label>
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label className="text-sm font-semibold text-slate-700" htmlFor="login-password">Password</label>
                <Link className="text-xs font-semibold text-[#087b73] hover:underline" to="/auth/forgot-password">Forgot password?</Link>
              </div>
              <span className="relative block">
                <Ms name="lock" className="pointer-events-none absolute top-3.5 left-3.5 z-10 text-[16px] text-slate-400" />
                <PasswordInput id="login-password" className="auth-input" name="password" autoComplete="current-password" minLength={8} placeholder="Password" />
              </span>
            </div>
            {error ? <Notice tone="danger">{error}</Notice> : null}
            {turnstileOn && security.data ? <TurnstileField siteKey={security.data.turnstile.siteKey} onToken={setTurnstileToken} resetKey={turnstileReset} /> : null}
            <button className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-[#087b73] px-5 py-3.5 text-sm font-semibold text-white shadow-md shadow-teal-900/10 transition hover:bg-[#06635c] focus-visible:ring-4 focus-visible:ring-teal-500/25 disabled:opacity-60" type="submit" disabled={pending}>
              {pending ? "Signing in…" : "Sign in to dashboard"}
              <Ms name="arrow_forward" className="text-[16px]" />
            </button>
          </form>
          {security.data?.google.enabled ? <GoogleButton callbackURL={destination} /> : null}
        </>
      )}
    </AuthFrame>
  );
}

function safeNext(next: string | null) {
  if (next?.startsWith("/auth/invite")) return next;
  if (next === "/admin/demo" || next?.startsWith("/admin/demo/")) return next;
  return "/app/dashboard";
}

export function RegisterPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const brand = useBrand();
  const destination = safeNext(params.get("next"));
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileReset, setTurnstileReset] = useState(0);
  const security = useQuery({ queryKey: ["security-public"], queryFn: () => api<PublicSecurity>("/api/security/public") });
  const turnstileOn = Boolean(security.data?.turnstile.enabled && security.data.turnstile.register && security.data.turnstile.siteKey);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accepted) {
      setError("Accept the Terms of Service and Privacy Notice to create an account.");
      return;
    }
    if (turnstileOn && !turnstileToken) {
      setError("Complete the security check and try again.");
      return;
    }
    setPending(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "");
    const result = await authClient.signUp.email({
      email,
      name: String(form.get("name") ?? ""),
      password: String(form.get("password") ?? ""),
      callbackURL: destination,
      ...authHeaders(turnstileToken),
    });
    setPending(false);
    if (result.error) {
      setTurnstileToken("");
      setTurnstileReset((value) => value + 1);
      setError(result.error.message ?? "Could not create the account.");
      return;
    }
    navigate(`/auth/verify-email?email=${encodeURIComponent(email)}`);
  }

  return (
    <AuthFrame
      title="Create account"
      subtitle="After you verify your email, we assign a member code for the China warehouse."
      footer={<div className="flex items-center justify-between gap-3"><LegalLinks /><Link className="font-medium text-ink" to={destination === "/app/dashboard" ? "/auth/login" : `/auth/login?next=${encodeURIComponent(destination)}`}>Sign in</Link></div>}
    >
      <form className="space-y-4" onSubmit={(event) => void onSubmit(event)}>
        <Field label="Name">
          <input className={inputClass} name="name" autoComplete="name" required />
        </Field>
        <Field label="Email">
          <input className={inputClass} name="email" type="email" autoComplete="email" required />
        </Field>
        <Field label="Password" hint="At least 8 characters. You'll use it to pay freight and manage parcels.">
          <PasswordInput name="password" autoComplete="new-password" minLength={8} />
        </Field>
        <label className="flex items-start gap-2.5 text-[13px] leading-5 text-slate-600">
          <Checkbox className="mt-0.5" checked={accepted} onCheckedChange={(value) => setAccepted(value === true)} aria-label="Accept terms and privacy notice" />
          <span>
            I agree to the <PolicyLink href={brand.website.termsUrl} to="/terms">Terms of Service</PolicyLink> and <PolicyLink href={brand.website.privacyUrl} to="/privacy">Privacy Notice</PolicyLink>. The member code must appear on parcels sent to the warehouse.
          </span>
        </label>
        {error ? <Notice tone="danger">{error}</Notice> : null}
        {turnstileOn && security.data ? <TurnstileField siteKey={security.data.turnstile.siteKey} onToken={setTurnstileToken} resetKey={turnstileReset} /> : null}
        <Button className="w-full" size="lg" type="submit" loading={pending} disabled={!accepted}>{pending ? "Creating account…" : "Create account"}</Button>
      </form>
      {security.data?.google.enabled ? <GoogleButton callbackURL={destination} /> : null}
    </AuthFrame>
  );
}

export function VerifyPage() {
  const [params] = useSearchParams();
  const email = params.get("email") ?? "";
  const mailbox = useQuery({
    queryKey: ["mailbox", email],
    enabled: email.length > 0,
    refetchInterval: 3000,
    queryFn: () => api<{ id: string; subject: string; url: string; body: string }[]>(`/api/dev/mailbox?email=${encodeURIComponent(email)}`),
  });
  const link = mailbox.data?.find((item) => item.subject.toLowerCase().includes("verify"));

  return (
    <AuthFrame title="Verify your email" subtitle="The warehouse account stays closed until this address is confirmed. The link expires in one hour." footer={<LegalLinks />}>
      <p className="text-sm text-slate-600">
        We sent a verification link to <span className="font-medium text-ink">{email || "your email"}</span>.
      </p>
      {link ? (
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm">
          <p className="text-[12px] font-medium text-slate-500">Development inbox</p>
          <p className="mt-1.5 text-slate-600">{link.body}</p>
          <a className="mt-3 inline-flex text-[13px] font-medium text-ink underline decoration-slate-300 underline-offset-2" href={link.url}>Open verification link</a>
        </div>
      ) : (
        <p className="mt-4 flex items-center gap-2 text-sm text-slate-500" role="status">
          <span className="size-2 animate-pulse rounded-full bg-indigo-400" aria-hidden="true" />
          Waiting for the verification message…
        </p>
      )}
      <Link className="mt-5 inline-flex text-sm font-medium text-slate-500 hover:text-ink" to="/auth/login">Back to sign in</Link>
    </AuthFrame>
  );
}

export function ForgotPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileReset, setTurnstileReset] = useState(0);
  const security = useQuery({ queryKey: ["security-public"], queryFn: () => api<PublicSecurity>("/api/security/public") });
  const turnstileOn = Boolean(security.data?.turnstile.enabled && security.data.turnstile.reset && security.data.turnstile.siteKey);
  const mailbox = useQuery({
    queryKey: ["mailbox", email, sent],
    enabled: sent && email.length > 0,
    refetchInterval: 3000,
    queryFn: () => api<{ id: string; subject: string; url: string }[]>(`/api/dev/mailbox?email=${encodeURIComponent(email)}`),
  });
  const link = mailbox.data?.find((item) => item.subject.toLowerCase().includes("reset"));

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    const nextEmail = String(form.get("email") ?? "");
    if (turnstileOn && !turnstileToken) {
      setError("Complete the security check and try again.");
      return;
    }
    const result = await authClient.requestPasswordReset({ email: nextEmail, redirectTo: "/auth/reset-password", ...authHeaders(turnstileToken) });
    if (result.error) {
      setTurnstileToken("");
      setTurnstileReset((value) => value + 1);
      setError(result.error.message ?? "Could not send the reset email.");
      return;
    }
    setEmail(nextEmail);
    setSent(true);
  }

  return (
    <AuthFrame
      title="Reset password"
      subtitle="If this email has an account, we'll send one reset link. It expires in one hour and can be used once."
      footer={<div className="flex items-center justify-between gap-3"><LegalLinks /><Link className="font-medium text-ink" to="/auth/login">Back to sign in</Link></div>}
    >
      <form className="space-y-4" onSubmit={(event) => void onSubmit(event)}>
        <Field label="Email">
          <input className={inputClass} name="email" type="email" autoComplete="email" required defaultValue={email} />
        </Field>
        {error ? <Notice tone="danger">{error}</Notice> : null}
        {turnstileOn && security.data ? <TurnstileField siteKey={security.data.turnstile.siteKey} onToken={setTurnstileToken} resetKey={turnstileReset} /> : null}
        <Button className="w-full" size="lg" type="submit">Send reset link</Button>
      </form>
      {sent ? <p className="mt-4 text-sm leading-6 text-slate-600">Check that inbox. For security, this page does not say whether the account exists.</p> : null}
      {link ? (
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm">
          <p className="text-[12px] font-medium text-slate-500">Development inbox</p>
          <a className="mt-2 inline-flex text-[13px] font-medium text-ink underline decoration-slate-300 underline-offset-2" href={link.url}>Open reset link</a>
        </div>
      ) : null}
    </AuthFrame>
  );
}

export function ResetPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const token = params.get("token") ?? "";

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = String(new FormData(event.currentTarget).get("password") ?? "");
    const result = await authClient.resetPassword({ newPassword: password, token });
    if (result.error) {
      setError(result.error.message ?? "This reset link is invalid or expired.");
      return;
    }
    navigate("/auth/login?reset=1");
  }

  return (
    <AuthFrame title="Choose a new password" subtitle="Use at least 8 characters. This replaces the password for freight payments and account access." footer={<LegalLinks />}>
      <form className="space-y-4" onSubmit={(event) => void onSubmit(event)}>
        <Field label="New password">
          <PasswordInput name="password" minLength={8} autoComplete="new-password" />
        </Field>
        {error ? <Notice tone="danger">{error}</Notice> : null}
        {!token ? <Notice tone="danger">This reset link is incomplete. <Link className="font-medium underline" to="/auth/forgot-password">Request a new one</Link>.</Notice> : null}
        <Button className="w-full" size="lg" type="submit" disabled={!token}>Update password</Button>
      </form>
    </AuthFrame>
  );
}

export function ConfirmEmailPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [message, setMessage] = useState(token ? "Confirming your new email…" : "This confirmation link is incomplete.");
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    void api<{ email: string }>("/api/account/email/confirm", { method: "POST", body: JSON.stringify({ token }) })
      .then((result) => {
        if (cancelled) return;
        setDone(true);
        setMessage(`Email updated to ${result.email}. Sign in with that address.`);
      })
      .catch((reason) => {
        if (!cancelled) setMessage(reason instanceof Error ? reason.message : "This confirmation link could not be used.");
      });
    return () => {
      cancelled = true;
    };
  }, [token]);
  return (
    <AuthFrame title="Confirm email" subtitle={message} footer={<Link className="font-medium text-ink" to="/auth/login">{done ? "Sign in" : "Back to sign in"}</Link>}>
      <p className="text-sm text-slate-600">Your previous email stays active until this link is accepted.</p>
    </AuthFrame>
  );
}

