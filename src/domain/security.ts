/** Cloudflare documents these prefixes as always-pass or always-fail widgets. */
const TURNSTILE_TEST = /^(1|2|3)x00000000000000000000/;

export function turnstileKeyProblem(siteKey: string, secret: string, production: boolean): string | null {
  const site = siteKey.trim();
  const key = secret.trim();
  if (site.length < 10 || site.length > 200) return "Enter a Turnstile site key.";
  if (key.length < 10 || key.length > 200) return "Enter a Turnstile secret key.";
  if (production && (TURNSTILE_TEST.test(site) || TURNSTILE_TEST.test(key))) return "Test Turnstile keys cannot be used in production.";
  return null;
}

export function googleClientProblem(clientId: string): string | null {
  const value = clientId.trim();
  if (!/^[a-zA-Z0-9._-]{1,180}\.apps\.googleusercontent\.com$/.test(value)) return "Enter a Google OAuth client ID.";
  return null;
}

export function turnstileConfigError(codes: string[]) {
  return codes.some((code) => code === "invalid-input-secret" || code === "missing-input-secret");
}
