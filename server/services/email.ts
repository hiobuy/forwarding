import type { Database } from "../db/client";
import { emailOutbox } from "../db/schema";
import type { BusinessEnv } from "../../src/domain/business";
import { emailBrand } from "../business";
import { enqueueSecurityEmail } from "../email/mailer";

export type EmailService = {
  sendVerificationEmail(to: string, name: string, url: string): Promise<void>;
  sendPasswordResetEmail(to: string, name: string, url: string): Promise<void>;
  sendBusinessNotification(to: string, subject: string, body: string): Promise<void>;
};

export function createEmailService(db: Database, devMailbox: boolean, env: BusinessEnv = {}): EmailService {
  async function remember(to: string, kind: string, subject: string, body: string, url: string) {
    if (!devMailbox) return;
    await db.insert(emailOutbox).values({ id: crypto.randomUUID(), toAddress: to, kind, subject, body, url, createdAt: Date.now() });
  }
  return {
    sendVerificationEmail: async (to, name, url) => {
      const brand = await emailBrand(db, env);
      await remember(to, "verification", `Verify your ${brand.platformName} email`, "Confirm your email to start forwarding.", url);
      await enqueueSecurityEmail(db, { to, name, templateId: "verification", actionUrl: url, idempotencyKey: `verification:${await digest(url)}` }, env);
    },
    sendPasswordResetEmail: async (to, name, url) => {
      const brand = await emailBrand(db, env);
      await remember(to, "reset", `Reset your ${brand.platformName} password`, "Use this link to choose a new password.", url);
      await enqueueSecurityEmail(db, { to, name, templateId: "password_reset", actionUrl: url, idempotencyKey: `reset:${await digest(url)}` }, env);
    },
    sendBusinessNotification: async (to, subject, body) => {
      await remember(to, "notification", subject, body, "");
    },
  };
}

async function digest(value: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
