import OpenAI from "openai"
import { v4 as uuidv4 } from "uuid"

import { prisma } from "../db"
import { withRetry } from "./retry"

const EMBEDDING_MODEL = "text-embedding-3-small"
const EMBEDDING_DIMS = 1536
const BATCH_SIZE = 100
const INSERT_CONCURRENCY = 5

let _openai: OpenAI | null = null
function openai(): OpenAI {
  if (!_openai) _openai = new OpenAI()
  return _openai
}

/**
 * Convert a JS number[] into the literal string form pgvector accepts
 * when used with `::vector` casts in raw SQL (e.g. `"[0.1,0.2,0.3]"`).
 */
function toVectorLiteral(vec: number[]): string {
  return "[" + vec.join(",") + "]"
}

/**
 * Embed a batch of text chunks and persist them to the `Chunk` table.
 *
 * Uses `text-embedding-3-small` and validates 1536-dimensional results.
 * Batches contain at most 100 chunks; this is an input-count limit,
 * not a measured cost/quality optimum or an enforced token budget.
 *
 * Prisma 6 can't natively serialize `vector(1536)`, so we insert each row
 * with `$executeRaw` and an explicit `::vector` cast on the stringified
 * embedding. IDs are generated in server-side code with `uuid` because `$executeRaw`
 * bypasses Prisma's default-value machinery. Insert waves are limited to
 * five writes per invocation so a full embedding batch can't flood the pool.
 */
export async function embedAndStoreChunks(
  chunks: Array<{ content: string; sheetId: string }>,
): Promise<void> {
  if (chunks.length === 0) return

  const client = openai()

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE)

    const response = await withRetry(() =>
      client.embeddings.create({
        model: EMBEDDING_MODEL,
        input: batch.map((c) => c.content),
      }),
    )

    if (response.data.length !== batch.length) {
      throw new Error(
        `Embedding count mismatch: sent ${batch.length}, got ${response.data.length}`,
      )
    }

    // Use the API's input index, rather than response order, to retain the
    // correct page association. Validate the whole batch before any writes.
    const embeddings = [...response.data].sort((a, b) => a.index - b.index)
    for (const [j, result] of embeddings.entries()) {
      if (result.index !== j) {
        throw new Error("Invalid embedding indexes in response")
      }
      if (result.embedding.length !== EMBEDDING_DIMS) {
        throw new Error(
          `Unexpected embedding length ${result.embedding.length}, expected ${EMBEDDING_DIMS}`,
        )
      }
    }

    for (let start = 0; start < batch.length; start += INSERT_CONCURRENCY) {
      const results = await Promise.allSettled(
        batch.slice(start, start + INSERT_CONCURRENCY).map(async (chunk, offset) => {
          const vec = embeddings[start + offset].embedding
          const id = uuidv4()
          const vectorLiteral = toVectorLiteral(vec)
          await prisma.$executeRaw`
            INSERT INTO "Chunk" (id, "sheetId", content, embedding, "createdAt")
            VALUES (${id}, ${chunk.sheetId}, ${chunk.content}, ${vectorLiteral}::vector, NOW())
          `
        }),
      )
      // Drain in-flight writes before reporting failure to the upload route.
      // A failed wave must not start further inserts or embedding batches.
      const failure = results.find((result) => result.status === "rejected")
      if (failure) throw failure.reason
    }
  }
}

/**
 * Retrieve the top-K most relevant chunks for a natural-language query
 * scoped to a single session.
 *
 * Uses pgvector's cosine-distance operator (`<=>`); similarity is
 * reported as `1 - distance` so callers can compare scores directly
 * (higher = more relevant).
 */
export async function retrieveRelevantChunks(
  sessionId: string,
  query: string,
  topK: number = 5,
): Promise<
  Array<{ content: string; sheetNumber: string; similarity: number }>
> {
  const client = openai()

  const embedding = await withRetry(() =>
    client.embeddings.create({
      model: EMBEDDING_MODEL,
      input: query,
    }),
  )
  const vec = embedding.data[0].embedding
  const vectorLiteral = toVectorLiteral(vec)

  const rows = await prisma.$queryRaw<
    Array<{ content: string; sheetNumber: string; similarity: number }>
  >`
    SELECT c.content                                       AS "content",
           s."sheetNumber"                                 AS "sheetNumber",
           1 - (c.embedding <=> ${vectorLiteral}::vector)  AS "similarity"
    FROM   "Chunk" c
    JOIN   "Sheet" s ON s.id = c."sheetId"
    WHERE  s."sessionId" = ${sessionId}
      AND  c.embedding IS NOT NULL
    ORDER  BY c.embedding <=> ${vectorLiteral}::vector
    LIMIT  ${topK}
  `

  return rows.map((r) => ({
    content: r.content,
    sheetNumber: r.sheetNumber,
    similarity: Number(r.similarity),
  }))
}
