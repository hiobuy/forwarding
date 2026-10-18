import { AIChatAgent } from "@cloudflare/ai-chat";
import { withVoice, WorkersAIFluxSTT, type VoiceTurnContext } from "agents/voice";
import { convertToModelMessages, createUIMessageStream, createUIMessageStreamResponse, stepCountIs, streamText, tool } from "ai";
import { eq } from "drizzle-orm";
import { createWorkersAI } from "workers-ai-provider";
import { z } from "zod";
import { isAssistantAccountRequest } from "../src/domain/assistant-knowledge";
import { assistantPage, assistantPages } from "../src/domain/assistant-pages";
import { formatFen, formatFenRange } from "../src/domain/money";
import { CARGO_ATTRIBUTES } from "../src/domain/status";
import { normalizeTrackingInput } from "../src/domain/tracking";
import { createDb } from "./db/client";
import { shipments, user } from "./db/schema";
import { lookupAssistantAnswers, recordUnanswered } from "./assistant-knowledge";
import { AppError } from "./errors";
import { BilingualTTS, WhisperChineseTranscriber, hasChinese, normalizeCommand, voiceCopy, voiceLangOf, type VoiceLang } from "./voice-language";
import {
  calculateRates,
  cancelShipment,
  confirmClaim,
  createPrealerts,
  createShipment,
  createShippingQuote,
  getDashboard,
  listAddresses,
  listClaims,
  listPackages,
  listShipments,
} from "./data";

const GAP_REPLY = "这个还没有官方答复，我已经记下来了，补充后下次会按官方答复回复。";
const CONFIRM = /^(yes|yeah|confirm|ok|okay|确认|确定|好|好的|可以|同意|是的|对)$/i;
const CANCEL = /^(no|nope|stop|cancel|不要|不用|取消|算了|不了)$/i;

const SYSTEM = `You are the HIOBuy forwarding assistant for the signed-in customer.
Use tools for account data, freight estimates, tracking, pre-alerts, claims, and consolidation. Warehouse services such as extra photos or repacking are not available yet; say so if asked.
Never invent weights, prices, routes, statuses, or a history of failed attempts.
Customers may ask in Chinese. 充值 is top up, 钱包 is wallet, 预报 is pre-alert, 合箱 is consolidate, 运单 is shipments, 仓库地址 is warehouse, 查运费 is a freight estimate, 查物流 is tracking.
Ready means the package can be consolidated, not that the customer picks it up.
When the customer gives a domestic tracking number and asks to 预报, call prealertPackages. Do not open the pre-alert page instead, and do not tell them to type the number themselves.
Calling a write tool only shows a confirmation button. Do not say the action is done until the tool result says so.
Earlier replies that say you cannot submit a tracking number are wrong. Ignore them.
Never pay, top up, or apply a promo code. If they want to pay, call openPage for /app/shipments or /app/wallet/top-up and tell them to use the Pay or Top up button.
When they ask where a screen is, call openPage. A button appears for them to tap. Do not say the page is already open.
Keep answers short and specific. Mention package and shipment ids.
Service policy comes only from the Approved answers section. If that section has no answer and no account tool applies, call recordUnanswered with the customer's question, then say exactly: ${GAP_REPLY} Do not invent insurance, customs, prohibited goods, storage rules, or compensation.`;

type AssistantBindings = { DB: D1Database; AI: Ai; HIOBUY_API_TOKEN?: string };

type PendingAction = {
  summary: string;
  tool: "prealertPackages" | "claimPackage" | "submitConsolidation" | "cancelConsolidation";
  input: unknown;
};

type AssistantState = { pending: PendingAction | null };

const VoiceChatAgent = withVoice(AIChatAgent);

export class ForwardingAssistant extends VoiceChatAgent<Cloudflare.Env, AssistantState> {
  initialState: AssistantState = { pending: null };
  private voiceTurn = false;
  /** Language of the latest voice turn, used for replies spoken outside a turn (confirm / cancel). */
  private voiceLang: VoiceLang = "en";
  transcriber = new WorkersAIFluxSTT(this.bindings().AI);
  tts = new BilingualTTS(this.bindings().AI, () => this.voiceLang);

