/**
 * Register a language file here after adding it to `localeCatalog`.
 * English has no file: the source text is the key.
 */
import type { LocaleCode } from "../domain/locale";
import { ru } from "./ru";
import { zhHant } from "./zh-Hant";

export const localeMessages: Partial<Record<LocaleCode, Record<string, string>>> = {
  "zh-Hant": zhHant,
  ru,
};
