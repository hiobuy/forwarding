import { and, eq } from "drizzle-orm";
import { appConfig } from "./config";
import type { Database } from "./db/client";
import { walletTransactions, wallets } from "./db/schema";
import { AppError } from "./errors";

export type WalletMove = {
  userId: string;
  /** Positive credits the wallet, negative debits it. */
  amountFen: number;
  type: string;
  referenceType: string;
  referenceId: string;
  description: string;
  /** Message for a debit larger than the balance. */
  insufficientMessage?: string;
  /** Manual adjustments may repeat the same reference. Everything else is applied once. */
  repeatable?: boolean;
};

/** A move with the same type and reference is applied once. The balance check and write use compare-and-swap. */
export async function moveWallet(db: Database, move: WalletMove) {
  if (!move.repeatable) {
    const prior = (
      await db
        .select({ id: walletTransactions.id })
        .from(walletTransactions)
        .where(and(eq(walletTransactions.userId, move.userId), eq(walletTransactions.type, move.type), eq(walletTransactions.referenceType, move.referenceType), eq(walletTransactions.referenceId, move.referenceId)))
    )[0];
    if (prior) return { applied: false as const };
  }
  const wallet = (await db.select().from(wallets).where(eq(wallets.userId, move.userId)))[0];
  if (!wallet) throw new AppError("NOT_FOUND", "Wallet not found.", 404);
  const next = wallet.balanceFen + move.amountFen;
  if (next < 0) {
    throw new AppError("INSUFFICIENT_BALANCE", move.insufficientMessage ?? "Insufficient wallet balance.", 402, {
      walletBalanceFen: wallet.balanceFen,
      amountNeededFen: -next,
    });
  }
  const updated = await db
    .update(wallets)
    .set({ balanceFen: next })
    .where(and(eq(wallets.userId, move.userId), eq(wallets.balanceFen, wallet.balanceFen)))
    .returning({ balanceFen: wallets.balanceFen });
  if (!updated.length) throw new AppError("CONFLICT", "Wallet changed at the same time. Try again.", 409);
  await db.insert(walletTransactions).values({
    id: crypto.randomUUID(),
    userId: move.userId,
    type: move.type,
    amountFen: move.amountFen,
    currency: appConfig.currency,
    balanceBefore: wallet.balanceFen,
    balanceAfter: next,
    referenceType: move.referenceType,
    referenceId: move.referenceId,
    description: move.description,
    createdAt: Date.now(),
  });
  return { applied: true as const, balanceBefore: wallet.balanceFen, balanceFen: next };
}