  /** Chinese calls listen with Whisper in Mandarin; English calls keep Flux. */
  createTranscriber(connection: { uri?: string | null }) {
    this.voiceLang = voiceLangOf(connection.uri);
    if (this.voiceLang !== "zh") return null;
    return new WhisperChineseTranscriber(this.bindings().AI);
  }

  private bindings(): AssistantBindings {
    return this.env as Cloudflare.Env & AssistantBindings;
  }

  async onTurn(transcript: string, context: VoiceTurnContext) {
    const said = transcript.trim();
    const lang: VoiceLang = voiceLangOf(context.connection.uri) === "zh" || hasChinese(said) ? "zh" : "en";
    this.voiceLang = lang;
    const command = normalizeCommand(said);
    if (this.state.pending && CONFIRM.test(command)) {
      const result = await this.confirmVoiceAction();
      return spokenResult(result, lang);
    }
    if (this.state.pending && CANCEL.test(command)) {
      await this.rejectVoiceAction();
      return voiceCopy[lang].declined;
    }
    const answers = await lookupAssistantAnswers(this.db(), said);
    if (answers.leading) return answers.leading.answer;
    this.voiceTurn = true;
    const result = streamText({
      model: this.model(),
      system: `${this.systemFor(answers.matches)} ${voiceCopy[lang].instruction}`,
      onFinish: async ({ text }) => {
        await this.keepGap(said, text);
      },
      messages: [
        ...context.messages.map((message) => ({ role: message.role as "user" | "assistant", content: message.content })),
        { role: "user" as const, content: transcript },
      ],
      tools: this.chatTools(),
      stopWhen: stepCountIs(6),
      abortSignal: context.signal,
    });
    return this.finishVoice(result.textStream);
  }

  private async *finishVoice(stream: AsyncIterable<string>) {
    try {
      for await (const chunk of stream) yield chunk;
    } finally {
      this.voiceTurn = false;
    }
  }

  async onChatMessage(_onFinish: Parameters<AIChatAgent["onChatMessage"]>[0], options?: Parameters<AIChatAgent["onChatMessage"]>[1]) {
    const latest = this.messages.at(-1);
    const typed = latest?.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join(" ").trim() ?? "";
    if (this.state?.pending && CONFIRM.test(normalizeCommand(typed))) {
      return this.say(spokenResult(await this.confirmVoiceAction()), options?.abortSignal);
    }
    if (this.state?.pending && CANCEL.test(normalizeCommand(typed))) {
      await this.rejectVoiceAction();
      return this.say("Okay, I won't do that.", options?.abortSignal);
    }
    const answers = await lookupAssistantAnswers(this.db(), typed);
    if (answers.leading) return this.replyWith(answers.leading.answer);
    const result = streamText({
      model: this.model(),
      system: this.systemFor(answers.matches),
      messages: await convertToModelMessages(this.messages),
      onFinish: async ({ text }) => {
        await this.keepGap(typed, text);
      },
      tools: this.chatTools(),
      toolApproval: {
        prealertPackages: "user-approval",
        claimPackage: "user-approval",
        submitConsolidation: "user-approval",
        cancelConsolidation: "user-approval",
      },
      stopWhen: stepCountIs(8),
      abortSignal: options?.abortSignal,
    });
    return result.toUIMessageStreamResponse();
  }

