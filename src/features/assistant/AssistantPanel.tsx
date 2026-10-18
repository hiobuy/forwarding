import { getToolApproval, getToolCallId, getToolInput, getToolPartState, useAgentChat } from "@cloudflare/ai-chat/react";
import { getToolName, isToolUIPart, type UIMessage } from "ai";
import { useVoiceAgent } from "@cloudflare/voice/react";
import { useQuery } from "@tanstack/react-query";
import { useAgent } from "agents/react";
import { ArrowRight, ArrowUp, Bell, Boxes, CreditCard, Keyboard, Mic, MicOff, Package, PhoneOff, Wallet, X } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { assistantPage } from "../../domain/assistant-pages";
import { api } from "../../lib/api";
import { cn } from "../../lib/utils";
import type { PackageItem, Page, Shipment } from "../../types/api";
import { VoiceBars, VoiceOrb, type OrbMode } from "./VoiceOrb";

const prompts = [
  { text: "What needs my attention?", icon: Bell },
  { text: "Which packages are ready?", icon: Package },
  { text: "Which shipments can I pay?", icon: CreditCard },
  { text: "What's my wallet balance?", icon: Wallet },
];

const stageCopy = {
  modes: { connecting: "Connecting…", listening: "Listening", thinking: "Looking it up…", speaking: "Speaking", muted: "Muted" } as Record<OrbMode, string>,
  live: "Live",
  connecting: "Connecting",
  trySaying: "Try saying",
  hints: ["What needs my attention?", "Where is my shipment?", "Which packages are ready to ship?"],
  you: "You",
  assistant: "Assistant",
  needsOk: "Needs your OK",
  confirm: "Confirm",
  decline: "Don't do this",
  sayIt: "Or just say “confirm” or “cancel”.",
  typePlaceholder: "Type instead of speaking…",
  heroTitle: "Just ask out loud",
  heroHint: "“Which packages are ready?” “Where is SHP-20360?”",
};

export function AssistantToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={cn(
        "group relative inline-flex h-9 items-center gap-1.5 overflow-hidden rounded-lg border px-2.5 text-[13px] font-medium shadow-[0_1px_2px_rgba(16,24,40,0.05)] transition-colors",
        open ? "border-ink bg-ink text-white" : "border-slate-200 bg-white text-ink hover:bg-slate-50",
      )}
      aria-expanded={open}
      onClick={onToggle}
    >
      <span className="relative grid size-4 place-items-center" aria-hidden="true">
        <span className="assistant-dot absolute inset-0 rounded-full" />
      </span>
      <span className="hidden sm:inline">Assistant</span>
      <span className="sr-only sm:hidden">Assistant</span>
    </button>
  );
}

export function AssistantSidebar({ userId, onClose }: { userId: string; onClose: () => void }) {
  return <AssistantChat userId={userId} onClose={onClose} />;
}

/** Maps IDs the assistant mentions (PKG-…, SHP-…, carrier tracking numbers) to pages in the app. */
function useEntityLinks() {
  const packages = useQuery({ queryKey: ["assistant-packages"], queryFn: () => api<Page<PackageItem>>("/api/packages?status=all&pageSize=50"), staleTime: 30_000 });
  const shipments = useQuery({ queryKey: ["assistant-shipments"], queryFn: () => api<Page<Shipment>>("/api/shipments?status=all"), staleTime: 30_000 });
  return useMemo(() => {
    const map = new Map<string, Entity>();
    packages.data?.items.forEach((item) =>
      map.set(item.publicId, { id: item.publicId, kind: "package", label: item.publicId, detail: item.displayStatus.label, path: `/app/packages/${item.id}` }),
    );
    shipments.data?.items.forEach((item) => {
      map.set(item.publicId, { id: item.publicId, kind: "shipment", label: item.publicId, detail: item.displayStatus.label, path: `/app/shipments/${item.id}` });
      if (item.trackingNumber) map.set(item.trackingNumber, { id: item.trackingNumber, kind: "tracking", label: item.trackingNumber, detail: "Tracking", path: `/app/shipments/${item.id}` });
    });
    return (text: string): Entity[] => {
      const found = new Map<string, Entity>();
      for (const match of text.matchAll(/\b(PKG-\d+|SHP-\d+|[A-Z]{2}\d{9,12})\b/g)) {
        const key = match[1]!;
        const known = map.get(key);
        if (known) found.set(key, known);
      }
      return [...found.values()].slice(0, 4);
    };
  }, [packages.data, shipments.data]);
}

