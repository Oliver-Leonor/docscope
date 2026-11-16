import { beforeEach, expect, test, vi } from "vitest"

const mocks = vi.hoisted(() => ({ embeddings: vi.fn(), execute: vi.fn(), query: vi.fn() }))
vi.mock("openai", () => ({ default: class { embeddings = { create: mocks.embeddings } } }))
vi.mock("@/lib/db", () => ({ prisma: { $executeRaw: mocks.execute, $queryRaw: mocks.query } }))

import { embedAndStoreChunks, retrieveRelevantChunks } from "@/lib/ai/embeddings"
import { deferred } from "./helpers"

function chunks(count: number) {
  return Array.from({ length: count }, (_, i) => ({ content: `Synthetic ${i}`, sheetId: `sheet-${i}` }))
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset()
  mocks.embeddings.mockImplementation(async ({ input }) => ({
    data: (Array.isArray(input) ? input : [input]).map((_: string, index: number) => ({ index, embedding: Array(1536).fill(index) })),
  }))
  mocks.execute.mockResolvedValue(1)
  mocks.query.mockResolvedValue([])
})

test("empty chunks cause no external calls", async () => {
  await embedAndStoreChunks([])
  expect(mocks.embeddings).not.toHaveBeenCalled()
  expect(mocks.execute).not.toHaveBeenCalled()
})

test("uses embedding batches of 100 across different sheets", async () => {
  await embedAndStoreChunks(chunks(205))
  expect(mocks.embeddings.mock.calls.map(([arg]) => arg.input.length)).toEqual([100, 100, 5])
  expect(mocks.execute).toHaveBeenCalledTimes(205)
  expect(mocks.execute.mock.calls.map((call) => call[2])).toEqual(chunks(205).map((chunk) => chunk.sheetId))
})

test.each([
  { name: "count", data: [] },
  { name: "dimension", data: [{ index: 0, embedding: [1] }] },
  { name: "index", data: [{ index: 1, embedding: Array(1536).fill(0) }] },
])("rejects an invalid $name before starting writes", async ({ data }) => {
  mocks.embeddings.mockResolvedValue({ data })
  await expect(embedAndStoreChunks(chunks(1))).rejects.toThrow()
  expect(mocks.execute).not.toHaveBeenCalled()
})

test("validates even the last embedding before inserting any rows", async () => {
  mocks.embeddings.mockResolvedValue({ data: [
    { index: 0, embedding: Array(1536).fill(0) }, { index: 1, embedding: [1] },
  ] })
  await expect(embedAndStoreChunks(chunks(2))).rejects.toThrow("Unexpected embedding length")
  expect(mocks.execute).not.toHaveBeenCalled()
})

test("API failure in a later batch stops ingestion", async () => {
  mocks.embeddings.mockResolvedValueOnce({ data: Array.from({ length: 100 }, (_, index) => ({
    index, embedding: Array(1536).fill(0),
  })) }).mockRejectedValueOnce(new Error("synthetic API failure"))
  await expect(embedAndStoreChunks(chunks(205))).rejects.toThrow("synthetic API failure")
  expect(mocks.execute).toHaveBeenCalledTimes(100)
  expect(mocks.embeddings).toHaveBeenCalledTimes(2)
})

test("retries a rate-limited batch without duplicating inserts", async () => {
  vi.useFakeTimers()
  vi.spyOn(console, "warn").mockImplementation(() => {})
  try {
    mocks.embeddings.mockRejectedValueOnce(Object.assign(new Error("synthetic rate limit"), { status: 429 }))
    const stored = embedAndStoreChunks(chunks(1))
    await vi.advanceTimersByTimeAsync(2000)
    await stored
    expect(mocks.embeddings).toHaveBeenCalledTimes(2)
    expect(mocks.execute).toHaveBeenCalledTimes(1)
  } finally {
    vi.useRealTimers()
  }
})

test("limits inserts to five and drains a failed wave before rejecting, without starting more batches", async () => {
  const gates = Array.from({ length: 5 }, () => deferred<number>())
  mocks.execute.mockImplementation(() => gates[mocks.execute.mock.calls.length - 1].promise)
  let settled = false
  const outcome = embedAndStoreChunks(chunks(101)).catch((error: Error) => { settled = true; return error })
  await vi.waitFor(() => expect(mocks.execute).toHaveBeenCalledTimes(5))
  gates[0].reject(new Error("synthetic insert failure"))
  await new Promise<void>((resolve) => setImmediate(resolve))
  expect(settled).toBe(false)
  gates.slice(1).forEach((gate) => gate.resolve(1))
  expect(await outcome).toMatchObject({ message: "synthetic insert failure" })
  expect(mocks.execute).toHaveBeenCalledTimes(5)
  expect(mocks.embeddings).toHaveBeenCalledTimes(1)
})

test("retrieval embeds the query and parameterizes the session filter and source join", async () => {
  mocks.query.mockResolvedValue([{ content: "[Page 3] Synthetic", sheetNumber: "Page 3", similarity: "0.9" }])
  const result = await retrieveRelevantChunks("session-only", "Synthetic question", 5)
  expect(mocks.embeddings).toHaveBeenCalledExactlyOnceWith({ model: "text-embedding-3-small", input: "Synthetic question" })
  const [sql, , sessionId, , limit] = mocks.query.mock.calls[0]
  expect(sql.join("")).toContain('JOIN   "Sheet" s ON s.id = c."sheetId"')
  expect(sql.join("")).toContain('WHERE  s."sessionId" = ')
  expect(sessionId).toBe("session-only")
  expect(limit).toBe(5)
  expect(result).toEqual([{ content: "[Page 3] Synthetic", sheetNumber: "Page 3", similarity: 0.9 }])
})
