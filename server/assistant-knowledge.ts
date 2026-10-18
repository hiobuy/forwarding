import { and, desc, eq } from "drizzle-orm";
import { normalizeAssistantQuestion, selectAssistantAnswers } from "../src/domain/assistant-knowledge";
import type { Database } from "./db/client";
import { assistantKnowledge, assistantUnanswered } from "./db/schema";

const OPEN = "open";
const PUBLISHED = "published";
const RESOLVED = "resolved";

async function publishedCards(db: Database) {
  return db.select().from(assistantKnowledge).where(eq(assistantKnowledge.status, PUBLISHED));
}

export async function lookupAssistantAnswers(db: Database, query: string) {
  const selected = selectAssistantAnswers(query, await publishedCards(db));
  const present = (card: { id: string; question: string; answer: string }) => ({ id: card.id, question: card.question, answer: card.answer });
  return { matches: selected.matches.map(present), leading: selected.leading ? present(selected.leading) : null };
}

export async function recordUnanswered(db: Database, userId: string, question: string) {
  const questionText = question.trim().slice(0, 500);
  const normalized = normalizeAssistantQuestion(questionText);
  if (normalized.length < 4) return { saved: false as const, reason: "too_short" };
  const existing = await db
    .select()
    .from(assistantUnanswered)
    .where(and(eq(assistantUnanswered.userId, userId), eq(assistantUnanswered.normalized, normalized), eq(assistantUnanswered.status, OPEN)))
    .limit(1);
  if (existing[0]) return { saved: true as const, id: existing[0].id, alreadyOpen: true };
  const id = crypto.randomUUID();
  await db.insert(assistantUnanswered).values({
    id,
    userId,
    question: questionText,
    normalized,
    status: OPEN,
    createdAt: Date.now(),
  });
  return { saved: true as const, id, alreadyOpen: false };
}

export async function listOpenAssistantQuestions(db: Database, limit = 100) {
  return db.select().from(assistantUnanswered).where(eq(assistantUnanswered.status, OPEN)).orderBy(desc(assistantUnanswered.createdAt)).limit(limit);
}

export async function publishAssistantAnswer(
  db: Database,
  input: { question: string; answer: string; keywords?: string; unansweredId?: string },
) {
  const question = input.question.trim();
  const answer = input.answer.trim();
  if (question.length < 2 || answer.length < 2) return { id: null, error: "empty" as const };
  const now = Date.now();
  const id = crypto.randomUUID();
  await db.insert(assistantKnowledge).values({
    id,
    question,
    answer,
    keywords: input.keywords?.trim() ?? "",
    status: PUBLISHED,
    createdAt: now,
    updatedAt: now,
  });
  if (input.unansweredId) {
    await db.update(assistantUnanswered).set({ status: RESOLVED, knowledgeId: id }).where(eq(assistantUnanswered.id, input.unansweredId));
  }
  return { id };
}
