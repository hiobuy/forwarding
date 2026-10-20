import { createAuthClient } from "better-auth/react";
import { inferAdditionalFields, twoFactorClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  plugins: [
    twoFactorClient(),
    inferAdditionalFields({
      user: {
        memberCode: { type: "string", required: false },
        phone: { type: "string", required: false },
        country: { type: "string", required: false },
        status: { type: "string", required: false },
      },
    }),
  ],
});

/** Better Auth sends the browser back with `?error=<code>` when a Google sign-in or link fails. */
export function googleErrorMessage(code: string | null): string | null {
  if (!code) return null;
  switch (code) {
    case "account_not_linked":
      return "This email already has an account. Sign in with your email and password, then link Google under Account.";
    case "account_already_linked_to_different_user":
      return "This Google account is already linked to another member.";
    case "email_doesn't_match":
      return "Use the Google account with the same email as this account.";
    case "access_denied":
      return "Google sign-in was cancelled.";
    default:
      return "Google sign-in did not finish. Try again.";
  }
}
