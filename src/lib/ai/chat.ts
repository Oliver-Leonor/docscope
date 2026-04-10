import OpenAI from "openai"
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions"

import { prisma } from "../db"
import { retrieveRelevantChunks } from "./embeddings"

const CHAT_MODEL = "gpt-4o-mini"
const HISTORY_WINDOW = 10 // most recent turns included in the prompt
const RETRIEVAL_TOP_K = 5

let _openai: OpenAI | null = null
function openai(): OpenAI {
  if (!_openai) _openai = new OpenAI()
  return _openai
}

/**
 * Generate a streaming chat response grounded in electrical sheet content.
 *
 * RAG flow:
 *   1. Pull recent chat history (last {@link HISTORY_WINDOW} messages)
 *      BEFORE saving the new user message, so we don't have to trim
 *      it back out of the returned window.
 *   2. Persist the user message to `Message`.
 *   3. Retrieve the top-{@link RETRIEVAL_TOP_K} most relevant chunks via
 *      pgvector cosine similarity in {@link retrieveRelevantChunks}.
 *   4. Assemble a system prompt that pins the model to the retrieved
 *      context and enforces sheet citations.
 *   5. Stream the completion from {@link CHAT_MODEL}, forwarding token
 *      chunks to the caller via a `ReadableStream<Uint8Array>`.
 *   6. After the stream closes, parse cited sheets out of the final text
 *      and persist the assistant message.
 *
 * Why `gpt-4o-mini` over `gpt-4o`:
 *   - 15× cheaper ($0.15 vs $2.50 / 1M input tokens)
 *   - Fast first-token latency (<2s) for snappy chat UX
 *   - Retrieval grounds the answer, so the extra reasoning headroom of
 *     `gpt-4o` is rarely worth the cost for this task
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

  // 3. Retrieve grounding chunks.
  const relevantChunks = await retrieveRelevantChunks(
    sessionId,
    userMessage,
    RETRIEVAL_TOP_K,
  )
  const contextBlock =
    relevantChunks.length === 0
      ? "(no indexed electrical content matched this question)"
      : relevantChunks
          .map((c) => `[Source: Sheet ${c.sheetNumber}]\n${c.content}`)
          .join("\n\n---\n\n")

  // 4. Build the OpenAI messages payload.
  const systemPrompt = `You are an expert electrical engineer assistant analyzing construction drawing sets. You answer questions ONLY based on the electrical sheet content provided below.

RULES:
- Always cite which sheet your information comes from using the format "According to sheet E-XXX" or "(Sheet E-XXX)"
- If multiple sheets are relevant, cite all of them
- If the provided content doesn't contain enough information to answer, say "I don't have enough information in the extracted electrical sheets to answer that question."
- Be specific: mention exact panel ratings, wire sizes, conduit types, amperage, voltage, etc. when available
- Keep answers clear and professional — you're talking to a construction professional
- Do not make up information that isn't in the source content

ELECTRICAL SHEET CONTENT:
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
  const completion = await client.chat.completions.create({
    model: CHAT_MODEL,
    messages,
    stream: true,
    temperature: 0.2, // low temperature for grounded, factual answers
    max_tokens: 1500,
  })

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
