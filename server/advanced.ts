import type { Database } from "./db/client";
import { AppError } from "./errors";
import { listNumberRules, parseNumberDraft, saveNumberRules } from "./numbering";
import { adminAdvancedView, saveGoogleSettings, type PlatformEnv } from "./platform";

export async function advancedSettings(db: Database, env: PlatformEnv, origin: string) {
  return { ...(await adminAdvancedView(db, env, origin)), numbering: await listNumberRules(db) };
}

export async function saveAdvancedNumbering(db: Database, body: unknown) {
  const draft = parseNumberDraft(body);
  if (!draft) throw new AppError("VALIDATION_ERROR", "Enter a prefix, starting number, and length for each number.");
  return saveNumberRules(db, draft);
}

export async function saveAdvancedGoogle(db: Database, env: PlatformEnv, actorId: string, input: { enabled: boolean; clientId: string; clientSecret: string }) {
  await saveGoogleSettings(db, env, actorId, input);
}
