import { cn } from "../../lib/utils";

export function Ms({ name, className }: { name: string; className?: string }) {
  return (
    <span className={cn("ms", className)} aria-hidden="true">
      {name}
    </span>
  );
}
