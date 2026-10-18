import { BookOpen, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useLocation } from "react-router";
import { adminHref } from "../../lib/api";
import { GUIDE, GUIDE_HOME, GUIDE_SECTIONS, guideBySlug, markdownHeadings, type GuideEntry } from "../../domain/guide";
import { usePageTitle } from "../../lib/brand";
import { cn } from "../../lib/utils";
import { MarkdownDoc } from "./guide/markdown";
import { guideSource } from "./guide/sources";
import { useAdminAccess } from "./shared";

export function AdminGuide() {
  const location = useLocation();
  const access = useAdminAccess();
  const demo = access.data?.role === "demo";
  const slug = location.pathname.replace(/^\/admin(?:\/demo)?\/guide\/?/, "") || GUIDE_HOME;
  const page = guideBySlug(slug);
  const [query, setQuery] = useState("");
  const [navOpen, setNavOpen] = useState(false);
  const markdown = page ? guideSource(page.file) : "";
  const headings = useMemo(() => markdownHeadings(markdown).filter((heading) => heading.level > 1), [markdown]);
  const results = useMemo(() => searchGuide(query), [query]);

  usePageTitle(page?.title ?? "Developer Guide");

  useEffect(() => {
    setNavOpen(false);
    const hash = location.hash.replace(/^#/, "");
    if (!hash) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(decodeURIComponent(hash))?.scrollIntoView({ block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [location.pathname, location.hash]);

  if (slug !== GUIDE_HOME && !page) return <Navigate to={adminHref("/admin/guide")} replace />;

  return (
    <div className="lg:grid lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-8 xl:grid-cols-[220px_minmax(0,1fr)_190px]">
      <aside className="hidden lg:block">
        <GuideNav query={query} onQuery={setQuery} active={slug} />
      </aside>
      <div className="min-w-0">
        {demo ? (
          <p className="mb-4 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
            <a className="font-medium text-ink underline decoration-slate-300 underline-offset-2" href="https://developers.hiobuy.com" target="_blank" rel="noreferrer">HioBuy API docs</a>
            {access.data?.githubUrl ? <a className="font-medium text-ink underline decoration-slate-300 underline-offset-2" href={access.data.githubUrl} target="_blank" rel="noreferrer">GitHub repository</a> : null}
          </p>
        ) : null}
        <div className="mb-4 flex items-center gap-2 lg:hidden">
          <button type="button" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line px-2.5 text-[13px] font-medium" aria-expanded={navOpen} onClick={() => setNavOpen((open) => !open)}>
            <BookOpen size={14} aria-hidden="true" />
            Pages
          </button>
          <label className="relative min-w-0 flex-1">
            <Search size={14} className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input className="h-8 w-full rounded-md border border-line pr-2 pl-7 text-[13px]" value={query} placeholder="Search the guide" aria-label="Search the guide" onChange={(event) => setQuery(event.target.value)} />
          </label>
        </div>
        {navOpen ? (
          <div className="mb-4 rounded-lg border border-line p-3 lg:hidden">
            <GuideNav query={query} onQuery={setQuery} active={slug} hideSearch />
          </div>
        ) : null}
        {query.trim() ? <SearchResults results={results} onOpen={() => setQuery("")} /> : null}
        {page ? (
          <>
            {headings.length ? (
              <details className="mb-4 rounded-lg border border-line px-3 py-2 xl:hidden">
                <summary className="cursor-pointer text-[13px] font-medium text-ink">On this page</summary>
                <Toc headings={headings} />
              </details>
            ) : null}
            {markdown ? <MarkdownDoc markdown={markdown} fromFile={page.file} /> : <p className="text-[14px] text-slate-500">This page has no source file in the build.</p>}
          </>
        ) : null}
      </div>
      <aside className="hidden xl:block">
        {headings.length ? (
          <nav aria-label="On this page" className="sticky top-6">
            <p className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">On this page</p>
            <Toc headings={headings} />
          </nav>
        ) : null}
      </aside>
    </div>
  );
}

function GuideNav({ query, onQuery, active, hideSearch = false }: { query: string; onQuery: (value: string) => void; active: string; hideSearch?: boolean }) {
  const needle = query.trim().toLowerCase();
  return (
    <div className="lg:sticky lg:top-6">
      {hideSearch ? null : (
        <label className="relative mb-3 block">
          <Search size={14} className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <input className="h-8 w-full rounded-md border border-line pr-2 pl-7 text-[13px]" value={query} placeholder="Search the guide" aria-label="Search the guide" onChange={(event) => onQuery(event.target.value)} />
        </label>
      )}
      <nav aria-label="Developer Guide">
        {GUIDE_SECTIONS.map((section) => {
          const pages = GUIDE.filter((entry) => entry.section === section && (!needle || `${entry.title} ${guideSource(entry.file)}`.toLowerCase().includes(needle)));
          if (!pages.length) return null;
          return (
            <div key={section} className="mb-4">
              <p className="mb-1 px-2 text-[11px] font-medium tracking-wide text-slate-400 uppercase">{section}</p>
              <ul>
                {pages.map((entry) => (
                  <li key={entry.slug}>
                    <Link
                      to={`/admin/guide/${entry.slug === GUIDE_HOME ? "" : entry.slug}`}
                      className={cn("block rounded-md px-2 py-1 text-[13px] leading-5", active === entry.slug ? "bg-slate-100 font-medium text-ink" : "text-slate-600 hover:bg-slate-50 hover:text-ink")}
                      aria-current={active === entry.slug ? "page" : undefined}
                    >
                      {entry.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </nav>
    </div>
  );
}

function Toc({ headings }: { headings: { id: string; text: string; level: number }[] }) {
  return (
    <ul className="mt-2 space-y-1">
      {headings.map((heading) => (
        <li key={heading.id}>
          <a href={`#${heading.id}`} className={cn("block text-[12px] leading-5 text-slate-500 hover:text-ink", heading.level === 3 && "pl-3")}>
            {heading.text}
          </a>
        </li>
      ))}
    </ul>
  );
}

function SearchResults({ results, onOpen }: { results: { entry: GuideEntry; snippet: string }[]; onOpen: () => void }) {
  return (
    <div className="mb-6 rounded-lg border border-line">
      <p className="border-b border-slate-100 px-3 py-2 text-[12px] text-slate-500">{results.length} {results.length === 1 ? "page" : "pages"}</p>
      {results.length ? (
        <ul>
          {results.map((result) => (
            <li key={result.entry.slug} className="border-b border-slate-100 last:border-b-0">
              <Link to={`/admin/guide/${result.entry.slug === GUIDE_HOME ? "" : result.entry.slug}`} className="block px-3 py-2 hover:bg-slate-50" onClick={onOpen}>
                <span className="block text-[13px] font-medium text-ink">{result.entry.title}</span>
                <span className="mt-0.5 block text-[12px] leading-5 text-slate-500">{result.snippet}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-3 py-4 text-[13px] text-slate-500">No matching page.</p>
      )}
    </div>
  );
}

function searchGuide(query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return GUIDE.flatMap((entry) => {
    const body = guideSource(entry.file);
    const haystack = `${entry.title}\n${body}`.toLowerCase();
    const at = haystack.indexOf(needle);
    if (at < 0) return [];
    const start = Math.max(0, at - 40);
    const snippet = body.replace(/\s+/g, " ").slice(Math.max(0, start - entry.title.length), start + 120).trim();
    return [{ entry, snippet: snippet || entry.section }];
  });
}
