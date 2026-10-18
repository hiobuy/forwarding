import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { formatDateTime, formatRelative } from "../../domain/dates";
import { Button, Dialog, ErrorState, Field, LoadingBlock, SearchInput, inputClass, plural } from "../../components/ui";
import { Textarea } from "../../components/ui/textarea";
import { api } from "../../lib/api";
import { cn } from "../../lib/utils";
import { AdminHeader, ListEmpty, Panel, useAdminAction, useDemoPreview } from "./shared";

type OpenQuestion = { id: string; question: string; askedBy: { memberCode: string; name: string }[]; ids: string[]; lastAskedAt: string };
type Answer = { id: string; question: string; answer: string; keywords: string; status: "published" | "archived"; updatedAt: string };
type Draft = { id?: string; question: string; answer: string; keywords: string; status: "published" | "archived"; questionIds?: string[] };

export function AdminAssistant() {
  const demo = useDemoPreview();
  const query = useQuery({ queryKey: ["admin", "assistant"], queryFn: () => api<{ open: OpenQuestion[]; answers: Answer[] }>("/api/admin/assistant") });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [search, setSearch] = useState("");
  const dismiss = useAdminAction<OpenQuestion>(() => "/api/admin/assistant/questions/dismiss", {
    body: (item) => ({ ids: item.ids }),
    success: () => "Question dismissed. The assistant keeps giving its standard reply.",
  });
  const toggle = useAdminAction<Answer>((item) => `/api/admin/assistant/answers/${item.id}`, {
    method: "PATCH",
    body: (item) => ({ question: item.question, answer: item.answer, keywords: item.keywords, status: item.status === "published" ? "archived" : "published" }),
    success: (item) => (item.status === "published" ? "Answer hidden from the assistant." : "Answer is live again."),
  });

  if (query.isLoading) return <LoadingBlock rows={4} />;
  if (!query.data) return <ErrorState message="Could not load assistant answers." onRetry={() => void query.refetch()} />;
  const answers = query.data.answers.filter((item) => !search || `${item.question} ${item.answer} ${item.keywords}`.toLowerCase().includes(search.toLowerCase()));

  const live = query.data.answers.filter((item) => item.status === "published").length;
  return (
    <div className="space-y-4">
      <AdminHeader
        title="Assistant"
        meta={demo ? "Sample answers. Publishing is turned off." : "Publish an answer once. Matching questions get that text, word for word."}
        action={demo ? undefined : <Button onClick={() => setDraft({ question: "", answer: "", keywords: "", status: "published" })}>New answer</Button>}
      />

      <Panel>
        <div className="flex items-baseline justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <h2 className="text-[13px] font-semibold tracking-tight">Waiting</h2>
          <span className={cn("text-[12px] tabular-nums", query.data.open.length ? "font-medium text-ink" : "text-slate-400")}>{query.data.open.length ? `${query.data.open.length} open` : "Clear"}</span>
        </div>
        {query.data.open.length === 0 ? (
          <p className="px-4 py-8 text-[13px] text-slate-500">Every missed question has been handled.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {query.data.open.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium text-ink">{item.question}</p>
                  <p className="mt-0.5 text-[12px] text-slate-500">
                    {item.askedBy.length > 2 ? `${item.askedBy.slice(0, 2).map((who) => who.memberCode).join(", ")} and ${item.askedBy.length - 2} more` : item.askedBy.map((who) => `${who.name} (${who.memberCode})`).join(", ") || "A customer"}
                    <span> · {formatRelative(item.lastAskedAt)}</span>
                  </p>
                </div>
                {demo ? null : (
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" className="text-slate-500" loading={dismiss.isPending && dismiss.variables?.id === item.id} onClick={() => dismiss.mutate(item)}>
                    Dismiss
                  </Button>
                  <Button size="sm" onClick={() => setDraft({ question: item.question, answer: "", keywords: "", status: "published", questionIds: item.ids })}>
                    Write answer
                  </Button>
                </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <h2 className="text-[13px] font-semibold tracking-tight">
            Answers <span className="ml-1 font-normal text-slate-400">{live} live</span>
          </h2>
          {query.data.answers.length > 3 ? <SearchInput className="mb-0 w-full sm:w-56" size="sm" defaultValue={search} placeholder="Search answers" label="Search answers" onSearch={setSearch} /> : null}
        </div>
        {answers.length === 0 ? (
          <ListEmpty title={search ? "No answers match" : "No answers yet"} body="Published answers are what the assistant reads before it calls the model." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {answers.map((item) => (
              <li key={item.id} className={cn("px-4 py-3", item.status === "archived" && "opacity-60")}>
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-ink">{item.question}</p>
                    <p className="mt-1 line-clamp-2 text-[13px] leading-5 text-slate-600">{item.answer}</p>
                    <p className="mt-1.5 text-[12px] text-slate-400">
                      {item.status === "published" ? "Live" : "Hidden"}
                      <span> · Updated {formatDateTime(item.updatedAt)}</span>
                      {item.keywords ? <span> · {item.keywords}</span> : null}
                    </p>
                  </div>
                  {demo ? null : (
                  <div className="flex shrink-0 gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setDraft({ ...item })}>Edit</Button>
                    <Button size="sm" variant="ghost" className="text-slate-500" loading={toggle.isPending && toggle.variables?.id === item.id} onClick={() => toggle.mutate(item)}>
                      {item.status === "published" ? "Hide" : "Publish"}
                    </Button>
                  </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <AnswerDialog draft={draft} onClose={() => setDraft(null)} />
    </div>
  );
}

function AnswerDialog({ draft, onClose }: { draft: Draft | null; onClose: () => void }) {
  const [form, setForm] = useState<Draft | null>(draft);
  useEffect(() => {
    setForm(draft);
  }, [draft]);
  const save = useAdminAction<Draft>((item) => (item.id ? `/api/admin/assistant/answers/${item.id}` : "/api/admin/assistant/answers"), {
    method: draft?.id ? "PATCH" : "POST",
    body: (item) => (item.id ? { question: item.question, answer: item.answer, keywords: item.keywords, status: item.status } : { question: item.question, answer: item.answer, keywords: item.keywords, questionIds: item.questionIds }),
    success: (item) => (item.id ? "Answer updated." : `Answer published${item.questionIds?.length ? ` and ${plural(item.questionIds.length, "waiting question")} closed` : ""}.`),
    onDone: onClose,
  });
  const valid = form && form.question.trim().length >= 2 && form.answer.trim().length >= 2;

  return (
    <Dialog
      open={draft != null}
      title={draft?.id ? "Edit answer" : "Publish an answer"}
      description="The assistant uses this text as-is when a customer's question matches. Keep it short and factual."
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="answer-form" loading={save.isPending} disabled={!valid}>
            {draft?.id ? "Save answer" : "Publish answer"}
          </Button>
        </>
      }
    >
      {form ? (
        <form
          id="answer-form"
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (valid) save.mutate(form);
          }}
        >
          <Field label="Question" hint="Write it the way customers ask it.">
            <input className={inputClass} value={form.question} onChange={(event) => setForm({ ...form, question: event.target.value })} placeholder="电池可以寄吗？" />
          </Field>
          <Field label="Answer">
            <Textarea rows={5} value={form.answer} onChange={(event) => setForm({ ...form, answer: event.target.value })} placeholder="可以，但要走带电专线。预报时把货物属性选成 Battery。" autoFocus />
          </Field>
          <Field label="Keywords" optional hint="Comma-separated. A customer's question must contain the question text or one of these words to match.">
            <input className={inputClass} value={form.keywords} onChange={(event) => setForm({ ...form, keywords: event.target.value })} placeholder="电池, 锂电池, battery, power bank" />
          </Field>
        </form>
      ) : null}
    </Dialog>
  );
}
