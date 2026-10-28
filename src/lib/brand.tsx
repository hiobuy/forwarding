import { useQuery } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useMemo, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router";
import { DEFAULT_PRIMARY_COLOR, OPEN_SOURCE_BRAND, darkenHex, pageTitle, resolveBusiness, type PublicBrand, type StoredBusiness } from "../domain/business";
import { resolveSiteMode, type SiteMode } from "../domain/site";
import { api } from "./api";

const emptyStored: StoredBusiness = {
  name: "",
  legalName: "",
  email: "",
  supportEmail: "",
  phone: "",
  whatsapp: "",
  country: "",
  address: "",
  description: "",
  primaryColor: OPEN_SOURCE_BRAND.primaryColor,
  accentColor: "",
  publicUrl: "",
  appUrl: "",
  appUrlTrusted: false,
  supportUrl: "",
  privacyUrl: "",
  termsUrl: "",
  browserTitle: "",
  metaDescription: "",
  logos: { primary: false, square: false, favicon: false },
  updatedAt: 0,
};

export const fallbackBrand: PublicBrand = resolveBusiness(emptyStored);

type BrandResponse = PublicBrand & { siteMode?: string; githubUrl?: string | null };

type BrandState = {
  brand: PublicBrand;
  siteMode: SiteMode;
  githubUrl: string | null;
  siteReady: boolean;
  siteFailed: boolean;
  retrySite: () => void;
};

const BrandContext = createContext<BrandState>({
  brand: fallbackBrand,
  siteMode: "integrated",
  githubUrl: null,
  siteReady: false,
  siteFailed: false,
  retrySite: () => undefined,
});

export function BrandProvider({ children }: { children: ReactNode }) {
  const query = useQuery({
    queryKey: ["branding"],
    queryFn: () => api<BrandResponse>("/api/branding"),
    staleTime: 60_000,
  });
  const brand = useMemo(() => {
    if (!query.data) return fallbackBrand;
    const rest = { ...query.data };
    delete rest.siteMode;
    delete rest.githubUrl;
    return rest;
  }, [query.data]);
  const siteMode = resolveSiteMode(query.data?.siteMode);
  const githubUrl = query.data?.githubUrl || null;
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--color-brand", brand.primaryColor);
    root.style.setProperty("--color-brand-dark", darkenHex(brand.primaryColor));
    if (brand.accentColor) root.style.setProperty("--color-accent", brand.accentColor);
    const description = document.querySelector('meta[name="description"]') ?? document.head.appendChild(document.createElement("meta"));
    description.setAttribute("name", "description");
    description.setAttribute("content", brand.seo.metaDescription);
    if (brand.logos.favicon) {
      const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]') ?? document.head.appendChild(document.createElement("link"));
      icon.rel = "icon";
      icon.href = `/api/branding/assets/favicon?v=${brand.updatedAt}`;
    }
  }, [brand]);
  const state = useMemo<BrandState>(
    () => ({
      brand,
      siteMode,
      githubUrl,
      siteReady: query.isSuccess,
      siteFailed: query.isError,
      retrySite: () => {
        void query.refetch();
      },
    }),
    [brand, siteMode, githubUrl, query.isSuccess, query.isError, query.refetch],
  );
  return <BrandContext.Provider value={state}>{children}</BrandContext.Provider>;
}

export function useBrand() {
  return useContext(BrandContext).brand;
}

export function useSiteMode() {
  const state = useContext(BrandContext);
  return { mode: state.siteMode, ready: state.siteReady, failed: state.siteFailed, retry: state.retrySite, githubUrl: state.githubUrl };
}

/** Marketing pages keep the prototype palette until the operator picks a color other than the app default. */
export function marketingAccent(brand: PublicBrand): CSSProperties | undefined {
  if (brand.primaryColor.toUpperCase() === DEFAULT_PRIMARY_COLOR) return undefined;
  return { "--pb-primary": brand.primaryColor, "--pb-primary-strong": darkenHex(brand.primaryColor, 0.08) } as CSSProperties;
}

export function usePageTitle(page: string) {
  const brand = useBrand();
  useEffect(() => {
    document.title = pageTitle(page, brand);
  }, [page, brand]);
}

export function BrandLockup({
  compact = false,
  tone = "dark",
  href,
}: {
  compact?: boolean;
  tone?: "dark" | "light";
  href?: string;
}) {
  const brand = useBrand();
  const initial = brand.name.trim().charAt(0).toUpperCase() || "F";
  const logo = brand.logos.square || brand.logos.primary;
  const kind = brand.logos.square ? "square" : "primary";
  const mark = logo ? (
    <img src={`/api/branding/assets/${kind}?v=${brand.updatedAt}`} alt="" className="size-8 rounded-lg bg-white object-contain p-0.5" />
  ) : (
    <span className={`grid size-8 place-items-center rounded-lg text-[13px] font-semibold ${tone === "light" ? "bg-white text-ink" : "bg-[#101828] text-white"}`}>{initial}</span>
  );
  const label = (
    <span className="min-w-0">
      <span className={`block truncate text-sm font-semibold tracking-tight ${tone === "light" ? "text-white" : "text-ink"}`}>{brand.name}</span>
    </span>
  );
  const body = (
    <span className="flex min-w-0 items-center gap-2.5">
      {mark}
      {compact ? null : label}
    </span>
  );
  if (!href) return body;
  if (/^https?:\/\//.test(href)) {
    return (
      <a href={href} className="flex min-w-0 items-center gap-2.5">
        {mark}
        {compact ? null : label}
      </a>
    );
  }
  return (
    <Link to={href} className="flex min-w-0 items-center gap-2.5">
      {mark}
      {compact ? null : label}
    </Link>
  );
}
