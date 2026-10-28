/**
 * SMTP over Cloudflare Workers TCP sockets.
 * Workers cannot use a Node net.Socket SMTP client. `cloudflare:sockets` is the supported path.
 * A 250 after DATA means the server accepted the message. It is not a delivery receipt.
 */
import { connect } from "cloudflare:sockets";
import { takeSmtpReply } from "./smtp-reply";

type Socket = ReturnType<typeof connect>;

export type SmtpEncryption = "starttls" | "tls";

export type SmtpConfig = {
  host: string;
  port: number;
  encryption: SmtpEncryption;
  username: string;
  password: string;
  senderName: string;
  senderEmail: string;
  replyTo: string | null;
};

type Reply = { code: number; text: string };

const STEP_TIMEOUT_MS = 20_000;

export async function testSmtp(config: SmtpConfig) {
  const session = await openSmtp(config);
  try {
    await session.command("QUIT");
  } catch {
    session.close();
  }
}

export async function sendSmtp(config: SmtpConfig, message: { to: string; subject: string; html: string; text: string }) {
  const session = await openSmtp(config);
  try {
    await session.command(`MAIL FROM:<${config.senderEmail}>`);
    await session.command(`RCPT TO:<${message.to}>`);
    await session.command("DATA");
    const data = buildMessage(config, message);
    await session.write(`${data}\r\n.\r\n`);
    const reply = await session.read();
    if (reply.code !== 250) throw new Error(reply.text || "The mail server did not accept the message.");
    await session.command("QUIT");
  } catch (error) {
    session.close();
    throw error;
  }
}

async function openSmtp(config: SmtpConfig) {
  const socket = connect(
    { hostname: config.host, port: config.port },
    { secureTransport: config.encryption === "tls" ? "on" : "starttls", allowHalfOpen: true },
  );
  await waitUntilOpen(socket, `${config.host}:${config.port}`);
  let session = new SmtpSession(socket);
  const greeting = await session.read();
  if (greeting.code !== 220) throw new Error(greeting.text || "The mail server did not greet us.");
  const ehloName = ehloHostname(config.senderEmail);
  await session.command(`EHLO ${ehloName}`);
  if (config.encryption === "starttls") {
    await session.command("STARTTLS");
    const secure = session.releaseForTls();
    await waitUntilOpen(secure, `${config.host}:${config.port}`);
    session = new SmtpSession(secure);
    await session.command(`EHLO ${ehloName}`);
  }
  await session.command("AUTH LOGIN");
  await session.command(encodeSmtpToken(config.username));
  const auth = await session.command(encodeSmtpToken(config.password));
  if (auth.code !== 235) throw new Error(auth.text || "SMTP authentication failed.");
  return session;
}

function ehloHostname(senderEmail: string) {
  const domain = senderEmail.split("@")[1]?.trim().toLowerCase() || "";
  if (/^[a-z0-9.-]+$/.test(domain) && domain.includes(".")) return domain;
  return "localhost";
}

/** AUTH LOGIN sends each token as Latin-1 base64. API tokens are ASCII. */
function encodeSmtpToken(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function waitUntilOpen(socket: Socket, label: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      socket.opened,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out connecting to ${label}.`)), STEP_TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    socket.close().catch(() => undefined);
    const message = error instanceof Error ? error.message : "The connection failed.";
    throw new Error(message.startsWith("Timed out") ? message : `Could not connect to ${label}: ${message}`);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

class SmtpSession {
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private buffer = "";
  constructor(private socket: Socket) {
    this.reader = socket.readable.getReader();
  }
  async command(line: string) {
    await this.write(`${line}\r\n`);
    const reply = await this.read();
    if (reply.code >= 400) throw new Error(reply.text || `SMTP error ${reply.code}`);
    return reply;
  }
  async write(value: string) {
    if (!this.writer) this.writer = this.socket.writable.getWriter();
    await this.writer.write(new TextEncoder().encode(value));
  }
  async read(): Promise<Reply> {
    const deadline = Date.now() + STEP_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const parsed = takeSmtpReply(this.buffer);
      if (parsed) {
        this.buffer = parsed.rest;
        return parsed.reply;
      }
      const remaining = Math.max(1, deadline - Date.now());
      const read = this.reader.read().then(
        (value) => ({ kind: "read" as const, value }),
        (error: unknown) => ({ kind: "error" as const, error }),
      );
      const closed = this.socket.closed.then(
        () => ({ kind: "closed" as const, error: undefined }),
        (error: unknown) => ({ kind: "closed" as const, error }),
      );
      const result = await Promise.race([
        read,
        closed,
        new Promise<{ kind: "timeout" }>((resolve) => setTimeout(() => resolve({ kind: "timeout" }), remaining)),
      ]);
      if (result.kind === "timeout") throw new Error("The mail server did not respond in time.");
      if (result.kind === "error" || result.kind === "closed") {
        const detail = result.error instanceof Error ? result.error.message : "";
        throw new Error(detail ? `The mail server closed the connection: ${detail}` : "The mail server closed the connection.");
      }
      if (result.value.done) throw new Error("The mail server closed the connection.");
      this.buffer += new TextDecoder().decode(result.value.value, { stream: true });
    }
    throw new Error("The mail server did not respond in time.");
  }
  releaseForTls() {
    this.reader.releaseLock();
    this.writer?.releaseLock();
    return this.socket.startTls();
  }
  close() {
    this.reader.cancel().catch(() => undefined);
    this.writer?.abort().catch(() => undefined);
    this.socket.close().catch(() => undefined);
  }
}

function buildMessage(config: SmtpConfig, message: { to: string; subject: string; html: string; text: string }) {
  const from = `${encodeHeader(config.senderName)} <${config.senderEmail}>`;
  const headers = [
    `From: ${from}`,
    `To: ${message.to}`,
    config.replyTo ? `Reply-To: ${config.replyTo}` : "",
    `Subject: ${encodeHeader(message.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    "MIME-Version: 1.0",
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
  ].filter(Boolean);
  return [...headers, "", message.html].map((line) => (line.startsWith(".") ? `.${line}` : line)).join("\r\n");
}

function encodeHeader(value: string) {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${btoa(unescape(encodeURIComponent(value)))}?=`;
}
