export type SmtpReply = { code: number; text: string };

/** A complete SMTP reply ends with a line whose fourth character is a space, not a hyphen. */
export function takeSmtpReply(buffer: string): { reply: SmtpReply; rest: string } | null {
  const lines = buffer.split("\r\n");
  const complete = lines.slice(0, -1);
  const last = complete.at(-1);
  if (!last || last.length < 4 || last[3] !== " ") return null;
  const code = Number(last.slice(0, 3));
  if (!Number.isInteger(code)) return null;
  return { reply: { code, text: complete.join(" ") }, rest: lines.at(-1) ?? "" };
}

/** Workers block TCP to Cloudflare IP ranges, so this host cannot be reached with connect(). */
export function isCloudflareEmailHost(host: string) {
  return host.trim().toLowerCase().replace(/\.$/, "") === "smtp.mx.cloudflare.net";
}
