import type { Database } from "./db/client";
import { notifications } from "./db/schema";
import { enqueueBusinessNotification } from "./email/mailer";
import { logEvent } from "./errors";

/** In-app notification, plus the matching email when that event has one. */
export async function notify(db: Database, userId: string, input: { type: string; title: string; body: string; href: string }) {
  await db.insert(notifications).values({ id: crypto.randomUUID(), userId, readAt: null, createdAt: Date.now(), ...input });
  try {
    await enqueueBusinessNotification(db, userId, input);
  } catch (error) {
    logEvent({ level: "error", message: "Could not queue email", detail: error instanceof Error ? error.message : "unknown" });
  }
}
