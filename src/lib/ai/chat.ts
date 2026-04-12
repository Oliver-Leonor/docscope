import OpenAI from "openai"
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions"

import { prisma } from "../db"
import { retrieveRelevantChunks } from "./embeddings"
import { withRetry } from "./retry"

const CHAT_MODEL = "gpt-4o-mini"
const HISTORY_WINDOW = 10 // most recent turns included in the prompt
const RETRIEVAL_TOP_K = 5
/**
 * Cosine-similarity floor below which we treat the retrieval context
 * as "doesn't really cover this question" and nudge the model to lean
 * on general electrical-engineering knowledge instead of strictly
 * grounding. Tuned by eye — typical on-topic queries in our test set
 * score 0.35–0.55 against a good matching chunk.
 */
const LOW_RELEVANCE_THRESHOLD = 0.3

let _openai: OpenAI | null = null
function openai(): OpenAI {
  if (!_openai) _openai = new OpenAI()
  return _openai
}

/**
 * Generate a streaming chat response for a session.
 *
 * Two-tier answering strategy:
 *
 *   Tier 1 — project grounding. Run pgvector cosine-similarity
 *     retrieval on the user's question, pack the top-K chunks into
 *     the system prompt, and ask the model to answer from them first.
 *     When the sheets contain the answer, it cites the source sheet
 *     inline (e.g. "According to sheet E-201…").
 *
 *   Tier 2 — general-knowledge fallback. When the sheets don't cover
 *     the question, the model is allowed to supplement with its own
 *     electrical-engineering expertise, as long as it clearly flags
 *     what's from the drawings versus what's general guidance
 *     (code requirements, best practices, terminology).
 *
 * Low-relevance detection: if the best-matching chunk's similarity is
 * below {@link LOW_RELEVANCE_THRESHOLD} (or we got zero hits at all),
 * we still pass the chunks into the prompt but prepend a note telling
 * the model the context is unlikely to be helpful and it should lean
 * on general knowledge. This catches the common case where a user
 * asks a code-requirement or best-practices question that nothing in
 * the drawing set can answer.
 *
 * Completely off-topic questions (non-electrical, non-construction)
 * get a polite redirect — the prompt tells the model to steer back
 * to the project's electrical scope instead of answering.
 *
 * Everything else — history window, user-message persistence,
 * streaming, assistant-message persistence, citation extraction — is
 * unchanged from the prior implementation.
 *
 * Why `gpt-4o-mini` over `gpt-4o`:
 *   - 15× cheaper ($0.15 vs $2.50 / 1M input tokens)
 *   - Fast first-token latency (<2s) for snappy chat UX
 *   - Retrieval grounds most answers, and general-knowledge fallback
 *     doesn't stretch beyond what `gpt-4o-mini` handles well
 *   - At 100 PDFs/day this saves ~$50/day
 */
export async function generateChatResponse(
  sessionId: string,
  userMessage: string,
): Promise<ReadableStream<Uint8Array>> {
  // 1. Recent history (before we insert the new user turn).
  const recent = await prisma.message.findMany({
    where: { sessionId },
    orderBy: { createdAt: "desc" },
    take: HISTORY_WINDOW,
  })
  const chatHistory = recent.reverse()

  // 2. Persist the incoming user message.
  await prisma.message.create({
    data: {
      sessionId,
      role: "user",
      content: userMessage,
      citedSheets: [],
    },
  })

  // 3. Retrieve grounding chunks and judge their relevance.
  const relevantChunks = await retrieveRelevantChunks(
    sessionId,
    userMessage,
    RETRIEVAL_TOP_K,
  )
  const topSimilarity = relevantChunks[0]?.similarity ?? 0
  const isLowRelevance =
    relevantChunks.length === 0 || topSimilarity < LOW_RELEVANCE_THRESHOLD

  const contextBlock =
    relevantChunks.length === 0
      ? "(no indexed electrical content matched this question)"
      : relevantChunks
          .map((c) => `[Source: Sheet ${c.sheetNumber}]\n${c.content}`)
          .join("\n\n---\n\n")

  // Inserted immediately above the sheet content when Tier-1 retrieval
  // came back weak, so the model sees the warning in close proximity
  // to the (likely unhelpful) chunks it's being offered.
  const lowRelevanceNote = isLowRelevance
    ? `NOTE: The extracted sheet content below has low relevance to this question. Use your general electrical engineering expertise to answer, and mention if any sheet content happens to be relevant.

`
    : ""

  // 4. Build the two-tier system prompt.
  const systemPrompt = `You are an expert electrical engineer assistant. You have access to extracted content from electrical construction drawings for this project.

ANSWERING STRATEGY:
1. FIRST, try to answer using the provided electrical sheet content below. Always cite sheets when using this content (e.g., "According to sheet E-201...").
2. If the sheet content doesn't contain enough information to fully answer the question, supplement with your general electrical engineering knowledge. When doing this, clearly distinguish between what comes from the project sheets vs. your general knowledge.
   - For project-specific data (panel sizes, service voltage, conduit specs): cite the sheets.
   - For general knowledge (code requirements, best practices, terminology explanations): you can answer directly but note it's general guidance, not from the project drawings.
3. If the question is completely unrelated to electrical engineering or construction, politely redirect: "I'm specialized in electrical construction scope. Could you ask something about the electrical systems in this project?"

${lowRelevanceNote}ELECTRICAL SHEET CONTENT:
${contextBlock}`

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...chatHistory.map((m) =>
      m.role === "assistant"
        ? ({ role: "assistant", content: m.content } as const)
        : ({ role: "user", content: m.content } as const),
    ),
    { role: "user", content: userMessage },
  ]

  // 5. Kick off the streaming completion.
  const client = openai()
  const completion = await withRetry(() =>
    client.chat.completions.create({
      model: CHAT_MODEL,
      messages,
      stream: true,
      temperature: 0.2, // low temperature for grounded, factual answers
      max_tokens: 1500,
    }),
  )

  const encoder = new TextEncoder()
  let fullResponse = ""

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of completion) {
          const delta = chunk.choices[0]?.delta?.content ?? ""
          if (delta) {
            fullResponse += delta
            controller.enqueue(encoder.encode(delta))
          }
        }

        // 6. Persist the assistant message BEFORE closing the stream.
        // Doing this after `controller.close()` races with serverless
        // function termination and with any client that reconciles
        // history the instant the stream ends (e.g. our Chat component
        // refetches `/messages` immediately on `done`). By awaiting the
        // DB write first, we guarantee the row exists by the time the
        // client observes the stream as complete.
        await prisma.message.create({
          data: {
            sessionId,
            role: "assistant",
            content: fullResponse,
            citedSheets: extractCitedSheets(fullResponse),
          },
        })

        controller.close()
      } catch (error) {
        console.error("[chat] stream error:", error)
        controller.error(error)
      }
    },
  })
}

/**
 * Extract canonical sheet numbers cited in an assistant response.
 *
 * Matches "E-101", "E.101", "E101" — same conventions as
 * `findSheetNumber` in the identify-sheets pipeline — and normalizes
 * every hit to `E-XXX` so downstream citation rendering is consistent.
 * Deduplicates while preserving first-seen order.
 */
export function extractCitedSheets(text: string): string[] {
  if (!text) return []
  const seen = new Set<string>()
  const out: string[] = []
  const pattern = /\bE[-.]?(\d{3,4})\b/gi
  let m: RegExpExecArray | null
  while ((m = pattern.exec(text)) !== null) {
    const canonical = `E-${m[1]}`
    if (!seen.has(canonical)) {
      seen.add(canonical)
      out.push(canonical)
    }
  }
  return out
}
