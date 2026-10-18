/**
 * SMTP over Cloudflare Workers TCP sockets.
 * Workers cannot use a Node net.Socket SMTP client. `cloudflare:sockets` is the supported path.
 * A 250 after DATA means the server accepted the message. It is not a delivery receipt.
 */
import { connect } from "cloudflare:sockets";

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
    { secureTransport: config.encryption === "tls" ? "on" : config.encryption === "starttls" ? "starttls" : "off", allowHalfOpen: false },
  );
  let session = new SmtpSession(socket);
  const greeting = await session.read();
  if (greeting.code !== 220) throw new Error(greeting.text || "The mail server did not greet us.");
  const ehlo = config.senderEmail.split("@")[1] || "localhost";
  await session.command(`EHLO ${ehlo}`);
  if (config.encryption === "starttls") {
    await session.command("STARTTLS");
    session.closeWriters();
    session = new SmtpSession(socket.startTls());
    await session.command(`EHLO ${ehlo}`);
  }
  await session.command("AUTH LOGIN");
  await session.command(btoa(config.username));
  const auth = await session.command(btoa(config.password));
  if (auth.code !== 235) throw new Error("SMTP authentication failed.");
  return session;
}

class SmtpSession {
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private writer: WritableStreamDefaultWriter<Uint8Array>;
  private buffer = "";
  constructor(socket: Socket) {
    this.reader = socket.readable.getReader();
    this.writer = socket.writable.getWriter();
  }
  async command(line: string) {
    await this.write(`${line}\r\n`);
    const reply = await this.read();
    if (reply.code >= 400) throw new Error(reply.text || `SMTP error ${reply.code}`);
    return reply;
  }
  async write(value: string) {
    await this.writer.write(new TextEncoder().encode(value));
  }
  async read(): Promise<Reply> {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const lines = this.buffer.split("\r\n");
      const complete = lines.slice(0, -1);
      const last = complete.at(-1);
      if (last && last.length >= 4 && last[3] === " ") {
        this.buffer = lines.at(-1) ?? "";
        return { code: Number(last.slice(0, 3)), text: complete.join(" ") };
      }
      const next = await Promise.race([
        this.reader.read(),
        new Promise<ReadableStreamReadResult<Uint8Array>>((resolve) => setTimeout(() => resolve({ done: true, value: undefined }), Math.max(1, deadline - Date.now()))),
      ]);
      if (next.done) break;
      this.buffer += new TextDecoder().decode(next.value, { stream: true });
    }
    throw new Error("The mail server did not respond in time.");
  }
  closeWriters() {
    this.reader.releaseLock();
    this.writer.releaseLock();
  }
  close() {
    this.reader.cancel().catch(() => undefined);
    this.writer.abort().catch(() => undefined);
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
