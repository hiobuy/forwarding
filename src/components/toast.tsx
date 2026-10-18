import { CheckCircle2, CircleAlert, X } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

type Toast = { id: number; title: string; tone: "success" | "danger" };

const ToastContext = createContext<(toast: Omit<Toast, "id">) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = useCallback((id: number) => setToasts((current) => current.filter((item) => item.id !== id)), []);
  const push = useCallback(
    (toast: Omit<Toast, "id">) => {
      const id = Date.now() + Math.random();
      setToasts((current) => [...current.slice(-2), { ...toast, id }]);
      window.setTimeout(() => dismiss(id), toast.tone === "danger" ? 6500 : 4000);
    },
    [dismiss],
  );
  const value = useMemo(() => push, [push]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-4 bottom-4 z-[60] flex flex-col items-center gap-2 sm:inset-x-auto sm:right-5 sm:bottom-5 sm:w-[360px] sm:items-end"
        aria-live="polite"
        role="status"
      >
        {toasts.map((toast) => {
          const danger = toast.tone === "danger";
          const Icon = danger ? CircleAlert : CheckCircle2;
          return (
            <div
              key={toast.id}
              className="toast-in pointer-events-auto flex w-full items-start gap-2.5 rounded-xl bg-ink px-3.5 py-3 text-[13px] leading-5 text-white shadow-[0_10px_30px_-8px_rgba(16,24,40,0.45)]"
            >
              <Icon size={17} className={`mt-px shrink-0 ${danger ? "text-red-400" : "text-emerald-400"}`} aria-hidden="true" />
              <span className="min-w-0 flex-1 font-medium">{toast.title}</span>
              <button type="button" className="-my-0.5 -mr-1 grid size-6 shrink-0 place-items-center rounded-md text-slate-400 hover:bg-white/10 hover:text-white" aria-label="Dismiss" onClick={() => dismiss(toast.id)}>
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
