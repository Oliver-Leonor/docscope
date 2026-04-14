import OpenAI from "openai"
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions"

import { prisma } from "../db"
import { retrieveRelevantChunks } from "./embeddings"
import { withRetry } from "./retry"

const CHAT_MODEL = "gpt-4o-mini"
const HISTORY_WINDOW = 10 // most recent turns included in the prompt
const RETRIEVAL_TOP_K = 5

let _openai: OpenAI | null = null
function openai(): OpenAI {
  if (!_openai) _openai = new OpenAI()
  return _openai
}

/**
 * Generate a streaming chat response for a session.
 *
 * Answering strategy:
 *
 *   1. Run pgvector cosine-similarity retrieval on the user's question,
 *      pack the top-K chunks into the system prompt, and ask the model
 *      to answer from them first, citing the source page or section
 *      inline (e.g. "According to Page 5..." or "According to A-201...").
 *
 *   2. If the retrieved chunks don't fully cover the question, the
 *      model is allowed to supplement with general knowledge — but
 *      must make clear what came from the document versus what is
 *      general background.
 *
 *   3. Questions completely unrelated to the document's subject get a
 *      polite redirect.
 *
 * Everything else — history window, user-message persistence,
 * streaming, assistant-message persistence, citation extraction — is
 * unchanged from the prior implementation.
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

  // 3. Retrieve grounding chunks.
  const relevantChunks = await retrieveRelevantChunks(
    sessionId,
    userMessage,
    RETRIEVAL_TOP_K,
  )

  const contextBlock =
    relevantChunks.length === 0
      ? "(no indexed document content matched this question)"
      : relevantChunks
          .map((c) => `[Source: ${c.sheetNumber}]\n${c.content}`)
          .join("\n\n---\n\n")

  const systemPrompt = `You are an expert document analyst assistant. You have access to extracted content from a PDF document uploaded by the user.

ANSWERING STRATEGY:
1. FIRST, try to answer using the provided document content below. Always cite which page or section your information comes from (e.g., "According to Page 5..." or "According to section A-201...").
2. If the document content doesn't fully answer the question, supplement with your general knowledge. Clearly distinguish between what comes from the document vs. your general knowledge.
3. If the question is completely unrelated to the document's subject matter, politely note that and offer to help with document-related questions.

RULES:
- Always cite the source page/section when using document content
- Be specific — reference exact data, numbers, names, and details from the document
- Keep answers clear, professional, and well-structured
- Do not make up information that isn't in the source content

DOCUMENT CONTENT:
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

  // 4. Kick off the streaming completion.
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

        // 5. Persist the assistant message BEFORE closing the stream.
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
            citedSheets: extractCitedSources(fullResponse),
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
 * Matches generic source citations an assistant response may use:
 *   - "Page 5", "Page 12"
 *   - Construction-style section labels: "A-201", "E-101", "S-202", …
 *
 * The list is normalized (canonical form, deduped, first-seen order)
 * so downstream citation rendering can show a clean chip row.
 */
const CITATION_PATTERN = /\b(?:Page\s+(\d+)|([ASMPECL])[-.]?(\d{1,4}))\b/gi

export function extractCitedSources(text: string): string[] {
  if (!text) return []
  const seen = new Set<string>()
  const out: string[] = []
  const re = new RegExp(CITATION_PATTERN.source, "gi")
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    let canonical: string
    if (m[1]) {
      canonical = `Page ${m[1]}`
    } else {
      canonical = `${m[2].toUpperCase()}-${m[3]}`
    }
    if (!seen.has(canonical)) {
      seen.add(canonical)
      out.push(canonical)
    }
  }
  return out
}

/** Back-compat re-export — older call sites may still import this name. */
export const extractCitedSheets = extractCitedSources
