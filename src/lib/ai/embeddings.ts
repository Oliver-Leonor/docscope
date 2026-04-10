import OpenAI from "openai"
import { v4 as uuidv4 } from "uuid"

import { prisma } from "../db"

const EMBEDDING_MODEL = "text-embedding-3-small"
const EMBEDDING_DIMS = 1536
const BATCH_SIZE = 100

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
 * Uses `text-embedding-3-small` (1536 dims):
 *   - $0.02 / 1M tokens — cheapest OpenAI embedding model
 *   - Solid quality for document-level retrieval
 *   - The API accepts up to 2048 inputs per call; we cap at 100 to stay
 *     well under the 300k token per-request ceiling while keeping round
 *     trips low for typical drawing sets.
 *
 * Prisma 6 can't natively serialize `vector(1536)`, so we insert each row
 * with `$executeRaw` and an explicit `::vector` cast on the stringified
 * embedding. IDs are generated client-side with `uuid` because `$executeRaw`
 * bypasses Prisma's default-value machinery.
 */
export async function embedAndStoreChunks(
  chunks: Array<{ content: string; sheetId: string }>,
): Promise<void> {
  if (chunks.length === 0) return

  const client = openai()

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE)

    const response = await client.embeddings.create({
      model: EMBEDDING_MODEL,
      input: batch.map((c) => c.content),
    })

    if (response.data.length !== batch.length) {
      throw new Error(
        `Embedding count mismatch: sent ${batch.length}, got ${response.data.length}`,
      )
    }

    await Promise.all(
      batch.map(async (chunk, j) => {
        const vec = response.data[j].embedding
        if (vec.length !== EMBEDDING_DIMS) {
          throw new Error(
            `Unexpected embedding length ${vec.length}, expected ${EMBEDDING_DIMS}`,
          )
        }
        const id = uuidv4()
        const vectorLiteral = toVectorLiteral(vec)
        await prisma.$executeRaw`
          INSERT INTO "Chunk" (id, "sheetId", content, embedding, "createdAt")
          VALUES (${id}, ${chunk.sheetId}, ${chunk.content}, ${vectorLiteral}::vector, NOW())
        `
      }),
    )
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

  const embedding = await client.embeddings.create({
    model: EMBEDDING_MODEL,
    input: query,
  })
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
