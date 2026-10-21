import type { LucideIcon } from "lucide-react";
import { AlertTriangle, ArrowLeft, Check, Eye, EyeOff, ChevronLeft, ChevronRight, CircleAlert, Copy, Info, Inbox, Loader2, RotateCw, Search, X } from "lucide-react";
import { Children, forwardRef, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";
import { Link } from "react-router";
import { translateActive, useI18n } from "../lib/i18n";
import { cargoLabel, type CargoAttribute, type Tone } from "../domain/status";
import { formatCm, formatDimensions, formatKg } from "../domain/units";
import { usePageTitle } from "../lib/brand";
import { cn } from "../lib/utils";
import { useToast } from "./toast";

/** "1 package", "3 packages". */
export function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${translateActive(count === 1 ? one : many)}`;
}

function textNodes(children: ReactNode, t: (text: string, vars?: Record<string, string | number>) => string) {
  return Children.map(children, (child) => (typeof child === "string" ? t(child) : child));
}

const tones: Record<Tone, string> = {
  success: "bg-emerald-50 text-emerald-700 ring-emerald-600/15",
  warning: "bg-amber-50 text-amber-800 ring-amber-600/20",
  danger: "bg-red-50 text-red-700 ring-red-600/15",
  info: "bg-indigo-50 text-indigo-700 ring-indigo-600/15",
  neutral: "bg-slate-100 text-slate-600 ring-slate-500/10",
};

const toneDot: Record<Tone, string> = {
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  danger: "bg-red-500",
  info: "bg-indigo-500",
  neutral: "bg-slate-400",
};

const statusTone: Record<string, Tone> = {
  ready: "success",
  ready_to_ship: "success",
  delivered: "success",
  completed: "neutral",
  action_required: "danger",
  vas_processing: "info",
  in_consolidation: "info",
  consolidating: "info",
  waiting_for_weight: "info",
  in_transit: "info",
  pending: "neutral",
  received: "success",
  consolidated: "info",
  shipped: "info",
  transferring: "warning",
  discarded: "neutral",
  unclaimed: "warning",
  archived: "neutral",
  exception: "danger",
  to_pay: "warning",
  return_requested: "warning",
  disposal_requested: "warning",
  cancelled: "neutral",
};

const statusOverride: Record<string, string> = {
  vas_processing: "bg-violet-50 text-violet-700 ring-violet-600/15",
  in_transit: "bg-sky-50 text-sky-700 ring-sky-600/15",
  shipped: "bg-sky-50 text-sky-700 ring-sky-600/15",
};
const dotOverride: Record<string, string> = {
  vas_processing: "bg-violet-500",
  in_transit: "bg-sky-500",
  shipped: "bg-sky-500",
};

export function StatusBadge({ label, tone, statusKey, className }: { label: string; tone: Tone; statusKey?: string; className?: string }) {
  const { t } = useI18n();
  const resolved = (statusKey && statusTone[statusKey]) || tone;
  const style = (statusKey && statusOverride[statusKey]) || tones[resolved];
  const dot = (statusKey && dotOverride[statusKey]) || toneDot[resolved];
  return (
    <span
      className={cn(
        "inline-flex w-fit shrink-0 items-center gap-1.5 justify-self-start rounded-full px-2 py-0.5 text-[11px] leading-4 font-medium whitespace-nowrap ring-1 ring-inset",
        style,
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", dot)} aria-hidden="true" />
      {t(label)}
    </span>
  );
}

export function CargoBadge({ attribute }: { attribute: CargoAttribute }) {
  const { t } = useI18n();
  const special = attribute !== "GENERAL";
  return (
    <span
      className={cn(
        "inline-flex rounded-md px-1.5 py-0.5 text-[11px] font-medium",
        special ? "bg-amber-50 text-amber-800 ring-1 ring-amber-600/15 ring-inset" : "bg-slate-100 text-slate-600",
      )}
    >
      {t(cargoLabel(attribute))}
    </span>
  );
}

export function Money({ fen, signed = false }: { fen: number; signed?: boolean }) {
  const { format } = useI18n();
  return <span className="tabular-nums">{format(fen, { signed })}</span>;
}

export function MoneyRange({ min, max }: { min: number; max: number }) {
  const { format } = useI18n();
  const start = format(min);
  const end = format(max);
  return <span className="tabular-nums">{start === end ? start : `${start}–${end}`}</span>;
}

export function Weight({ grams }: { grams: number | null }) {
  return <span className="tabular-nums">{grams == null ? "—" : formatKg(grams)}</span>;
}

export function Dimensions({ length, width, height }: { length: number | null; width: number | null; height: number | null }) {
  if (length == null || width == null || height == null) return <span>—</span>;
  return <span className="tabular-nums">{formatDimensions(length, width, height)}</span>;
}

export function Cm({ mm }: { mm: number | null }) {
  return <span className="tabular-nums">{mm == null ? "—" : `${formatCm(mm)} cm`}</span>;
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "subtle";

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: "sm" | "md" | "lg"; to?: string; loading?: boolean }
>(function Button({ variant = "primary", size = "md", className = "", to, loading = false, children, disabled, ...props }, ref) {
  const { t } = useI18n();
  const label = textNodes(children, t);
  const styles = {
    primary: "bg-brand text-white shadow-[0_1px_2px_rgba(67,56,202,0.3),inset_0_1px_0_rgba(255,255,255,0.12)] hover:bg-brand-dark active:bg-indigo-800 disabled:bg-indigo-300 disabled:shadow-none",
    secondary: "border border-slate-200 bg-white text-slate-700 shadow-[0_1px_2px_rgba(16,24,40,0.05)] hover:border-slate-300 hover:bg-slate-50 active:bg-slate-100 disabled:text-slate-400 disabled:hover:bg-white",
    ghost: "text-slate-600 hover:bg-slate-100 hover:text-ink active:bg-slate-200/70 disabled:text-slate-300",
    subtle: "bg-indigo-50 text-indigo-700 hover:bg-indigo-100 active:bg-indigo-200/70 disabled:opacity-50",
    danger: "bg-red-600 text-white shadow-[0_1px_2px_rgba(185,28,28,0.3)] hover:bg-red-700 active:bg-red-800 disabled:bg-red-300",
  }[variant];
  const sizes = {
    sm: "h-7 gap-1 rounded-md px-2.5 text-[12px]",
    md: variant === "ghost" ? "h-8 gap-1.5 rounded-lg px-2.5 text-[13px]" : "h-9 gap-1.5 rounded-lg px-3.5 text-[13px]",
    lg: "h-11 gap-2 rounded-xl px-5 text-sm",
  }[size];
  const classes = cn(
    "inline-flex shrink-0 items-center justify-center font-medium tracking-tight whitespace-nowrap transition-[color,background-color,border-color,box-shadow] duration-150 select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 disabled:cursor-not-allowed",
    sizes,
    styles,
    className,
  );
  const content = (
    <>
      {loading ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : null}
      {label}
    </>
  );
  if (to) {
    if (disabled) return <span className={cn(classes, "pointer-events-none opacity-60")} aria-disabled="true">{content}</span>;
    return <Link to={to} className={classes}>{content}</Link>;
  }
  return (
    <button ref={ref} className={classes} disabled={disabled || loading} aria-busy={loading || undefined} {...props}>
      {content}
    </button>
  );
});

export function ChoiceCard({
  checked,
  control,
  children,
  onSelect,
  className,
}: {
  checked?: boolean;
  control: ReactNode;
  children: ReactNode;
  onSelect?: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "group flex cursor-pointer items-start gap-3.5 rounded-xl border p-4 transition-[border-color,background-color,box-shadow] duration-150",
        checked ? "border-indigo-400 bg-indigo-50/60 shadow-[0_0_0_3px_rgba(99,102,241,0.12)]" : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/70",
        className,
      )}
      onClick={onSelect}
    >
      <span className="mt-0.5" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
        {control}
      </span>
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}

export function SectionHeading({
  icon: Icon,
  title,
  tone = "slate",
  action,
}: {
  icon?: LucideIcon;
  title: string;
  tone?: "indigo" | "emerald" | "sky" | "amber" | "rose" | "slate";
  action?: ReactNode;
}) {
  const { t } = useI18n();
  const iconTone = {
    indigo: "bg-indigo-50 text-indigo-600",
    emerald: "bg-emerald-50 text-emerald-700",
    sky: "bg-sky-50 text-sky-700",
    amber: "bg-amber-50 text-amber-700",
    rose: "bg-rose-50 text-rose-700",
    slate: "bg-slate-100 text-slate-500",
  }[tone];
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2.5">
        {Icon ? (
          <span className={cn("grid size-7 place-items-center rounded-lg", iconTone)}>
            <Icon size={15} aria-hidden="true" />
          </span>
        ) : null}
        <h2 className="text-[13px] font-semibold tracking-tight">{t(title)}</h2>
      </div>
      {action}
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={cn("rounded-xl border border-slate-200/80 bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.03)] sm:p-5", className)}>{children}</section>;
}

export function Field({
  label,
  hint,
  error,
  optional,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  optional?: boolean;
  children: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <label className="block text-[13px] font-medium text-slate-800">
      {t(label)}
      {optional ? <span className="ml-1.5 font-normal text-slate-400">{t("Optional")}</span> : null}
      <div className="mt-1.5">{children}</div>
      {error ? (
        <span className="mt-1.5 flex items-center gap-1 text-[13px] font-normal text-red-700">
          <CircleAlert size={13} aria-hidden="true" />
          {t(error)}
        </span>
      ) : null}
      {hint && !error ? <span className="mt-1.5 block text-[13px] leading-5 font-normal text-slate-500">{t(hint)}</span> : null}
    </label>
  );
}

export const inputClass =
  "h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-[0_1px_2px_rgba(16,24,40,0.04)] outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100 read-only:bg-slate-50 read-only:text-slate-500 read-only:hover:border-slate-200 read-only:focus:ring-0";

export function PageHeader({
  title,
  subtitle,
  action,
  back,
  badge,
}: {
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
  back?: { to: string; label: string };
  badge?: ReactNode;
}) {
  const { t } = useI18n();
  const heading = t(title);
  usePageTitle(heading);
  return (
    <div className="mb-6">
      {back ? (
        <Link to={back.to} className="mb-3 inline-flex items-center gap-1 rounded-md text-[13px] font-medium text-slate-500 transition-colors hover:text-ink">
          <ArrowLeft size={14} aria-hidden="true" />
          {t(back.label)}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-[1.6rem] leading-tight font-semibold tracking-tight text-ink">{heading}</h1>
            {badge}
          </div>
          {subtitle ? <p className="mt-1 max-w-2xl text-[13px] leading-5 text-slate-500">{typeof subtitle === "string" ? t(subtitle) : subtitle}</p> : null}
        </div>
        {action ? <div className="flex flex-wrap items-center gap-2">{action}</div> : null}
      </div>
    </div>
  );
}

export function FilterBar({
  value,
  options,
  onChange,
}: {
  value: string;
  options: readonly { key: string; label: string; count?: number }[];
  onChange: (key: string) => void;
}) {
  const { t } = useI18n();
  const counted = options.some((option) => option.count != null);
  return (
    <div className="scroll-area -mx-4 mb-4 overflow-x-auto px-4 md:mx-0 md:px-0" role="tablist">
      <div className="flex w-max gap-1 rounded-xl bg-slate-200/50 p-1">
        {options.map((option) => {
          const active = value === option.key;
          return (
            <button
              key={option.key}
              type="button"
              role="tab"
              aria-selected={active}
              className={cn(
                "rounded-lg px-3 whitespace-nowrap transition-[background-color,color,box-shadow] duration-150",
                counted ? "py-1.5" : "h-8",
                active ? "bg-white font-medium text-ink shadow-[0_1px_2px_rgba(16,24,40,0.08)]" : "text-slate-500 hover:bg-white/60 hover:text-slate-800",
              )}
              onClick={() => onChange(option.key)}
            >
              {option.count != null ? <span className={cn("block text-center text-[13px] leading-none font-semibold tabular-nums", !option.count && !active && "text-slate-300")}>{option.count}</span> : null}
              <span className={option.count != null ? "mt-1 block text-[12px]" : "text-[13px]"}>{t(option.label)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Search field that submits on Enter and can be cleared in one click. */
export function SearchInput({
  defaultValue,
  placeholder,
  label,
  onSearch,
  className,
  size = "md",
}: {
  defaultValue: string;
  placeholder: string;
  label: string;
  onSearch: (value: string) => void;
  className?: string;
  size?: "sm" | "md";
}) {
  const { t } = useI18n();
  const [value, setValue] = useState(defaultValue);
  useEffect(() => {
    setValue(defaultValue);
  }, [defaultValue]);
  return (
    <form
      role="search"
      className={cn("relative mb-4", className)}
      onSubmit={(event) => {
        event.preventDefault();
        onSearch(value.trim());
      }}
    >
      <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" aria-hidden="true" />
      <input
        className={cn(inputClass, size === "sm" && "h-8 rounded-md text-[13px] shadow-none", "pr-9 pl-9")}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && value) {
            setValue("");
            onSearch("");
          }
        }}
        placeholder={t(placeholder)}
        aria-label={t(label)}
        type="search"
        enterKeyHint="search"
      />
      {value ? (
        <button
          type="button"
          className="absolute top-1/2 right-2 grid size-6 -translate-y-1/2 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          aria-label={t("Clear search")}
          onClick={() => {
            setValue("");
            onSearch("");
          }}
        >
          <X size={14} />
        </button>
      ) : null}
    </form>
  );
}

export function Pagination({ page, pageSize, total, onChange, className }: { page: number; pageSize: number; total: number;   onChange: (page: number) => void; className?: string }) {
  const { t } = useI18n();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className={cn("mt-3 flex items-center justify-between gap-3 text-[13px] text-slate-500", className)}>
      <span className="tabular-nums">
        {t("{from}–{to} of {total}", { from, to, total })}
      </span>
      {pages > 1 ? (
        <div className="flex items-center gap-1">
          <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onChange(page - 1)} aria-label={t("Previous page")}>
            <ChevronLeft size={14} /> Previous
          </Button>
          <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => onChange(page + 1)} aria-label={t("Next page")}>
            Next <ChevronRight size={14} />
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function EmptyState({ title, body, action, icon: Icon = Inbox }: { title: string; body: string; action?: ReactNode; icon?: LucideIcon }) {
  const { t } = useI18n();
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white/70 px-6 py-12 text-center">
      <span className="mx-auto grid size-11 place-items-center rounded-xl bg-slate-100 text-slate-500">
        <Icon size={20} aria-hidden="true" />
      </span>
      <h2 className="mt-4 text-[15px] font-semibold tracking-tight">{t(title)}</h2>
      <p className="mx-auto mt-1.5 max-w-sm text-[13px] leading-5 text-slate-500">{t(body)}</p>
      {action ? <div className="mt-5 flex justify-center gap-2">{action}</div> : null}
    </div>
  );
}

export function LoadingBlock({ label = "Loading", rows = 3 }: { label?: string; rows?: number }) {
  const { t } = useI18n();
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-white" role="status" aria-live="polite">
      <span className="sr-only">{t(label)}</span>
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="flex items-center gap-4 border-b border-slate-100 px-4 py-4 last:border-b-0">
          <div className="flex-1 space-y-2">
            <div className="h-3 w-1/3 animate-pulse rounded bg-slate-200" />
            <div className="h-2.5 w-1/2 animate-pulse rounded bg-slate-100" />
          </div>
          <div className="h-5 w-20 animate-pulse rounded-full bg-slate-100" />
        </div>
      ))}
    </div>
  );
}

export function ErrorState({ message, onRetry, action }: { message: string; onRetry?: () => void; action?: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50/70 p-4 text-sm text-red-900" role="alert">
      <AlertTriangle size={18} className="mt-0.5 shrink-0 text-red-600" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{t(message)}</p>
        {onRetry || action ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {onRetry ? (
              <Button variant="secondary" size="sm" onClick={onRetry}>
                <RotateCw size={13} /> Try again
              </Button>
            ) : null}
            {action}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function Notice({ children, tone = "warning", action }: { children: ReactNode; tone?: "warning" | "danger" | "info" | "success"; action?: ReactNode }) {
  const style = {
    warning: "border-amber-200 bg-amber-50 text-amber-950",
    danger: "border-red-200 bg-red-50 text-red-950",
    info: "border-indigo-100 bg-indigo-50/70 text-indigo-950",
    success: "border-emerald-200 bg-emerald-50 text-emerald-950",
  }[tone];
  const Icon = { warning: AlertTriangle, danger: CircleAlert, info: Info, success: Check }[tone];
  const iconTone = { warning: "text-amber-600", danger: "text-red-600", info: "text-indigo-500", success: "text-emerald-600" }[tone];
  return (
    <div className={cn("flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-[13px] leading-5", style)} role={tone === "danger" ? "alert" : undefined}>
      <Icon size={16} className={cn("mt-0.5 shrink-0", iconTone)} aria-hidden="true" />
      <div className="min-w-0 flex-1">{children}</div>
      {action ? <div className="shrink-0 self-center">{action}</div> : null}
    </div>
  );
}

/** Copies text and shows a short confirmation in place. */
export function CopyButton({
  value,
  label = "Copy",
  copiedLabel = "Copied",
  toastTitle,
  variant = "secondary",
  size = "md",
  iconOnly = false,
  className,
}: {
  value: string;
  label?: string;
  copiedLabel?: string;
  toastTitle?: string;
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
  iconOnly?: boolean;
  className?: string;
}) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={cn(iconOnly && "w-8 px-0", copied && "text-emerald-700", className)}
      aria-label={iconOnly ? `${label}: ${value}` : undefined}
      title={iconOnly ? label : undefined}
      onClick={() => {
        void navigator.clipboard.writeText(value).then(
          () => {
            setCopied(true);
            if (toastTitle) toast({ title: toastTitle, tone: "success" });
          },
          () => toast({ title: "Copy failed. Select the text and copy it manually.", tone: "danger" }),
        );
      }}
    >
      {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
      {iconOnly ? null : copied ? copiedLabel : label}
    </Button>
  );
}

function useDialogKeys(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [open, onClose]);
}

export function Dialog({
  open,
  title,
  description,
  onClose,
  children,
  footer,
  size = "md",
  spacious = false,
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: "md" | "lg" | "xl";
  spacious?: boolean;
}) {
  const { t } = useI18n();
  const titleId = useId();
  useDialogKeys(open, onClose);
  if (!open) return null;
  return (
    <div className="dialog-backdrop fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 backdrop-blur-[2px] sm:items-center sm:p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          "dialog-panel flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl",
          size === "xl" ? "sm:max-w-[640px]" : size === "lg" ? "sm:max-w-xl" : "sm:max-w-md",
        )}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className={cn("flex items-start justify-between gap-3", spacious ? "px-6 pt-5 pb-2" : "border-b border-slate-100 px-5 py-4")}>
          <div>
            <h2 id={titleId} className="text-base font-semibold tracking-tight">
              {t(title)}
            </h2>
            {description ? <p className="mt-0.5 text-[13px] text-slate-500">{t(description)}</p> : null}
          </div>
          <button type="button" className={cn("grid size-8 place-items-center text-slate-500 hover:bg-slate-100 hover:text-slate-800", spacious ? "rounded-full border border-slate-200" : "-mr-1.5 rounded-lg text-slate-400")} aria-label={t("Close")} onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className={cn("scroll-area min-h-0 flex-1 overflow-y-auto", spacious ? "px-6 py-4" : "px-5 py-4")}>{children}</div>
        {footer ? <div className={cn("flex justify-end gap-2", spacious ? "px-6 pt-2 pb-5" : "border-t border-slate-100 bg-slate-50/60 px-5 py-3")}>{footer}</div> : null}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  confirmPhrase,
  danger,
  pending,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  /** When set, the confirm button stays off until this text is typed exactly. */
  confirmPhrase?: string;
  danger?: boolean;
  pending?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const [typed, setTyped] = useState("");
  useEffect(() => {
    if (!open) return;
    setTyped("");
    if (confirmPhrase) inputRef.current?.focus();
    else ref.current?.focus();
  }, [open, confirmPhrase]);
  useDialogKeys(open, onClose);
  if (!open) return null;
  const confirmed = !confirmPhrase || typed.trim() === confirmPhrase;
  return (
    <div className="dialog-backdrop fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 p-4 backdrop-blur-[2px] sm:items-center" onMouseDown={onClose}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="dialog-panel w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex gap-3.5">
          <span className={cn("grid size-10 shrink-0 place-items-center rounded-full", danger ? "bg-red-50 text-red-600" : "bg-indigo-50 text-indigo-600")}>
            {danger ? <AlertTriangle size={18} aria-hidden="true" /> : <Info size={18} aria-hidden="true" />}
          </span>
          <div>
            <h2 id={titleId} className="text-base font-semibold tracking-tight">
              {t(title)}
            </h2>
            <p className="mt-1.5 text-[13px] leading-5 text-slate-600">{t(body)}</p>
            {confirmPhrase ? (
              <label className="mt-3 block text-[13px] text-slate-700">
                {t("Type {phrase} to confirm", { phrase: confirmPhrase }).split(confirmPhrase)[0]}
                <span className="font-mono font-medium text-ink">{confirmPhrase}</span>
                {t("Type {phrase} to confirm", { phrase: confirmPhrase }).split(confirmPhrase)[1]}
                <input ref={inputRef} className="mt-1.5 h-9 w-full rounded-lg border border-slate-200 px-3 font-mono text-[13px] outline-none focus:border-slate-400" value={typed} autoComplete="off" onChange={(event) => setTyped(event.target.value)} />
              </label>
            ) : null}
          </div>
        </div>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button ref={ref} variant="secondary" onClick={onClose}>
            Go back
          </Button>
          <Button variant={danger ? "danger" : "primary"} loading={pending} disabled={!confirmed} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function PhotoGallery({ photos = [] }: { photos?: { id: string; type: string; label: string; url?: string | null }[] }) {
  const [active, setActive] = useState<number | null>(null);
  const close = () => setActive(null);
  useDialogKeys(active != null, close);
  useEffect(() => {
    if (active == null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight") setActive((value) => (value == null ? value : Math.min(photos.length - 1, value + 1)));
      if (event.key === "ArrowLeft") setActive((value) => (value == null ? value : Math.max(0, value - 1)));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, photos.length]);
  const { t } = useI18n();
  if (photos.length === 0) return <p className="text-[13px] text-slate-500">{t("No photos yet. They appear after the warehouse handles the parcel.")}</p>;
  const current = active == null ? null : photos[active];
  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {photos.map((photo, index) => (
          <button
            key={photo.id}
            type="button"
            className="group overflow-hidden rounded-xl border border-slate-200 bg-white text-left transition hover:border-slate-300 hover:shadow-sm"
            onClick={() => setActive(index)}
          >
            {photo.url && /video/i.test(photo.type) ? (
              <video src={photo.url} className="aspect-[4/3] w-full bg-slate-950 object-cover" muted playsInline />
            ) : photo.url ? (
              <img src={photo.url} alt={photo.label} loading="lazy" className="aspect-[4/3] w-full bg-slate-100 object-cover transition group-hover:brightness-[0.97]" />
            ) : (
              <div className="photo-placeholder flex aspect-[4/3] items-center justify-center text-[11px] font-medium tracking-wide text-slate-500 capitalize transition group-hover:brightness-[0.98]">
                {photo.type.toLowerCase()}
              </div>
            )}
            <div className="px-3 py-2 text-[13px] font-medium">{photo.label}</div>
          </button>
        ))}
      </div>
      {current && active != null ? (
        <div className="dialog-backdrop fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4" onMouseDown={close}>
          <div className="dialog-panel w-full max-w-2xl overflow-hidden rounded-2xl bg-white" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label={current.label}>
            {current.url && /video/i.test(current.type) ? (
              <video src={current.url} className="max-h-[70vh] w-full bg-slate-950" controls autoPlay />
            ) : current.url ? (
              <img src={current.url} alt={current.label} className="max-h-[70vh] w-full bg-slate-950 object-contain" />
            ) : (
              <div className="photo-placeholder flex aspect-[16/10] items-center justify-center text-sm font-medium tracking-wide text-slate-500 capitalize">{current.type.toLowerCase()}</div>
            )}
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{current.label}</p>
                <p className="text-[12px] text-slate-400 tabular-nums">
                  {active + 1} of {photos.length}
                </p>
              </div>
              <div className="flex gap-1.5">
                <Button variant="secondary" size="sm" className="w-8 px-0" disabled={active === 0} onClick={() => setActive(active - 1)} aria-label={t("Previous photo")}>
                  <ChevronLeft size={15} />
                </Button>
                <Button variant="secondary" size="sm" className="w-8 px-0" disabled={active === photos.length - 1} onClick={() => setActive(active + 1)} aria-label={t("Next photo")}>
                  <ChevronRight size={15} />
                </Button>
                <Button variant="secondary" size="sm" onClick={close}>
                  Close
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

/** A label / value row for description lists. */
export function DataRow({ label, value, strong = false }: { label: string; value: ReactNode; strong?: boolean }) {
  const { t } = useI18n();
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="text-[13px] text-slate-500">{t(label)}</dt>
      <dd className={cn("text-right text-[13px] tabular-nums", strong ? "font-semibold text-ink" : "font-medium text-slate-800")}>{value}</dd>
    </div>
  );
}

export function PasswordInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  const { t } = useI18n();
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input required {...props} className={cn(className ?? inputClass, "pr-10")} type={show ? "text" : "password"} />
      <button
        type="button"
        className="absolute top-1/2 right-1.5 grid size-7 -translate-y-1/2 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        aria-label={show ? t("Hide password") : t("Show password")}
        onClick={() => setShow((value) => !value)}
      >
        {show ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </div>
  );
}
