export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly requestId?: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

let demoHolders = 0;

/** While Demo Admin is mounted, admin fetches stay on the demo API. */
export function holdDemoScope() {
  demoHolders += 1;
  return () => {
    demoHolders = Math.max(0, demoHolders - 1);
  };
}

export function adminHref(path: string) {
  if (demoHolders === 0 || !path.startsWith("/admin") || path.startsWith("/admin/demo")) return path;
  return `/admin/demo${path.slice("/admin".length)}`;
}

function resolveApiPath(path: string) {
  if (demoHolders > 0 && path.startsWith("/api/admin")) return `/api/demo${path.slice("/api/admin".length)}`;
  return path;
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(resolveApiPath(path), { ...init, headers, credentials: "include" });
  const body = (await response.json().catch(() => ({}))) as {
    data?: T;
    requestId?: string;
    error?: { code?: string; message?: string; details?: unknown };
  };
  if (!response.ok) {
    throw new ApiError(
      body.error?.code ?? "REQUEST_FAILED",
      body.error?.message ?? "Request failed.",
      response.status,
      body.requestId,
      body.error?.details,
    );
  }
  return body.data as T;
}

export function idempotencyKey(): string {
  return crypto.randomUUID();
}
