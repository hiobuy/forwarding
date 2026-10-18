/** Stripe test and live keys must not be mixed. Empty secrets are allowed until they are saved. */

export function stripeKeyModeProblem(mode: "test" | "live", secret: string, publishable: string): string | null {
  const secretMode = keyMode(secret, "sk");
  const publishableMode = keyMode(publishable, "pk");
  if (secret && !secretMode) return "Stripe secret key should start with sk_test_ or sk_live_.";
  if (publishable && !publishableMode) return "Stripe publishable key should start with pk_test_ or pk_live_.";
  if (secretMode && secretMode !== mode) return mode === "live" ? "A live account cannot use a test secret key." : "Test mode cannot use a live secret key.";
  if (publishableMode && publishableMode !== mode) return mode === "live" ? "A live account cannot use a test publishable key." : "Test mode cannot use a live publishable key.";
  if (secretMode && publishableMode && secretMode !== publishableMode) return "Publishable key and secret key must both be test or both be live.";
  return null;
}

function keyMode(value: string, prefix: "sk" | "pk"): "test" | "live" | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith(`${prefix}_test_`)) return "test";
  if (trimmed.startsWith(`${prefix}_live_`)) return "live";
  return null;
}