  private chatTools() {
    return {
        getAccountSnapshot: tool({
          description: "Current member, warehouse street, wallet balance, counts, and items that need attention.",
          inputSchema: z.object({}),
          execute: async () => this.snapshot(),
        }),
        listMyPackages: tool({
          description: "This customer's packages. status is one of all, pending, received, consolidated, shipped, delivered, exception.",
          inputSchema: z.object({
            status: z.string().optional(),
            query: z.string().optional(),
          }),
          execute: async ({ status, query }) => this.packages(status, query),
        }),
        listMyShipments: tool({
          description: "This customer's shipments. status is one of all, consolidating, to_pay, ready_to_ship, in_transit, completed.",
          inputSchema: z.object({
            status: z.string().optional(),
          }),
          execute: async ({ status }) => this.shipments(status),
        }),
        recordUnanswered: tool({
          description: "Save a service or policy question that has no approved answer and is not an account action. Do not use this for pre-alert, claim, tracking, freight, consolidation, or payment.",
          inputSchema: z.object({ question: z.string().min(4).max(500) }),
          execute: async ({ question }) => {
            if (isAssistantAccountRequest(question)) return { saved: false, reason: "Use an account tool instead." };
            return recordUnanswered(this.db(), this.name, question);
          },
        }),
        openPage: tool({
          description: `Show a button that opens one app screen. Allowed paths: ${assistantPages.map((page) => `${page.path} = ${page.when}`).join("; ")}.`,
          inputSchema: z.object({ path: z.string() }),
          execute: async ({ path }) => {
            const page = assistantPage(path.trim());
            if (!page) return { error: "That screen is not available.", pages: assistantPages.map((item) => item.path) };
            return { path: page.path, title: page.title };
          },
        }),
        listMyAddresses: tool({
          description: "Delivery addresses for consolidation, including the address id to pass into a quote or shipment.",
          inputSchema: z.object({}),
          execute: async () => this.addresses(),
        }),
        estimateFreight: tool({
          description: "Estimate international freight before a shipment exists. Weight is grams. Cargo is GENERAL, BATTERY, MAGNETIC, LIQUID, POWDER, or SENSITIVE.",
          inputSchema: z.object({
            countryCode: z.string(),
            weightGrams: z.number().positive(),
            cargo: z.array(z.enum(CARGO_ATTRIBUTES)).optional(),
          }),
          execute: async (input) => this.estimate(input.countryCode, input.weightGrams, input.cargo ?? ["GENERAL"]),
        }),
        quoteMyPackages: tool({
          description: "Quote compatible routes for this customer's packages and one saved address. Does not create a shipment.",
          inputSchema: z.object({
            packageIds: z.array(z.string()).min(1),
            addressId: z.string(),
          }),
          execute: async ({ packageIds, addressId }) => this.quote(packageIds, addressId),
        }),
        trackShipments: tool({
          description: "Track this customer's own shipments by international tracking number or shipment id. Pass them as one string, one per line.",
          inputSchema: z.object({ query: z.string().min(5).max(2000) }),
          execute: async ({ query }) => this.track(query),
        }),
        prealertPackages: tool({
          description: "Add one package from a domestic tracking number, such as SF123123124. Call this when the customer asks to 预报 or add a package. Confirmation is requested after the call. Infer SF, YTO, ZTO, STO, JD, or EMS from the prefix when courier is omitted.",
          inputSchema: z.object({
            trackingNumber: z.string().min(5).max(40),
            courier: z.string().max(40).optional(),
            productName: z.string().max(120).optional(),
            quantity: z.number().int().positive().max(999).optional(),
          }),
          execute: async (input) => this.hold("prealertPackages", input, `Add package ${input.trackingNumber}`) ?? this.prealert([input]),
        }),
        claimPackage: tool({
          description: "Claim one pending warehouse parcel by its domestic tracking number. Requires customer confirmation.",
          inputSchema: z.object({ trackingNumber: z.string().min(5).max(40) }),
          execute: async ({ trackingNumber }) => this.hold("claimPackage", { trackingNumber }, `Claim ${trackingNumber}`) ?? this.claim(trackingNumber),
        }),
        submitConsolidation: tool({
          description: "Create a consolidation from package public ids, a saved address id, and a route code from quoteMyPackages. Requires customer confirmation. Does not charge freight.",
          inputSchema: z.object({
            packageIds: z.array(z.string()).min(1),
            addressId: z.string(),
            routeCode: z.string(),
            packingInstruction: z.string().max(160).optional(),
          }),
          execute: async (input) => this.hold("submitConsolidation", input, `Consolidate ${input.packageIds.join(", ")}`) ?? this.consolidate(input),
        }),
        cancelConsolidation: tool({
          description: "Cancel a shipment that is still consolidating, by its public id such as SHP-20388. Requires customer confirmation.",
          inputSchema: z.object({ shipmentId: z.string() }),
          execute: async ({ shipmentId }) => this.hold("cancelConsolidation", { shipmentId }, `Cancel ${shipmentId}`) ?? this.cancel(shipmentId),
        }),
    };
  }

