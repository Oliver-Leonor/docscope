import { beforeEach, expect, test, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  embeddings: vi.fn(),
  sessionCreate: vi.fn(),
  sessionUpdate: vi.fn(),
  sheetCreate: vi.fn(),
  execute: vi.fn(),
}))

vi.mock("openai", () => ({
  default: class {
    embeddings = { create: mocks.embeddings }
  },
}))
vi.mock("@vercel/blob", () => ({ put: vi.fn(async () => ({ url: "https://example.invalid/synthetic.pdf" })) }))
vi.mock("@/lib/db", () => ({ prisma: {
  session: { create: mocks.sessionCreate, update: mocks.sessionUpdate },
  sheet: { create: mocks.sheetCreate },
  $executeRaw: mocks.execute,
} }))

import { POST } from "@/app/api/upload/route"
import { embedAndStoreChunks } from "@/lib/ai/embeddings"
import { syntheticPdf, uploadRequest } from "./helpers"

// Use only when running this harness against the original source in an
// isolated checkout. This changes test expectations, not application behavior.
const baseline = process.env.DOCSCOPE_PERF_BASELINE === "1"

beforeEach(() => {
  mocks.sessionCreate.mockResolvedValue({ id: "synthetic-session" })
  mocks.sessionUpdate.mockResolvedValue({})
  mocks.sheetCreate.mockImplementation(async ({ data }) => ({ id: `sheet-${data.pageIndex}` }))
  mocks.embeddings.mockImplementation(async ({ input }) => ({
    data: input.map((_: string, index: number) => ({ index, embedding: Array(1536).fill(index + 1) })),
  }))
  mocks.execute.mockResolvedValue(1)
})

test.each([3, 120])("local request counts for a generated %i-page PDF (external services mocked)", async (pages) => {
  const pdf = await syntheticPdf(pages)
  const response = await POST(uploadRequest(pdf))
  expect(response.status).toBe(200)
  expect(mocks.sheetCreate).toHaveBeenCalledTimes(pages)
  expect(mocks.execute).toHaveBeenCalledTimes(pages)
  expect(mocks.embeddings).toHaveBeenCalledTimes(baseline ? pages : Math.ceil(pages / 100))
  expect(mocks.sessionUpdate).toHaveBeenLastCalledWith({
    where: { id: "synthetic-session" }, data: { status: "ready" },
  })
  console.info(JSON.stringify({
    mode: "real PDF extraction; mocked Blob, OpenAI and database",
    pages, pdfBytes: pdf.length,
    embeddingRequests: mocks.embeddings.mock.calls.length,
    chunkInserts: mocks.execute.mock.calls.length,
  }))
})

test("local peak insert concurrency for 100 chunks (database mocked)", async () => {
  let active = 0
  let peak = 0
  mocks.execute.mockImplementation(async () => {
    active++
    peak = Math.max(peak, active)
    await new Promise<void>((resolve) => setImmediate(resolve))
    active--
    return 1
  })
  await embedAndStoreChunks(Array.from({ length: 100 }, (_, i) => ({
    content: `Synthetic chunk ${i}`, sheetId: `sheet-${i}`,
  })))
  console.info(JSON.stringify({ mode: "mocked database", chunks: 100, peakConcurrentInserts: peak }))
  expect(active).toBe(0)
  expect(peak).toBe(baseline ? 100 : 5)
})
