import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation } from "react-router";
import {
  currencySymbol,
  DEFAULT_CURRENCY,
  DEFAULT_LOCALE,
  formatMoney,
  localeCatalog,
  resolveActiveLocale,
  translate,
  type CurrencyCode,
  type LocaleCode,
} from "../domain/locale";
import { localeMessages } from "../locales/messages";
import { api } from "./api";

const storageKey = "hiobuy-locale";

export type PublicLanguage = { code: LocaleCode; nativeName: string; englishName: string };

type PublicLocale = {
  defaultLocale: LocaleCode;
  currency: CurrencyCode;
  languages: PublicLanguage[];
};

type I18nValue = {
  locale: LocaleCode;
  currency: CurrencyCode;
  symbol: string;
  languages: PublicLanguage[];
  ready: boolean;
  t: (text: string, vars?: Record<string, string | number>) => string;
  format: (minor: number, options?: { signed?: boolean }) => string;
  setLocale: (code: string) => void;
};

const fallbackLanguages: PublicLanguage[] = localeCatalog.map((item) => ({ ...item }));

const I18nContext = createContext<I18nValue | null>(null);

let activeTranslate = (text: string) => text;

/** Used by helpers that cannot call hooks, such as plural(). */
export function translateActive(text: string) {
  return activeTranslate(text);
}

function readStored() {
  try {
    return localStorage.getItem(storageKey);
  } catch {
    return null;
  }
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const query = useQuery({
    queryKey: ["locale"],
    queryFn: () => api<PublicLocale>("/api/locale"),
    staleTime: 60_000,
  });
  const [stored, setStored] = useState<string | null>(readStored);
  const languages = query.data?.languages?.length ? query.data.languages : fallbackLanguages;
  const enabled = languages.map((item) => item.code);
  const locale = resolveActiveLocale({
    stored,
    navigatorLanguage: typeof navigator === "undefined" ? null : navigator.language,
    enabled,
    fallback: query.data?.defaultLocale ?? DEFAULT_LOCALE,
  });
  const currency = query.data?.currency ?? DEFAULT_CURRENCY;
  const admin = location.pathname.startsWith("/admin");
  const messages = admin ? undefined : localeMessages[locale];
  const value = useMemo<I18nValue>(() => {
    const t = (text: string, vars?: Record<string, string | number>) => translate(messages, text, vars);
    return {
      locale: admin ? DEFAULT_LOCALE : locale,
      currency,
      symbol: currencySymbol(currency, admin ? DEFAULT_LOCALE : locale),
      languages,
      ready: query.isSuccess,
      t,
      format: (minor, options) => formatMoney(minor, currency, admin ? DEFAULT_LOCALE : locale, options?.signed),
      setLocale: (code) => {
        const next = languages.find((item) => item.code === code);
        if (!next) return;
        try {
          localStorage.setItem(storageKey, next.code);
        } catch {
          /* private mode can block storage; the choice still applies for this view */
        }
        setStored(next.code);
      },
    };
  }, [admin, currency, languages, locale, messages, query.isSuccess]);
  activeTranslate = value.t;
  useEffect(() => {
    document.documentElement.lang = value.locale;
  }, [value.locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const value = useContext(I18nContext);
  if (value) return value;
  const t = (text: string) => text;
  return {
    locale: DEFAULT_LOCALE,
    currency: DEFAULT_CURRENCY,
    symbol: "$",
    languages: fallbackLanguages,
    ready: false,
    t,
    format: (minor: number, options?: { signed?: boolean }) => formatMoney(minor, DEFAULT_CURRENCY, DEFAULT_LOCALE, options?.signed),
    setLocale: () => undefined,
  } satisfies I18nValue;
}

export function LocaleSwitch({ tone = "dark" }: { tone?: "dark" | "light" | "muted" }) {
  const { languages, locale, setLocale, t } = useI18n();
  if (languages.length < 2) return null;
  const color = tone === "light" ? "border-white/20 bg-white/10 text-white" : tone === "muted" ? "border-slate-200 bg-white text-slate-600" : "border-[var(--pb-control)] bg-white text-[var(--pb-on)]";
  return (
    <label className={`inline-flex items-center ${color}`}>
      <span className="sr-only">{t("Language")}</span>
      <select
        className={`h-8 max-w-[9.5rem] rounded-lg border bg-transparent px-2 text-[12px] font-semibold outline-none ${color}`}
        value={locale}
        aria-label={t("Language")}
        onChange={(event) => setLocale(event.target.value)}
      >
        {languages.map((item) => (
          <option key={item.code} value={item.code}>
            {item.nativeName}
          </option>
        ))}
      </select>
    </label>
  );
}

export function useRefreshLocale() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ["locale"] });
}

export function Tr({ k, vars }: { k: string; vars?: Record<string, string | number> }) {
  const { t } = useI18n();
  return t(k, vars);
}
