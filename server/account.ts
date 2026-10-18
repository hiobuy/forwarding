import { eq } from "drizzle-orm";
import type { Database } from "./db/client";
import { notificationPreferences, wallets } from "./db/schema";

/** Rows every signed-in customer needs. Safe to call on each request. */
export async function ensureAccountRows(db: Database, userId: string): Promise<void> {
  const [wallet, prefs] = await Promise.all([
    db.select({ userId: wallets.userId }).from(wallets).where(eq(wallets.userId, userId)),
    db.select({ userId: notificationPreferences.userId }).from(notificationPreferences).where(eq(notificationPreferences.userId, userId)),
  ]);
  if (!wallet[0]) await db.insert(wallets).values({ userId, balanceFen: 0 }).onConflictDoNothing();
  if (!prefs[0]) await db.insert(notificationPreferences).values({ userId }).onConflictDoNothing();
}