  private hold(tool: PendingAction["tool"], input: unknown, summary: string) {
    if (!this.voiceTurn) return null;
    this.setState({ pending: { tool, input, summary } });
    return { awaitingConfirmation: true, summary };
  }

  async confirmVoiceAction() {
    const pending = this.state?.pending;
    if (!pending) return { error: "Nothing to confirm." };
    this.setState({ pending: null });
    const result = await this.dispatchPending(pending);
    const spoken = spokenResult(result, this.voiceLang);
    try {
      await this.speakAll(spoken);
    } catch {
      // No live voice call.
    }
    return result;
  }

  async rejectVoiceAction() {
    this.setState({ pending: null });
    try {
      await this.speakAll(voiceCopy[this.voiceLang].declined);
    } catch {
      // No live voice call.
    }
    return { ok: true };
  }

  private model() {
    return createWorkersAI({ binding: this.bindings().AI })("@cf/zai-org/glm-4.7-flash");
  }

  private systemFor(matches: { question: string; answer: string }[]) {
    const block = matches.length
      ? `Approved answers:\n${matches.map((item) => `Q: ${item.question}\nA: ${item.answer}`).join("\n")}`
      : "Approved answers: none.";
    return `${SYSTEM}\n${block}`;
  }

  private async keepGap(question: string, reply: string) {
    if (!question || isAssistantAccountRequest(question) || !reply.includes(GAP_REPLY)) return;
    await recordUnanswered(this.db(), this.name, question);
  }

  private replyWith(text: string) {
    const stream = createUIMessageStream({
      execute: ({ writer }) => {
        const id = crypto.randomUUID();
        writer.write({ type: "start" });
        writer.write({ type: "start-step" });
        writer.write({ type: "text-start", id });
        writer.write({ type: "text-delta", id, delta: text });
        writer.write({ type: "text-end", id });
        writer.write({ type: "finish-step" });
        writer.write({ type: "finish", finishReason: "stop" });
      },
    });
    return createUIMessageStreamResponse({ stream });
  }

  private say(text: string, abortSignal?: AbortSignal) {
    const result = streamText({
      model: this.model(),
      prompt: `Reply with exactly this sentence and nothing else: ${text}`,
      abortSignal,
    });
    return result.toUIMessageStreamResponse();
  }

  private async dispatchPending(pending: PendingAction) {
    if (pending.tool === "prealertPackages") {
      const input = pending.input as { trackingNumber?: string; items?: { trackingNumber: string; courier?: string; productName?: string; quantity?: number }[]; courier?: string; productName?: string; quantity?: number };
      const items = input.items ?? (input.trackingNumber ? [{ trackingNumber: input.trackingNumber, courier: input.courier, productName: input.productName, quantity: input.quantity }] : []);
      return this.prealert(items);
    }
    if (pending.tool === "claimPackage") return this.claim((pending.input as { trackingNumber: string }).trackingNumber);
    if (pending.tool === "submitConsolidation") return this.consolidate(pending.input as { packageIds: string[]; addressId: string; routeCode: string; packingInstruction?: string });
    return this.cancel((pending.input as { shipmentId: string }).shipmentId);
  }

  private db() {
    return createDb(this.bindings().DB);
  }

  private async account() {
    const rows = await this.db().select().from(user).where(eq(user.id, this.name)).limit(1);
    const account = rows[0];
    if (!account?.memberCode) return null;
    return {
      id: account.id,
      name: account.name,
      email: account.email,
      memberCode: account.memberCode,
      phone: account.phone,
      country: account.country,
    };
  }

  private async snapshot() {
    const account = await this.account();
    if (!account) return { error: "Account not found." };
    const dashboard = await getDashboard(this.db(), account);
    return {
      memberCode: dashboard.warehouse.memberCode,
      warehouse: dashboard.warehouse.street,
      balance: formatFen(dashboard.wallet.balanceFen),
      counts: dashboard.counts,
      attention: dashboard.attention.map((item) => ({ title: item.title, detail: item.body })),
    };
  }

