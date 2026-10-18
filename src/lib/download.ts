import { ApiError } from "./api";

export async function downloadPdf(path: string, filename: string) {
  const blob = await pdfBlob(path);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export async function openPdf(path: string, init?: RequestInit) {
  const blob = await pdfBlob(path, init);
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener");
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function pdfBlob(path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(path, { ...init, headers, credentials: "include" });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: { code?: string; message?: string }; requestId?: string };
    throw new ApiError(body.error?.code ?? "REQUEST_FAILED", body.error?.message ?? "Could not open the document.", response.status, body.requestId);
  }
  return response.blob();
}
