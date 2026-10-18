import { WorkersAITTS } from "agents/voice";

/**
 * Voice language support.
 *
 * English keeps the original pipeline (Deepgram Flux in, Aura out).
 * Chinese listens with Whisper (cut into utterances by a small energy-based VAD) and speaks with MeloTTS.
 * Whisper is used instead of Nova-3 because Workers AI refused Nova-3 WebSocket sessions with language "zh".
 * The browser picks the language with `?voice_lang=zh` on the voice WebSocket.
 */
export type VoiceLang = "en" | "zh";

type AiLike = { run(model: string, input: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown> };

const CJK = /[㐀-鿿豈-﫿]/;

export function hasChinese(text: string): boolean {
  return CJK.test(text);
}

export function voiceLangOf(uri: string | null | undefined): VoiceLang {
  if (!uri) return "en";
  try {
    return new URL(uri).searchParams.get("voice_lang") === "zh" ? "zh" : "en";
  } catch {
    return "en";
  }
}

/** Strip punctuation and spaces so "确认。" or "Confirm!" still match short commands. */
export function normalizeCommand(text: string): string {
  return text.trim().replace(/[\s.,!?;:'"，。！？；：、“”‘’]/g, "");
}

/**
 * Speaks with one voice per call: MeloTTS for a Chinese call, the original Aura voice for an English call.
 * Mixing the two inside one reply made the volume jump, because MeloTTS is much quieter than Aura
 * (a short English-only sentence like "SHP-20392." used to switch voices mid-reply).
 * Outside a Chinese call, text that contains Chinese still goes to MeloTTS so it is never read by the English voice.
 */
export class BilingualTTS {
  #ai: AiLike;
  #english: WorkersAITTS;
  #lang: () => VoiceLang;

  constructor(ai: unknown, lang: () => VoiceLang = () => "en") {
    this.#ai = ai as AiLike;
    this.#english = new WorkersAITTS(ai as ConstructorParameters<typeof WorkersAITTS>[0]);
    this.#lang = lang;
  }

  async synthesize(text: string, signal?: AbortSignal): Promise<ArrayBuffer | null> {
    if (this.#lang() !== "zh" && !hasChinese(text)) return this.#english.synthesize(text, signal);
    try {
      const result = (await this.#ai.run("@cf/myshell-ai/melotts", { prompt: spokenIds(text), lang: "zh" }, signal ? { signal } : undefined)) as
        | { audio?: string }
        | ReadableStream
        | ArrayBuffer;
      if (result instanceof ArrayBuffer) return result;
      if (result instanceof ReadableStream) return await new Response(result).arrayBuffer();
      if (result && typeof result.audio === "string") return base64ToArrayBuffer(result.audio);
      console.error("MeloTTS returned no audio");
      return null;
    } catch (error) {
      // An abort means the reply was interrupted on purpose; only real failures are worth logging.
      if (!(error instanceof Error && error.name === "AbortError")) console.error("MeloTTS failed", error);
      return null;
    }
  }
}

/** Read IDs like SHP-20392 as "SHP 2 0 3 9 2" so the voice doesn't say "twenty thousand". */
function spokenIds(text: string): string {
  return text.replace(/\b([A-Z]{2,4})-?(\d{4,})\b/g, (_, prefix: string, digits: string) => `${prefix.split("").join(" ")} ${digits.split("").join(" ")}`);
}

function base64ToArrayBuffer(value: string): ArrayBuffer {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export const voiceCopy = {
  en: {
    declined: "Okay, I won't do that.",
    done: "Done.",
    created: (ids: string) => `Package added ${ids}.`,
    doneWith: (id: string) => `Done. ${id}.`,
    instruction:
      "You are speaking aloud. Reply in English. Keep the reply to one or two short sentences. For a change like a pre-alert or claim, call the tool and tell the customer to tap Confirm or say confirm.",
  },
  zh: {
    declined: "好的，这个操作不做了。",
    done: "好了。",
    created: (ids: string) => `已经添加包裹：${ids}。`,
    doneWith: (id: string) => `好了，${id}。`,
    instruction:
      "You are speaking aloud to a Chinese-speaking customer. Reply in natural spoken Simplified Chinese, one or two short sentences. Keep package, shipment and tracking ids exactly as written, such as PKG-10301 or SHP-20392. Say money as 美元, for example 126 美元. Do not use markdown or lists. For a change like a pre-alert or claim, call the tool and tell the customer to tap 确认 or say 确认.",
  },
} as const;

type SessionOptions = {
  onInterim?: (text: string) => void;
  onSpeechStart?: (text?: string) => void;
  onUtterance?: (transcript: string) => void;
  onFatalError?: (error: Error) => void;
};

export type WhisperVadOptions = {
  /** RMS level (0–1) that counts as speech. */
  speechThreshold?: number;
  /** Silence that ends an utterance, in ms. */
  endSilenceMs?: number;
  /** Shortest speech worth transcribing, in ms. */
  minSpeechMs?: number;
  /** Longest utterance before it is cut, in ms. */
  maxUtteranceMs?: number;
  /** How often to refresh live captions while the customer talks, in ms. 0 turns it off. */
  interimEveryMs?: number;
  /** Audio kept from just before speech starts, in ms. */
  preRollMs?: number;
  /** Loud audio needed before an utterance starts, in ms. Filters clicks and short noises. */
  startMs?: number;
  /**
   * Speech needed before we tell the pipeline the customer is talking over the assistant, in ms.
   * The pipeline stops the assistant's reply on that signal, so a loose value cuts replies off on background noise.
   */
  bargeInMs?: number;
};

const SAMPLE_RATE = 16000;
const BYTES_PER_MS = (SAMPLE_RATE * 2) / 1000;
const WHISPER = "@cf/openai/whisper-large-v3-turbo";
const PROMPT = "以下是普通话的句子，使用简体中文。可能提到包裹号 PKG-10301、运单号 SHP-20392、预报、合箱、运费、钱包、充值。";
// Whisper sometimes "hears" these subtitle credits in silence.
const HALLUCINATIONS = [/字幕/, /謝謝觀看|谢谢观看/, /请不吝点赞|訂閱|订阅/, /^[\s。，！？.,!?]*$/];

/**
 * Chinese speech-to-text for the voice pipeline.
 * Audio arrives as 16 kHz mono PCM. A simple energy VAD finds each utterance, then Whisper transcribes it.
 */
export class WhisperChineseTranscriber {
  #ai: AiLike;
  #options: Required<WhisperVadOptions>;

  constructor(ai: unknown, options: WhisperVadOptions = {}) {
    this.#ai = ai as AiLike;
    this.#options = {
      speechThreshold: options.speechThreshold ?? 0.03,
      endSilenceMs: options.endSilenceMs ?? 700,
      minSpeechMs: options.minSpeechMs ?? 250,
      maxUtteranceMs: options.maxUtteranceMs ?? 15000,
      interimEveryMs: options.interimEveryMs ?? 1200,
      preRollMs: options.preRollMs ?? 300,
      startMs: options.startMs ?? 120,
      bargeInMs: options.bargeInMs ?? 600,
    };
  }

  createSession(options: SessionOptions = {}) {
    return new WhisperSession(this.#ai, this.#options, options);
  }
}

class WhisperSession {
  #ai: AiLike;
  #o: Required<WhisperVadOptions>;
  #cb: SessionOptions;
  #closed = false;
  #speaking = false;
  #chunks: Uint8Array[] = [];
  #preRoll: Uint8Array[] = [];
  #speechMs = 0;
  #silenceMs = 0;
  #utteranceMs = 0;
  #sinceInterim = 0;
  #loudRunMs = 0;
  #bargedIn = false;
  #interimBusy = false;
  #generation = 0;
  #queue: Promise<void> = Promise.resolve();
  #idleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(ai: AiLike, options: Required<WhisperVadOptions>, callbacks: SessionOptions) {
    this.#ai = ai;
    this.#o = options;
    this.#cb = callbacks;
  }

  feed(chunk: ArrayBuffer) {
    if (this.#closed || chunk.byteLength < 2) return;
    const bytes = new Uint8Array(chunk.slice(0));
    const ms = bytes.byteLength / BYTES_PER_MS;
    const loud = rms(bytes) >= this.#o.speechThreshold;

    if (!this.#speaking) {
      this.#preRoll.push(bytes);
      while (this.#preRoll.length > 1 && totalBytes(this.#preRoll) / BYTES_PER_MS > this.#o.preRollMs + this.#o.startMs) this.#preRoll.shift();
      this.#loudRunMs = loud ? this.#loudRunMs + ms : 0;
      if (this.#loudRunMs < this.#o.startMs) return;
      this.#speaking = true;
      this.#bargedIn = false;
      this.#chunks = [...this.#preRoll];
      this.#preRoll = [];
      this.#speechMs = this.#loudRunMs;
      this.#loudRunMs = 0;
      this.#silenceMs = 0;
      this.#utteranceMs = totalBytes(this.#chunks) / BYTES_PER_MS;
      this.#sinceInterim = 0;
      this.#armIdle();
      return;
    }

    this.#chunks.push(bytes);
    this.#utteranceMs += ms;
    this.#sinceInterim += ms;
    if (loud) {
      this.#speechMs += ms;
      this.#silenceMs = 0;
      this.#armIdle();
      if (!this.#bargedIn && this.#speechMs >= this.#o.bargeInMs) {
        this.#bargedIn = true;
        this.#cb.onSpeechStart?.();
      }
    } else {
      this.#silenceMs += ms;
    }

    if (this.#silenceMs >= this.#o.endSilenceMs || this.#utteranceMs >= this.#o.maxUtteranceMs) {
      this.#finish();
      return;
    }
    if (this.#o.interimEveryMs > 0 && this.#sinceInterim >= this.#o.interimEveryMs && !this.#interimBusy) {
      this.#sinceInterim = 0;
      void this.#interim();
    }
  }

  waitUntilReady() {
    return Promise.resolve();
  }

  close() {
    this.#closed = true;
    this.#generation++;
    if (this.#idleTimer) clearTimeout(this.#idleTimer);
    this.#chunks = [];
    this.#preRoll = [];
  }

  /** If the browser stops sending audio mid-utterance, close the utterance anyway. */
  #armIdle() {
    if (this.#idleTimer) clearTimeout(this.#idleTimer);
    this.#idleTimer = setTimeout(() => {
      if (this.#speaking && !this.#closed) this.#finish();
    }, this.#o.endSilenceMs + 300);
  }

  #finish() {
    if (this.#idleTimer) clearTimeout(this.#idleTimer);
    const chunks = this.#chunks;
    const speechMs = this.#speechMs;
    this.#speaking = false;
    this.#chunks = [];
    this.#speechMs = 0;
    this.#silenceMs = 0;
    this.#utteranceMs = 0;
    const generation = ++this.#generation;
    if (speechMs < this.#o.minSpeechMs) return;
    const audio = concat(chunks);
    this.#queue = this.#queue.then(async () => {
      try {
        const text = await this.#transcribe(audio);
        if (this.#closed || !text) return;
        this.#cb.onUtterance?.(text);
      } catch (error) {
        console.error("Whisper transcription failed", error);
        if (generation === this.#generation && !this.#closed) this.#cb.onInterim?.("");
      }
    });
  }

  async #interim() {
    const generation = this.#generation;
    this.#interimBusy = true;
    try {
      const text = await this.#transcribe(concat(this.#chunks));
      if (text && generation === this.#generation && this.#speaking && !this.#closed) this.#cb.onInterim?.(text);
    } catch {
      // Live captions are best effort.
    } finally {
      this.#interimBusy = false;
    }
  }

  async #transcribe(pcm: Uint8Array): Promise<string> {
    const result = (await this.#ai.run(WHISPER, {
      audio: toBase64(wav(pcm)),
      language: "zh",
      task: "transcribe",
      initial_prompt: PROMPT,
      condition_on_previous_text: false,
    })) as { text?: string };
    const text = (result?.text ?? "").trim();
    if (!text || HALLUCINATIONS.some((pattern) => pattern.test(text))) return "";
    return text;
  }
}

function rms(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const samples = Math.floor(bytes.byteLength / 2);
  if (!samples) return 0;
  let sum = 0;
  for (let i = 0; i < samples; i++) {
    const value = view.getInt16(i * 2, true) / 32768;
    sum += value * value;
  }
  return Math.sqrt(sum / samples);
}

function totalBytes(chunks: Uint8Array[]) {
  return chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(totalBytes(chunks));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** Wrap 16 kHz mono 16-bit PCM in a WAV header. */
export function wav(pcm: Uint8Array): Uint8Array {
  const out = new Uint8Array(44 + pcm.byteLength);
  const view = new DataView(out.buffer);
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) out[offset + i] = value.charCodeAt(i);
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + pcm.byteLength, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, pcm.byteLength, true);
  out.set(pcm, 44);
  return out;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) binary += String.fromCharCode(...bytes.subarray(i, i + step));
  return btoa(binary);
}
