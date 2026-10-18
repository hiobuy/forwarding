import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { twoFactor } from "better-auth/plugins";
import { eq } from "drizzle-orm";
import { can } from "../src/domain/staff";
import type { Database } from "./db/client";
import { authSchema, session } from "./db/schema";
import { createEmailService } from "./services/email";
import { ensureAccountRows } from "./account";
import { enqueueSecurityEmail } from "./email/mailer";
import { allocateNumber } from "./numbering";
import { assertTurnstile, googleCredentials, hiobuyPay2faRequired } from "./platform";
import { activeStaffRole } from "./staff";

export type WorkerBindings = {
  DB: D1Database;
  ENVIRONMENT: string;
  BETTER_AUTH_SECRET: string;
  /**
   * Comma-separated emails used only while no owner exists.
   * The first admin request promotes matching accounts to owner. After that, the team list decides access.
   */
  ADMIN_EMAILS?: string;
  /** Warehouse photos (inbound, services, packing). */
  PHOTOS: R2Bucket;
  /** Bearer token for api.hiobuy.com. Absent until warehouse fulfillment is connected. */
  HIOBUY_API_TOKEN?: string;
  /** Deployment defaults. They do not override a business profile saved by the owner. */
  APP_URL?: string;
  TRUSTED_APP_ORIGINS?: string;
  BUSINESS_NAME?: string;
  BUSINESS_EMAIL?: string;
  PUBLIC_WEBSITE_URL?: string;
  /** `integrated` keeps the public homepage. `app-only` sends `/` to the app or login. Unset means integrated. */
  PUBLIC_SITE_MODE?: string;
  /** Exact `true` opens Demo Admin. Anything else, including an unset variable, keeps it closed. */
  DEMO_MODE?: string;
  /** Optional https://github.com/owner/repo link shown inside Demo Admin. */
  GITHUB_REPO_URL?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  CUSTOMER_AI_ENABLED?: string;
};

async function nextMemberCode(db: Database): Promise<string> {
  return allocateNumber(db, "member");
}

export async function createAuth(env: WorkerBindings, db: Database, request: Request) {
  const origin = new URL(request.url).origin;
  const email = createEmailService(db, env.ENVIRONMENT !== "production", env);
  const sendWelcome = async (account: { id: string; email: string; name: string }) => {
    try {
      await enqueueSecurityEmail(db, { to: account.email, name: account.name, templateId: "welcome", actionUrl: `${origin}/app/dashboard`, idempotencyKey: `welcome:${account.id}` }, env);
    } catch {
      // A mail failure must not roll back the account or the verification.
    }
  };
  const google = await googleCredentials(db, env);
  return betterAuth({
    appName: "HIOBuy Forwarding",
    baseURL: origin,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [origin],
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema: authSchema,
    }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      autoSignIn: false,
      minPasswordLength: 8,
      resetPasswordTokenExpiresIn: 60 * 60,
      sendResetPassword: async ({ user: account, token }) => {
        await email.sendPasswordResetEmail(account.email, account.name, `${origin}/auth/reset-password?token=${token}`);
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      expiresIn: 60 * 60,
      sendVerificationEmail: async ({ user: account, url }) => {
        await email.sendVerificationEmail(account.email, account.name, url);
      },
      afterEmailVerification: async (account) => {
        await sendWelcome(account);
      },
    },
    socialProviders: google.enabled ? { google: { clientId: google.clientId, clientSecret: google.clientSecret, prompt: "select_account" } } : undefined,
    account: {
      accountLinking: {
        enabled: true,
        disableImplicitLinking: true,
        allowUnlinkingAll: false,
      },
    },
    user: {
      additionalFields: {
        memberCode: { type: "string", required: false, input: false },
        phone: { type: "string", required: false },
        country: { type: "string", required: false },
        status: { type: "string", required: false, input: false, defaultValue: "active" },
      },
    },
    plugins: [twoFactor({ issuer: "HIOBuy" })],
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 60,
      customRules: {
        "/sign-in/email": { window: 60, max: 10 },
        "/sign-up/email": { window: 60, max: 5 },
        "/request-password-reset": { window: 300, max: 5 },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        const action = ctx.path === "/sign-in/email" ? "login" : ctx.path === "/sign-up/email" ? "register" : ctx.path === "/request-password-reset" ? "reset" : null;
        if (action) {
          const body = ctx.body as { email?: string } | undefined;
          try {
            await assertTurnstile(db, env, {
              action,
              token: ctx.headers?.get("x-turnstile-token") ?? "",
              ip: ctx.headers?.get("cf-connecting-ip") ?? ctx.headers?.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
              email: String(body?.email ?? ""),
            });
          } catch (error) {
            throw APIError.from("BAD_REQUEST", { message: error instanceof Error ? error.message : "Complete the security check and try again.", code: "TURNSTILE" });
          }
        }
        if (ctx.path === "/two-factor/disable" && (await hiobuyPay2faRequired(db))) {
          const userId = await sessionUserId(db, ctx.headers?.get("cookie") ?? "");
          const role = userId ? await activeStaffRole(db, userId) : null;
          if (role && can(role, "shipments.pay")) {
            throw APIError.from("BAD_REQUEST", { message: "HioBuy payments require an authenticator. An owner must turn that requirement off before it can be disabled.", code: "TWO_FACTOR_REQUIRED" });
          }
        }
      }),
    },
    databaseHooks: {
      user: {
        create: {
          before: async (account) => {
            const memberCode = await nextMemberCode(db);
            return { data: { ...account, memberCode, status: "active" } };
          },
          after: async (account) => {
            await ensureAccountRows(db, account.id);
            if (account.emailVerified) await sendWelcome(account);
          },
        },
      },
    },
  });
}

async function sessionUserId(db: Database, cookie: string) {
  const match = cookie.match(/(?:^|;\s*)(?:__Secure-)?better-auth\.session_token=([^;]+)/);
  if (!match?.[1]) return null;
  const token = decodeURIComponent(match[1]).split(".")[0] ?? "";
  if (!token) return null;
  return (await db.select({ userId: session.userId }).from(session).where(eq(session.token, token)).limit(1))[0]?.userId ?? null;
}