type Entity = { id: string; kind: "package" | "shipment" | "tracking"; label: string; detail: string; path: string };

function AssistantChat({ userId, onClose }: { userId: string; onClose: () => void }) {
  const agent = useAgent<{ pending: { summary: string } | null }>({
    agent: "ForwardingAssistant",
    name: userId,
  });
  const voice = useVoiceAgent({ agent: "ForwardingAssistant", name: userId, query: { voice_lang: "en" } });
  const { messages, sendMessage, status, addToolApprovalResponse } = useAgentChat({ agent });
  const [draft, setDraft] = useState("");
  const [connecting, setConnecting] = useState(false);
  const navigate = useNavigate();
  const entities = useEntityLinks();
  const scroller = useRef<HTMLDivElement>(null);
  const busy = status === "submitted" || status === "streaming";
  const links = messages.flatMap(pageLinks);
  const approvals = messages.flatMap(approvalRequests);
  const transcript = `${messages.map((message) => message.parts.map((part) => (part.type === "text" ? part.text : "")).join("")).join("\n")}\n${links.map((link) => link.path).join(",")}\n${approvals.map((item) => item.id).join(",")}`;
  const inCall = voice.status !== "idle" || connecting;
  const pending = agent.state?.pending ?? null;

  useEffect(() => {
    if (voice.status !== "idle" || voice.error) setConnecting(false);
  }, [voice.status, voice.error]);

  useLayoutEffect(() => {
    const node = scroller.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [transcript, busy, status, voice.transcript.length, inCall]);

  function ask(text: string) {
    const next = text.trim();
    if (!next || busy) return;
    setDraft("");
    void sendMessage({ text: next });
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    ask(draft);
  }

  async function startVoice() {
    setConnecting(true);
    try {
      await voice.startCall();
    } catch {
      setConnecting(false);
    }
  }

  function decide(word: "confirm" | "cancel") {
    if (voice.status === "idle") ask(word);
    else voice.sendText(word);
  }

  return (
    <aside className="assistant-panel fixed inset-0 z-40 flex min-h-0 flex-col bg-white md:static md:z-auto md:w-[380px] md:shrink-0 md:border-l md:border-slate-200">
      {inCall ? (
        <VoiceStage
          mode={connecting && voice.status === "idle" ? "connecting" : voice.isMuted ? "muted" : (voice.status as OrbMode)}
          level={voice.audioLevel}
          muted={voice.isMuted}
          transcript={voice.transcript}
          interim={voice.interimTranscript}
          pending={pending}
          error={voice.error}
          entities={entities}
          onOpen={(path) => navigate(path)}
          onEnd={() => {
            voice.endCall();
            setConnecting(false);
          }}
          onMute={voice.toggleMute}
          onSendText={(text) => voice.sendText(text)}
          onDecide={decide}
          onClose={() => {
            voice.endCall();
            onClose();
          }}
        />
      ) : (
        <section className="flex min-h-0 flex-1 flex-col">
          <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
            <div className="flex items-center gap-2.5">
              <span className="assistant-avatar size-8 rounded-full" aria-hidden="true" />
              <div>
                <h2 className="text-sm font-semibold text-ink">Assistant</h2>
                <p className="flex items-center gap-1.5 text-[12px] text-slate-500">
                  <span className={cn("size-1.5 rounded-full", agent.readyState === 1 ? "bg-emerald-500" : "bg-slate-300")} aria-hidden="true" />
                  Answers from your account
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <button type="button" className="grid size-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-ink" aria-label="Close assistant" onClick={onClose}>
                <X size={17} />
              </button>
            </div>
          </header>
          <div ref={scroller} className="scroll-area min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
            {messages.length === 0 && voice.transcript.length === 0 ? (
              <div className="step-in">
                <button
                  type="button"
                  className="assistant-hero group relative w-full overflow-hidden rounded-2xl p-4 text-left text-white"
                  onClick={() => void startVoice()}
                >
                  <span className="relative z-10 flex items-center justify-between gap-3">
                    <span>
                      <span className="block text-[15px] font-semibold">{stageCopy.heroTitle}</span>
                      <span className="mt-0.5 block text-[12px] leading-[18px] text-indigo-100/90">{stageCopy.heroHint}</span>
                    </span>
                    <span className="grid size-11 shrink-0 place-items-center rounded-full bg-white/15 ring-1 ring-white/30 backdrop-blur transition group-hover:scale-105 group-hover:bg-white/25">
                      <Mic size={19} />
                    </span>
                  </span>
                </button>
                <p className="mt-5 mb-2 text-[12px] font-medium text-slate-500">Or start with</p>
                <div className="grid gap-2">
                  {prompts.map((prompt) => (
                    <button
                      key={prompt.text}
                      type="button"
                      className="group flex w-full items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left text-[13px] text-ink transition-colors hover:border-indigo-200 hover:bg-indigo-50/50"
                      onClick={() => ask(prompt.text)}
                    >
                      <prompt.icon size={15} className="text-slate-400 group-hover:text-indigo-500" aria-hidden="true" />
                      <span className="flex-1">{prompt.text}</span>
                      <ArrowRight size={14} className="text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-indigo-400" aria-hidden="true" />
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {messages.map((message) => (
              <Message
                key={message.id}
                message={message}
                entities={entities}
                onOpen={(path) => navigate(path)}
                onDecide={(id, approved) => addToolApprovalResponse({ id, approved })}
              />
            ))}
            {voice.transcript.length ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-[11px] font-medium text-slate-400">
                  <span className="h-px flex-1 bg-slate-200" />
                  <Mic size={11} aria-hidden="true" /> Voice conversation
                  <span className="h-px flex-1 bg-slate-200" />
                </div>
                {voice.transcript.map((turn) => (
                  <Bubble key={turn.timestamp + turn.role} mine={turn.role === "user"} text={turn.text} entities={turn.role === "user" ? [] : entities(turn.text)} onOpen={(path) => navigate(path)} />
                ))}
              </div>
            ) : null}
            {pending ? <ConfirmCard summary={pending.summary} onConfirm={() => decide("confirm")} onCancel={() => decide("cancel")} /> : null}
            {status === "submitted" ? <TypingDots /> : null}
            {voice.error ? <p className="rounded-xl bg-red-50 px-3 py-2 text-[13px] text-red-700">{voice.error}</p> : null}
            {status === "error" && messages.at(-1)?.role !== "assistant" ? (
              <p className="rounded-xl bg-red-50 px-3 py-2 text-[13px] text-red-700">The assistant couldn't reply. This trial needs Workers AI.</p>
            ) : null}
          </div>
          <form className="border-t border-slate-100 px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]" onSubmit={onSubmit}>
            <div className="flex items-center gap-1.5 rounded-2xl border border-slate-200 bg-white py-1.5 pr-1.5 pl-3.5 shadow-[0_1px_2px_rgba(16,24,40,0.06)] transition focus-within:border-indigo-300 focus-within:ring-4 focus-within:ring-indigo-100">
              <input
                className="min-w-0 flex-1 bg-transparent py-1.5 text-sm text-ink outline-none placeholder:text-slate-400"
                value={draft}
                placeholder="Ask about your parcels…"
                aria-label="Message the assistant"
                onChange={(event) => setDraft(event.target.value)}
              />
              {draft.trim() ? (
                <button type="submit" className="grid size-9 place-items-center rounded-xl bg-brand text-white transition hover:bg-brand-dark disabled:bg-indigo-300" aria-label="Send" disabled={busy}>
                  <ArrowUp size={18} />
                </button>
              ) : (
                <button type="button" className="assistant-mic grid size-9 place-items-center rounded-xl text-white" aria-label="Talk to the assistant" title="Voice" onClick={() => void startVoice()}>
                  <Mic size={17} />
                </button>
              )}
            </div>
            <p className="mt-1.5 text-center text-[11px] text-slate-400">Adding a package always asks you to confirm. Payments stay on the page.</p>
          </form>
        </section>
      )}
    </aside>
  );
}

export function VoiceStage({
  mode,
  level,
  muted,
  transcript,
  interim,
  pending,
  error,
  entities,
  onOpen,
  onEnd,
  onMute,
  onSendText,
  onDecide,
  onClose,
}: {
  mode: OrbMode;
  level: number;
  muted: boolean;
  transcript: { role: string; text: string; timestamp: number }[];
  interim: string | null;
  pending: { summary: string } | null;
  error: string | null;
  entities: (text: string) => Entity[];
  onOpen: (path: string) => void;
  onEnd: () => void;
  onMute: () => void;
  onSendText: (text: string) => void;
  onDecide: (word: "confirm" | "cancel") => void;
  onClose: () => void;
}) {
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [hint, setHint] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => {
      setSeconds((value) => value + 1);
      setHint((value) => value + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);
  const copy = stageCopy;
  const hints = copy.hints;
  const recent = transcript.slice(-4);
  const lastAssistant = [...transcript].reverse().find((turn) => turn.role === "assistant");
  const found = lastAssistant ? entities(lastAssistant.text) : [];
  const captionRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    captionRef.current?.scrollTo({ top: captionRef.current.scrollHeight, behavior: "smooth" });
  }, [transcript.length, interim]);

  return (
    <section className="voice-stage relative flex min-h-0 flex-1 flex-col overflow-hidden text-white" aria-label="Voice conversation">
      <div className="voice-aurora pointer-events-none absolute inset-0" aria-hidden="true" />
      <header className="relative z-10 flex items-center justify-between px-4 pt-3.5">
        <div className="flex items-center gap-2 rounded-full bg-white/[0.07] py-1 pr-3 pl-2 text-[12px] text-white/80 ring-1 ring-white/10 backdrop-blur">
          <span className={cn("size-2 rounded-full", mode === "connecting" ? "bg-amber-300" : "voice-live bg-rose-400")} aria-hidden="true" />
          {mode === "connecting" ? copy.connecting : copy.live}
          <span className="text-white/40 tabular-nums">
            {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button" className="grid size-8 place-items-center rounded-full text-white/60 hover:bg-white/10 hover:text-white" aria-label="End call and close" onClick={onClose}>
            <X size={17} />
          </button>
        </div>
      </header>

      <div className="relative z-10 flex flex-col items-center pt-2">
        <button type="button" className="rounded-full focus-visible:ring-2 focus-visible:ring-white/50" aria-label={muted ? "Unmute" : "Mute"} onClick={onMute}>
          <VoiceOrb mode={mode} level={level} size={208} />
        </button>
        <p className="-mt-3 text-[13px] font-medium tracking-wide text-white/85" aria-live="polite">
          {copy.modes[mode]}
        </p>
      </div>

      <div ref={captionRef} className="voice-captions relative z-10 mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto px-5 pb-3">
        {recent.length === 0 && !interim && mode === "listening" ? (
          <div className="pt-4 text-center">
            <p className="text-[12px] text-white/40">{copy.trySaying}</p>
            <p key={Math.floor(hint / 4)} className="step-in mt-1 text-lg leading-snug font-medium text-white/90">“{hints[Math.floor(hint / 4) % hints.length]}”</p>
          </div>
        ) : null}
        {recent.map((turn, index) => {
          const latest = index === recent.length - 1;
          const mine = turn.role === "user";
          return (
            <div key={turn.timestamp + turn.role} className={cn("step-in transition-opacity", latest ? "opacity-100" : "opacity-45")}>
              <div className="mb-0.5 text-[11px] font-medium text-white/40">{mine ? copy.you : copy.assistant}</div>
              <p className={cn("leading-snug", mine ? "text-[15px] text-white/70" : latest ? "text-[19px] font-medium text-white" : "text-[15px] text-white/80")}>
                <RichText text={turn.text} />
              </p>
            </div>
          );
        })}
        {interim ? (
          <div className="step-in">
            <div className="mb-0.5 text-[11px] font-medium text-white/40">{copy.you}</div>
            <p className="text-[17px] leading-snug text-white/75">
              {interim}
              <span className="voice-caret ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] bg-cyan-300" aria-hidden="true" />
            </p>
          </div>
        ) : null}
        {found.length ? (
          <div className="step-in flex flex-wrap gap-2 pt-1">
            {found.map((entity) => (
              <button
                key={entity.id}
                type="button"
                className="group inline-flex items-center gap-2 rounded-xl bg-white/[0.08] py-1.5 pr-2.5 pl-2 text-left ring-1 ring-white/15 backdrop-blur transition hover:bg-white/[0.14]"
                onClick={() => onOpen(entity.path)}
              >
                <EntityIcon kind={entity.kind} dark />
                <span>
                  <span className="block text-[12px] font-semibold">{entity.label}</span>
                  <span className="block text-[11px] text-white/55">{entity.detail}</span>
                </span>
                <ArrowRight size={13} className="text-white/40 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
              </button>
            ))}
          </div>
        ) : null}
        {pending ? (
          <div className="step-in rounded-2xl bg-white/[0.08] p-3.5 ring-1 ring-amber-300/40 backdrop-blur">
            <p className="text-[11px] font-medium text-amber-200">{copy.needsOk}</p>
            <p className="mt-0.5 text-[15px] font-medium">{pending.summary}</p>
            <div className="mt-3 flex gap-2">
              <button type="button" className="flex-1 rounded-xl bg-white py-2 text-[13px] font-semibold text-ink hover:bg-slate-100" onClick={() => onDecide("confirm")}>
                {copy.confirm}
              </button>
              <button type="button" className="flex-1 rounded-xl bg-white/10 py-2 text-[13px] font-medium text-white ring-1 ring-white/20 hover:bg-white/15" onClick={() => onDecide("cancel")}>
                {copy.decline}
              </button>
            </div>
            <p className="mt-2 text-center text-[11px] text-white/45">{copy.sayIt}</p>
          </div>
        ) : null}
        {error ? <p className="rounded-xl bg-red-500/15 px-3 py-2 text-[13px] text-red-200 ring-1 ring-red-400/30">{error}</p> : null}
      </div>

      <div className="relative z-10 px-4 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <VoiceBars mode={mode} level={level} />
        {typing ? (
          <form
            className="step-in mt-3 flex items-center gap-1.5 rounded-2xl bg-white/[0.08] py-1.5 pr-1.5 pl-3.5 ring-1 ring-white/15"
            onSubmit={(event) => {
              event.preventDefault();
              if (!text.trim()) return;
              onSendText(text.trim());
              setText("");
              setTyping(false);
            }}
          >
            <input
              autoFocus
              className="min-w-0 flex-1 bg-transparent py-1.5 text-sm text-white outline-none placeholder:text-white/40"
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={copy.typePlaceholder}
              aria-label="Type a message"
              onKeyDown={(event) => event.key === "Escape" && setTyping(false)}
            />
            <button type="submit" className="grid size-8 place-items-center rounded-xl bg-white text-ink" aria-label="Send">
              <ArrowUp size={16} />
            </button>
          </form>
        ) : null}
        <div className="mt-3 flex items-center justify-center gap-5">
          <RoundButton label={typing ? "Hide keyboard" : "Type instead"} active={typing} onClick={() => setTyping((value) => !value)}>
            <Keyboard size={19} />
          </RoundButton>
          <button
            type="button"
            className="grid size-16 place-items-center rounded-full bg-rose-500 text-white shadow-[0_8px_24px_-6px_rgba(244,63,94,0.7)] transition hover:scale-105 hover:bg-rose-600 active:scale-95"
            aria-label="End voice conversation"
            onClick={onEnd}
          >
            <PhoneOff size={24} />
          </button>
          <RoundButton label={muted ? "Unmute microphone" : "Mute microphone"} active={muted} onClick={onMute}>
            {muted ? <MicOff size={19} /> : <Mic size={19} />}
          </RoundButton>
        </div>
      </div>
    </section>
  );
}

function RoundButton({ label, active, onClick, children }: { label: string; active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn("grid size-12 place-items-center rounded-full ring-1 backdrop-blur transition", active ? "bg-white text-ink ring-white" : "bg-white/[0.08] text-white ring-white/15 hover:bg-white/[0.15]")}
    >
      {children}
    </button>
  );
}

function EntityIcon({ kind, dark = false }: { kind: Entity["kind"]; dark?: boolean }) {
  const Icon = kind === "package" ? Package : kind === "shipment" ? Boxes : ArrowRight;
  return (
    <span className={cn("grid size-7 place-items-center rounded-lg", dark ? "bg-white/10 text-cyan-200" : "bg-indigo-50 text-indigo-600")}>
      <Icon size={14} aria-hidden="true" />
    </span>
  );
}

function TypingDots() {
  return (
    <div className="flex items-center gap-2" role="status" aria-label="Assistant is thinking">
      <span className="assistant-avatar size-6 rounded-full" aria-hidden="true" />
      <span className="flex gap-1 rounded-2xl rounded-bl-md bg-slate-100 px-3 py-2.5">
        {[0, 1, 2].map((i) => (
          <span key={i} className="typing-dot size-1.5 rounded-full bg-slate-400" style={{ animationDelay: `${i * 150}ms` }} />
        ))}
      </span>
    </div>
  );
}

function ConfirmCard({ summary, onConfirm, onCancel }: { summary: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="step-in w-full rounded-2xl border border-amber-200 bg-amber-50 p-3.5">
      <p className="text-[11px] font-medium text-amber-700">Needs your OK</p>
      <p className="mt-0.5 text-sm font-medium text-ink">{summary}</p>
      <div className="mt-3 flex gap-2">
        <button type="button" className="rounded-lg bg-ink px-3 py-1.5 text-[13px] font-medium text-white hover:bg-slate-800" onClick={onConfirm}>
          Confirm
        </button>
        <button type="button" className="rounded-lg bg-white px-3 py-1.5 text-[13px] font-medium text-ink ring-1 ring-slate-300 hover:bg-slate-50" onClick={onCancel}>
          Don't do this
        </button>
      </div>
    </div>
  );
}

function Bubble({ mine, text, entities, onOpen }: { mine: boolean; text: string; entities: Entity[]; onOpen: (path: string) => void }) {
  return (
    <div className={cn("step-in flex gap-2", mine ? "justify-end" : "justify-start")}>
      {!mine ? <span className="assistant-avatar mt-0.5 size-6 shrink-0 rounded-full" aria-hidden="true" /> : null}
      <div className={cn("flex max-w-[85%] flex-col gap-1.5", mine ? "items-end" : "items-start")}>
        <p
          className={cn(
            "rounded-2xl px-3.5 py-2 text-[13.5px] leading-[1.55] whitespace-pre-wrap",
            mine ? "rounded-br-md bg-brand text-white" : "rounded-bl-md bg-slate-100 text-ink",
          )}
        >
          <RichText text={text} />
        </p>
        {entities.length ? <EntityChips entities={entities} onOpen={onOpen} /> : null}
      </div>
    </div>
  );
}

function EntityChips({ entities, onOpen }: { entities: Entity[]; onOpen: (path: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {entities.map((entity) => (
        <button
          key={entity.id}
          type="button"
          className="group inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white py-1 pr-2.5 pl-1 text-left transition hover:border-indigo-200 hover:bg-indigo-50/50"
          onClick={() => onOpen(entity.path)}
        >
          <EntityIcon kind={entity.kind} />
          <span>
            <span className="block text-[12px] font-semibold text-ink">{entity.label}</span>
            <span className="block text-[11px] text-slate-500">{entity.detail}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

function Message({
  message,
  entities,
  onOpen,
  onDecide,
}: {
  message: UIMessage;
  entities: (text: string) => Entity[];
  onOpen: (path: string) => void;
  onDecide: (id: string, approved: boolean) => void;
}) {
  const text = message.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
  const links = pageLinks(message);
  const approvals = approvalRequests(message);
  if (!text && links.length === 0 && approvals.length === 0) return null;
  const mine = message.role === "user";
  return (
    <div className="space-y-2">
      {text ? <Bubble mine={mine} text={text} entities={mine ? [] : entities(text)} onOpen={onOpen} /> : null}
      {approvals.map((item) => (
        <ConfirmCard key={item.id} summary={item.summary} onConfirm={() => onDecide(item.id, true)} onCancel={() => onDecide(item.id, false)} />
      ))}
      {links.length ? (
        <div className="flex flex-wrap gap-1.5 pl-8">
          {links.map((link) => (
            <button
              key={link.id}
              type="button"
              className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-3 py-1.5 text-[12px] font-medium text-indigo-700 hover:bg-indigo-100"
              onClick={() => onOpen(link.path)}
            >
              Open {link.title} <ArrowRight size={12} aria-hidden="true" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function approvalRequests(message: UIMessage) {
  return message.parts.flatMap((part) => {
    if (!isToolUIPart(part) || getToolPartState(part) !== "waiting-approval") return [];
    const approval = getToolApproval(part);
    if (!approval) return [];
    return [{ id: approval.id, callId: getToolCallId(part), summary: describeAction(getToolName(part), getToolInput(part)) }];
  });
}

function describeAction(name: string, input: unknown) {
  const data = input && typeof input === "object" ? input as Record<string, unknown> : {};
  if (name === "prealertPackages" && typeof data.trackingNumber === "string") {
    return `Add package ${data.trackingNumber}`;
  }
  if (name === "prealertPackages" && Array.isArray(data.items)) {
    const lines = data.items.map((item) => {
      const row = item as { courier?: string; trackingNumber?: string };
      const courier = row.courier && !/^(courier|unknown|n\/a|none|other)$/i.test(row.courier) ? `${row.courier} ` : "";
      return `${courier}${row.trackingNumber ?? ""}`.trim();
    });
    return `Add packages ${lines.join(", ")}`;
  }
  if (name === "claimPackage") return `Claim ${String(data.trackingNumber ?? "this parcel")}`;
  if (name === "submitConsolidation") return `Consolidate ${Array.isArray(data.packageIds) ? data.packageIds.join(", ") : "packages"} on ${String(data.routeCode ?? "the selected route")}`;
  if (name === "cancelConsolidation") return `Cancel ${String(data.shipmentId ?? "this shipment")}`;
  return "Confirm this action";
}

function pageLinks(message: UIMessage) {
  return message.parts.flatMap((part) => {
    if (part.type !== "tool-openPage" || part.state !== "output-available") return [];
    const output = part.output;
    if (!output || typeof output !== "object" || !("path" in output) || typeof output.path !== "string") return [];
    const page = assistantPage(output.path);
    if (!page) return [];
    return [{ id: part.toolCallId, path: page.path, title: page.title }];
  });
}

function RichText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, index) =>
        part.startsWith("**") && part.endsWith("**") ? <strong key={index}>{part.slice(2, -2)}</strong> : <span key={index}>{part}</span>,
      )}
    </>
  );
}

