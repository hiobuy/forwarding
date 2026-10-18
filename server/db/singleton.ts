import { eq } from "drizzle-orm";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import { AppError } from "../errors";
import type { Database } from "./client";

export const SINGLETON_ID = "default";

type SingletonTable = SQLiteTable & { id: SQLiteColumn; updatedAt: SQLiteColumn };

/** Settings tables hold one row. It is created from column defaults plus `initial` the first time it is read. */
export async function singletonRow<T extends SingletonTable>(
  db: Database,
  table: T,
  initial: Partial<T["$inferInsert"]> = {},
): Promise<T["$inferSelect"]> {
  const read = async () => (await db.select().from(table as SQLiteTable).where(eq(table.id, SINGLETON_ID)))[0] as T["$inferSelect"] | undefined;
  const existing = await read();
  if (existing) return existing;
  await db
    .insert(table)
    .values({ ...initial, id: SINGLETON_ID, updatedAt: Date.now() } as T["$inferInsert"])
    .onConflictDoNothing();
  const created = await read();
  if (!created) throw new AppError("INTERNAL", "Settings could not be loaded.", 500);
  return created;
}
