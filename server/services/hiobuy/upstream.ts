import { AppError } from "../../errors";

type UpstreamBody = {
  success?: unknown;
  code?: unknown;
  msg?: unknown;
  message?: unknown;
  error?: { code?: unknown; message?: unknown };
};

/** Read a HioBuy error code without changing the request itself. */
export function upstreamFailure(status: number, raw: string, fallback: string): { upstreamCode?: string; message: string; failed: boolean } {
  let body: UpstreamBody | null = null;
  try {
    body = raw ? (JSON.parse(raw) as UpstreamBody) : null;
  } catch {
    body = null;
  }
  const code = typeof body?.code === "string" ? body.code : typeof body?.error?.code === "string" ? body.error.code : undefined;
  const text = body?.error?.message || body?.msg || body?.message;
  const message = typeof text === "string" && text.trim() ? text.trim() : fallback;
  const rejected = body?.success === false;
  if (status === 401 || code === "INVALID_API_KEY") {
    return { failed: true, upstreamCode: code ?? "INVALID_API_KEY", message };
  }
  if (!statusOk(status) || rejected) {
    return { failed: true, upstreamCode: code, message };
  }
  return { failed: false, message };
}

function statusOk(status: number) {
  return status >= 200 && status < 300;
}

export function throwUpstream(status: number, raw: string, fallback: string): void {
  const failure = upstreamFailure(status, raw, fallback);
  if (!failure.failed) return;
  throw new AppError("UPSTREAM_ERROR", failure.message, 502, failure.upstreamCode ? { upstreamCode: failure.upstreamCode } : undefined);
}
