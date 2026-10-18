export class AppError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export function newRequestId(): string {
  return `req_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

export function logEvent(fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ level: "info", ...fields }));
}