  private async packages(status?: string, query?: string) {
    const page = await listPackages(this.db(), this.name, status || "all", query ?? "", 1, 8);
    return {
      total: page.total,
      packages: page.items.map((item) => ({
        id: item.publicId,
        tracking: item.domesticTrackingNumber,
        status: item.displayStatus.label,
        cargo: item.cargoAttributes,
        weightGrams: item.weightGrams,
        eligible: item.eligible,
        reason: item.ineligibleReason,
      })),
    };
  }

  private async shipments(status?: string) {
    const page = await listShipments(this.db(), this.name, status || "all", "", 1, 8);
    return {
      total: page.total,
      shipments: page.items.map((item) => ({
        id: item.publicId,
        status: item.displayStatus.label,
        amount: formatFen(item.amountFen),
        country: item.destination?.countryCode ?? null,
        route: item.shippingMethod?.routeName ?? null,
        payable: item.status === "TO_PAY",
      })),
    };
  }

  private async run<T>(work: () => Promise<T>) {
    try {
      return await work();
    } catch (error) {
      if (error instanceof AppError) return { error: error.message };
      throw error;
    }
  }

  private async addresses() {
    const rows = await listAddresses(this.db(), this.name);
    return rows.map((item) => ({
      id: item.id,
      name: item.name,
      country: item.countryCode,
      city: item.city,
      line: item.addressLine1,
      default: item.isDefault,
    }));
  }

  private estimate(countryCode: string, weightGrams: number, cargo: (typeof CARGO_ATTRIBUTES)[number][]) {
    return this.run(async () => {
      const result = await calculateRates(this.db(), { countryCode, weightGrams, cargo }, this.bindings().HIOBUY_API_TOKEN);
      return {
        failure: result.failure?.message ?? null,
        routes: result.routes.map((route) => ({
          code: route.routeCode,
          name: route.routeName,
          days: `${route.daysMin}–${route.daysMax}`,
          price: formatFenRange(route.estimatedMinFen, route.estimatedMaxFen),
        })),
      };
    });
  }

  private async quote(packageIds: string[], addressId: string) {
    return this.run(async () => {
      const ids = await this.resolvePackages(packageIds);
      if ("error" in ids) return ids;
      const result = await createShippingQuote(this.db(), this.name, ids, addressId, this.bindings().HIOBUY_API_TOKEN);
      return {
        quoteId: result.quoteId,
        failure: result.failure?.message ?? null,
        address: `${result.address.name}, ${result.address.city}, ${result.address.countryCode}`,
        routes: result.routes.map((route) => ({
          code: route.routeCode,
          name: route.routeName,
          days: `${route.daysMin}–${route.daysMax}`,
          price: formatFenRange(route.estimatedMinFen, route.estimatedMaxFen),
        })),
      };
    });
  }

  private async track(query: string) {
    return this.run(async () => {
      const wanted = normalizeTrackingInput(query);
      const db = this.db();
      const mine = await db
        .select({ id: shipments.id, publicId: shipments.publicId, trackingNumber: shipments.trackingNumber, status: shipments.status })
        .from(shipments)
        .where(eq(shipments.userId, this.name));
      const { carrierTracking } = await import("./fulfillment-sync");
      const results = [];
      for (const number of wanted.numbers.slice(0, 5)) {
        const shipment = mine.find((item) => item.trackingNumber?.toUpperCase() === number || item.publicId.toUpperCase() === number);
        if (!shipment) {
          results.push({ number, found: false });
          continue;
        }
        const track = await carrierTracking(db, this.bindings(), shipment.id, this.name);
        results.push({
          number,
          found: true,
          shipment: shipment.publicId,
          trackingNumber: track.trackingNumber,
          carrier: track.carrier,
          latest: track.events[0] ? `${track.events[0].title} · ${track.events[0].location}` : null,
          leftWarehouse: track.available,
        });
      }
      return { results, invalid: wanted.invalid, note: "Only this customer's own shipments can be tracked." };
    });
  }

