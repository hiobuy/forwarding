import { Hono } from "hono";
import { z } from "zod";
import type { WorkerBindings } from "../auth";
import type { Database } from "../db/client";
import { AppError } from "../errors";
import { checkSmtp, listMessages, listRules, listTemplates, previewTemplate, publicSmtpView, retryMessage, saveRules, saveSmtpSettings, saveTemplate, sendTemplateTest, sendTestEmail, resetTemplate } from "./mailer";

type Env = { Bindings: WorkerBindings; Variables: { db: Database } };

const emailAddress = z.string().trim().email().max(200);

export const emailAdmin = new Hono<Env>();

emailAdmin.get("/smtp", async (c) => ok(await publicSmtpView(c.get("db"), c.env)));
emailAdmin.put("/smtp", async (c) => {
  const body = parse(
    z.object({
      host: z.string().max(253),
      port: z.number(),
      encryption: z.enum(["starttls", "tls"]),
      username: z.string().max(200),
      password: z.string().max(400).optional().default(""),
      senderName: z.string().max(80),
      senderEmail: emailAddress,
      replyTo: z.string().max(200).optional().default(""),
      platformName: z.string().max(80).optional().default(""),
      logoUrl: z.string().max(400).optional().default(""),
      appUrl: z.string().max(400).optional().default(""),
    }),
    await c.req.json(),
  );
  return ok(await saveSmtpSettings(c.get("db"), c.env, body));
});
emailAdmin.post("/smtp/test", async (c) => ok(await checkSmtp(c.get("db"), c.env)));
emailAdmin.post("/smtp/send-test", async (c) => {
  const body = parse(z.object({ to: emailAddress }), await c.req.json());
  return ok(await sendTestEmail(c.get("db"), c.env, body.to));
});
emailAdmin.get("/templates", async (c) => ok(await listTemplates(c.get("db"))));
emailAdmin.put("/templates/:id", async (c) => {
  const body = parse(z.object({ subject: z.string().max(200), body: z.string().max(8000) }), await c.req.json());
  return ok(await saveTemplate(c.get("db"), c.req.param("id"), body));
});
emailAdmin.post("/templates/:id/reset", async (c) => ok(await resetTemplate(c.get("db"), c.req.param("id"))));
emailAdmin.post("/templates/:id/preview", async (c) => {
  const body = z.object({ subject: z.string().max(200).optional(), body: z.string().max(8000).optional() }).safeParse(await c.req.json().catch(() => ({})));
  const draft = body.success && body.data.subject && body.data.body ? { subject: body.data.subject, body: body.data.body } : undefined;
  return ok(await previewTemplate(c.get("db"), c.env, c.req.param("id"), draft));
});
emailAdmin.post("/templates/:id/test", async (c) => {
  const body = parse(z.object({ to: emailAddress }), await c.req.json());
  return ok(await sendTemplateTest(c.get("db"), c.env, c.req.param("id"), body.to));
});
emailAdmin.get("/rules", async (c) => ok(await listRules(c.get("db"))));
emailAdmin.put("/rules", async (c) => {
  const body = parse(z.object({ enabled: z.record(z.string(), z.boolean()) }), await c.req.json());
  return ok(await saveRules(c.get("db"), body.enabled));
});
emailAdmin.get("/logs", async (c) => {
  const page = Number(c.req.query("page") ?? 1);
  return ok(await listMessages(c.get("db"), { status: c.req.query("status") || undefined, q: c.req.query("q") || undefined, from: c.req.query("from") || undefined, to: c.req.query("to") || undefined, page: Number.isFinite(page) ? page : 1 }));
});
emailAdmin.post("/logs/:id/retry", async (c) => ok(await retryMessage(c.get("db"), c.env, c.req.param("id"))));

function parse<T>(schema: z.ZodType<T>, value: unknown) {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError("VALIDATION_ERROR", "Check the email form and try again.");
  return result.data;
}

function ok<T>(data: T) {
  return Response.json({ data });
}
