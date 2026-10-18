import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none",
        "placeholder:text-slate-400 focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100",
        className,
      )}
      {...props}
    />
  );
}
