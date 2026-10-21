import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Button, ErrorState, Field, LoadingBlock } from "../../components/ui";
import { Checkbox } from "../../components/ui/checkbox";
import { useToast } from "../../components/toast";
import { ApiError, api } from "../../lib/api";
import { useRefreshLocale } from "../../lib/i18n";
import { useDemoPreview } from "./shared";

type Language = { code: string; nativeName: string; englishName: string; enabled: boolean };
type Currency = { code: string; englishName: string };
type LocaleSettings = {
  languages: Language[];
  defaultLocale: string;
  currency: string;
  currencies: Currency[];
  note: string;
};

export function AdminLocale({ active, onDirty }: { active: boolean; onDirty: (value: boolean) => void }) {
  const query = useQuery({ queryKey: ["admin", "locale"], queryFn: () => api<LocaleSettings>("/api/admin/settings/locale") });
  if (query.isLoading) return <LoadingBlock rows={4} />;
  if (query.error || !query.data) return <ErrorState message="Could not load language settings." onRetry={() => void query.refetch()} />;
  return <LocaleForm key={`${query.dataUpdatedAt}`} data={query.data} active={active} onDirty={onDirty} />;
}

function LocaleForm({ data, active, onDirty }: { data: LocaleSettings; active: boolean; onDirty: (value: boolean) => void }) {
  const demo = useDemoPreview();
  const toast = useToast();
  const queryClient = useQueryClient();
  const refreshLocale = useRefreshLocale();
  const [enabled, setEnabled] = useState(() => data.languages.filter((item) => item.enabled).map((item) => item.code));
  const [defaultLocale, setDefaultLocale] = useState(data.defaultLocale);
  const [currency, setCurrency] = useState(data.currency);
  const savedEnabled = data.languages.filter((item) => item.enabled).map((item) => item.code).join(",");
  const dirty = enabled.join(",") !== savedEnabled || defaultLocale !== data.defaultLocale || currency !== data.currency;
  useEffect(() => {
    if (active) onDirty(demo ? false : dirty);
  }, [active, dirty, demo, onDirty]);
  const save = useMutation({
    mutationFn: () => api<LocaleSettings>("/api/admin/settings/locale", { method: "PUT", body: JSON.stringify({ enabled, defaultLocale, currency }) }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "locale"] });
      await refreshLocale();
      toast({ title: "Language and currency saved.", tone: "success" });
    },
    onError: (reason) => toast({ title: reason instanceof ApiError ? reason.message : "Could not save language settings.", tone: "danger" }),
  });
  const choices = data.languages.filter((item) => enabled.includes(item.code));
  return (
    <form
      className="max-w-2xl space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!demo) save.mutate();
      }}
    >
      <section className="rounded-lg border border-line bg-white">
        <div className="border-b border-slate-100 px-4 py-3">
          <h2 className="text-[13px] font-semibold">Customer languages</h2>
          <p className="mt-1 text-[13px] text-slate-500">Visitors can switch among the languages you turn on. The customer app, public site, and sign-in pages follow that choice. Admin stays in English.</p>
        </div>
        <ul className="divide-y divide-slate-100">
          {data.languages.map((language) => {
            const on = enabled.includes(language.code);
            return (
              <li key={language.code} className="flex items-center justify-between gap-3 px-4 py-3">
                <span>
                  <span className="block text-[13px] font-medium">{language.nativeName}</span>
                  <span className="block text-[12px] text-slate-500">{language.englishName} · {language.code}</span>
                </span>
                <Checkbox
                  checked={on}
                  disabled={demo}
                  aria-label={`${on ? "Turn off" : "Turn on"} ${language.englishName}`}
                  onCheckedChange={(checked) => toggle(language.code, checked === true)}
                />
              </li>
            );
          })}
        </ul>
      </section>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Default language" hint="Used when a visitor has not chosen a language and their browser does not match one you turned on.">
          <select className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm" value={defaultLocale} disabled={demo} onChange={(event) => setDefaultLocale(event.target.value)}>
            {choices.map((language) => (
              <option key={language.code} value={language.code}>{language.nativeName}</option>
            ))}
          </select>
        </Field>
        <Field label="Default currency" hint="Customer prices, wallet balances, and new card checkouts use this currency. Stored amounts are not converted.">
          <select className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm" value={currency} disabled={demo} onChange={(event) => setCurrency(event.target.value)}>
            {data.currencies.map((item) => (
              <option key={item.code} value={item.code}>{item.code} · {item.englishName}</option>
            ))}
          </select>
        </Field>
      </div>
      <p className="text-[12px] leading-5 text-slate-500">{data.note}</p>
      <Button type="submit" loading={save.isPending} disabled={demo || !dirty}>{demo ? "Not saved in demo" : "Save changes"}</Button>
    </form>
  );

  function toggle(code: string, on: boolean) {
    setEnabled((current) => {
      const next = on ? [...current, code] : current.filter((item) => item !== code);
      const unique = data.languages.map((item) => item.code).filter((item) => next.includes(item));
      if (!unique.length) {
        toast({ title: "Leave at least one language on.", tone: "danger" });
        return current;
      }
      setDefaultLocale((selected) => (unique.includes(selected) ? selected : unique[0]!));
      return unique;
    });
  }
}