  private async prealert(items: { trackingNumber: string; courier?: string; productName?: string; quantity?: number }[]) {
    return this.run(async () => {
      const result = await createPrealerts(
        this.db(),
        this.name,
        items.map((item) => ({
          trackingNumber: item.trackingNumber,
          courier: courierFor(item.trackingNumber, item.courier),
          productName: item.productName,
          quantity: item.quantity,
        })),
      );
      return {
        created: result.created.map((item) => ({ id: item.publicId, tracking: item.domesticTrackingNumber })),
        skipped: result.skipped,
      };
    });
  }

  private async claim(trackingNumber: string) {
    return this.run(async () => {
      const pending = await listClaims(this.db(), this.name);
      const claim = pending.find((item) => item.domesticTrackingNumber.toUpperCase() === trackingNumber.trim().toUpperCase());
      if (!claim) return { error: "No pending claim matches that tracking number." };
      const pkg = await confirmClaim(this.db(), this.name, claim.id);
      return { id: pkg.publicId, tracking: pkg.domesticTrackingNumber, status: pkg.displayStatus.label };
    });
  }

  private async consolidate(input: { packageIds: string[]; addressId: string; routeCode: string; packingInstruction?: string }) {
    return this.run(async () => {
      const ids = await this.resolvePackages(input.packageIds);
      if ("error" in ids) return ids;
      const quote = await createShippingQuote(this.db(), this.name, ids, input.addressId, this.bindings().HIOBUY_API_TOKEN);
      if (quote.failure) return { error: quote.failure.message, detail: quote.failure.detail };
      const shipment = await createShipment(
        this.db(),
        this.name,
        {
          packageIds: ids,
          addressId: input.addressId,
          quoteId: quote.quoteId,
          routeCode: input.routeCode,
          packingInstruction: input.packingInstruction?.trim() || "Remove unnecessary seller packaging",
        },
        crypto.randomUUID(),
        this.bindings().HIOBUY_API_TOKEN,
      );
      const created = publicResult(shipment);
      return { id: created.publicId, status: created.status };
    });
  }

  private async cancel(shipmentId: string) {
    return this.run(async () => {
      const page = await listShipments(this.db(), this.name, "all", shipmentId, 1, 5);
      const match = page.items.find((item) => item.publicId === shipmentId);
      if (!match) return { error: "Shipment not found." };
      const shipment = await cancelShipment(this.db(), this.name, match.id);
      return { id: shipment.publicId, status: shipment.displayStatus.label };
    });
  }

  private async resolvePackages(publicIds: string[]) {
    const page = await listPackages(this.db(), this.name, "all", "", 1, 100);
    const ids = publicIds.map((publicId) => page.items.find((item) => item.publicId === publicId)?.id);
    if (ids.some((id) => !id)) return { error: "One or more packages were not found. Use the public id such as PKG-10301." };
    return ids as string[];
  }
}

function spokenResult(result: unknown, lang: VoiceLang = "en") {
  const copy = voiceCopy[lang];
  if (!result || typeof result !== "object") return copy.done;
  const row = result as { error?: string; id?: string; created?: { id: string }[]; summary?: string };
  if (row.error) return row.error;
  if (row.created?.length) return copy.created(row.created.map((item) => item.id).join(", "));
  if (row.id) return copy.doneWith(row.id);
  return copy.done;
}

function publicResult(value: unknown) {
  const row = value && typeof value === "object" ? value as { publicId?: string; displayStatus?: { label?: string } } : {};
  return { publicId: row.publicId ?? "Created", status: row.displayStatus?.label ?? "Updated" };
}

function courierFor(tracking: string, given?: string) {
  const explicit = given?.trim();
  if (explicit && !/^(courier|unknown|n\/a|none|other)$/i.test(explicit)) return explicit;
  const value = tracking.trim().toUpperCase();
  if (value.startsWith("SF")) return "SF";
  if (value.startsWith("YT")) return "YTO";
  if (value.startsWith("ZTO")) return "ZTO";
  if (value.startsWith("STO")) return "STO";
  if (value.startsWith("JD")) return "JD";
  if (value.startsWith("EMS")) return "EMS";
  return "Other";
}
