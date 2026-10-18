import { formatDateTime } from "../domain/dates";
import type { TimelineEvent } from "../domain/timeline";

export function TimelineList({ events }: { events: TimelineEvent[] }) {
  if (!events.length) return <p className="mt-3 text-[13px] text-slate-500">No activity yet.</p>;
  return (
    <ol className="relative mt-4 space-y-4 pl-5 before:absolute before:top-1.5 before:bottom-1.5 before:left-[5px] before:w-px before:bg-slate-200">
      {events.map((event, index) => (
        <li key={`${event.at}-${event.title}`} className="relative">
          <span className={`absolute top-1 -left-5 size-[11px] rounded-full border-2 border-white ${index === 0 ? "bg-indigo-500 ring-4 ring-indigo-100" : "bg-slate-300"}`} aria-hidden="true" />
          <div className={`text-[13px] ${index === 0 ? "font-semibold text-ink" : "font-medium text-slate-700"}`}>{event.title}</div>
          <div className="text-[12px] text-slate-500">{event.detail} · {formatDateTime(event.at)}</div>
        </li>
      ))}
    </ol>
  );
}
