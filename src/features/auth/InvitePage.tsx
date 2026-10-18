import { useQuery } from "@tanstack/react-query";
import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Button, Field, Notice, PasswordInput, inputClass } from "../../components/ui";
import { ApiError, api } from "../../lib/api";
import { authClient } from "../../lib/auth";

type Preview = { email: string; role: string; expiresAt: string; hasAccount: boolean };

export function InvitePage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const preview = useQuery({
    queryKey: ["staff-invite", token],
    queryFn: () => api<Preview>(`/api/team/invites/${encodeURIComponent(token)}`),
    enabled: token.length > 0,
    retry: false,
  });
  if (!token) return <Frame title="Invite link missing" body="Ask an owner to send a new invite." />;
  if (preview.isLoading) return <Frame title="Checking invite" body="One moment." />;
  if (preview.error || !preview.data) {
    const message = preview.error instanceof ApiError ? preview.error.message : "This invite is not valid.";
    return <Frame title="Invite unavailable" body={message} />;
  }
  return <AcceptForm token={token} invite={preview.data} />;
}

function AcceptForm({ token, invite }: { token: string; invite: Preview }) {
  const navigate = useNavigate();
  const session = authClient.useSession();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const signedInEmail = session.data?.user.email?.toLowerCase() ?? "";
  const matches = signedInEmail === invite.email;
  const returnTo = `/auth/invite?token=${encodeURIComponent(token)}`;

  async function accept(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      await api("/api/team/accept", {
        method: "POST",
        body: JSON.stringify({
          token,
          name: invite.hasAccount ? undefined : String(form.get("name") ?? ""),
          password: invite.hasAccount ? undefined : String(form.get("password") ?? ""),
        }),
      });
      if (!invite.hasAccount) {
        const signed = await authClient.signIn.email({ email: invite.email, password: String(form.get("password") ?? "") });
        if (signed.error) {
          navigate(`/auth/login?next=${encodeURIComponent(returnTo)}`);
          return;
        }
      }
      navigate("/admin");
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "Could not accept the invite.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Frame title="Join the team" body={`${invite.email} is invited as ${invite.role}. This link works once and expires ${new Date(invite.expiresAt).toLocaleString()}.`}>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {invite.hasAccount && !matches ? (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">Sign in as {invite.email} with the password you already use, then come back to this link.</p>
          {session.data ? (
            <Button
              variant="secondary"
              onClick={() => {
                void authClient.signOut().then(() => navigate(`/auth/login?next=${encodeURIComponent(returnTo)}`));
              }}
            >
              Sign out and switch account
            </Button>
          ) : (
            <Button to={`/auth/login?next=${encodeURIComponent(returnTo)}`}>Sign in</Button>
          )}
        </div>
      ) : (
        <form className="space-y-4" onSubmit={(event) => void accept(event)}>
          {invite.hasAccount ? <p className="text-sm text-slate-600">You're signed in as {invite.email}. Accept to join with your current password.</p> : null}
          {invite.hasAccount ? null : (
            <>
              <Field label="Name">
                <input className={inputClass} name="name" required autoComplete="name" />
              </Field>
              <Field label="Password">
                <PasswordInput name="password" autoComplete="new-password" minLength={8} />
              </Field>
            </>
          )}
          <Button type="submit" className="w-full" loading={pending}>Accept invite</Button>
        </form>
      )}
    </Frame>
  );
}

function Frame({ title, body, children }: { title: string; body: string; children?: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-10">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
      <p className="mt-2 text-sm leading-6 text-slate-500">{body}</p>
      <div className="mt-6">{children}</div>
      <p className="mt-6 text-sm text-slate-500">
        <Link className="font-medium text-ink" to="/auth/login">Back to sign in</Link>
      </p>
    </main>
  );
}
