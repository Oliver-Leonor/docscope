import { beforeEach, expect, test, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  identify: vi.fn(), embeddings: vi.fn(), execute: vi.fn(),
  sessionCreate: vi.fn(), sessionUpdate: vi.fn(), sheetCreate: vi.fn(),
}))
vi.mock("openai", () => ({ default: class { embeddings = { create: mocks.embeddings } } }))
vi.mock("@vercel/blob", () => ({ put: vi.fn(async () => ({ url: "https://example.invalid/synthetic.pdf" })) }))
vi.mock("@/lib/pdf/identify-sheets", () => ({ identifyDocumentSections: mocks.identify }))
vi.mock("@/lib/db", () => ({ prisma: {
  session: { create: mocks.sessionCreate, update: mocks.sessionUpdate },
  sheet: { create: mocks.sheetCreate }, $executeRaw: mocks.execute,
} }))

import { POST } from "@/app/api/upload/route"
import * as embeddings from "@/lib/ai/embeddings"
import { deferred, uploadRequest } from "./helpers"

const sections = [
  { pageIndex: 0, sectionLabel: "Page 1", extractedText: "Garden notes. ".repeat(400), extractionMethod: "text" },
  { pageIndex: 1, sectionLabel: "A-201", extractedText: "Blue pots.", extractionMethod: "vision" },
  { pageIndex: 2, sectionLabel: "Page 3", extractedText: "Water weekly.", extractionMethod: "text" },
]

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset()
  vi.spyOn(console, "error").mockImplementation(() => {})
  mocks.identify.mockResolvedValue(sections)
  mocks.sessionCreate.mockResolvedValue({ id: "session-test" })
  mocks.sessionUpdate.mockResolvedValue({})
  mocks.sheetCreate.mockImplementation(async ({ data }) => ({ id: `sheet-${data.pageIndex}` }))
  // Deliberately return vectors out of order to exercise page associations.
  mocks.embeddings.mockImplementation(async ({ input }) => ({
    data: input.map((_: string, index: number) => ({ index, embedding: Array(1536).fill(index + 1) })).reverse(),
  }))
  mocks.execute.mockResolvedValue(1)
})

test("collects chunks once across pages and retains sheet metadata, labels and embedding associations", async () => {
  const embed = vi.spyOn(embeddings, "embedAndStoreChunks")
  const response = await POST(uploadRequest())
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ sessionId: "session-test" })
  expect(mocks.sessionCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ status: "processing" }) })
  expect(embed).toHaveBeenCalledTimes(1)
  expect(mocks.embeddings).toHaveBeenCalledTimes(1)
  for (const section of sections) {
    expect(mocks.sheetCreate).toHaveBeenCalledWith({ data: {
      sessionId: "session-test", sheetNumber: section.sectionLabel,
      pageIndex: section.pageIndex, extractedText: section.extractedText,
      extractionMethod: section.extractionMethod,
    } })
  }
  const collected = embed.mock.calls[0][0]
  expect(collected.length).toBeGreaterThan(sections.length)
  expect(new Set(collected.map((chunk) => chunk.sheetId))).toEqual(new Set(["sheet-0", "sheet-1", "sheet-2"]))
  for (const [i, chunk] of collected.entries()) {
    const [, , sheetId, content, vector] = mocks.execute.mock.calls[i]
    expect({ sheetId, content }).toEqual(chunk)
    const section = sections.find((s) => `sheet-${s.pageIndex}` === sheetId)!
    expect(content).toMatch(new RegExp(`^\\[${section.sectionLabel}\\]`))
    expect(JSON.parse(vector)[0]).toBe(i + 1)
  }
  expect(mocks.sessionUpdate).toHaveBeenLastCalledWith({ where: { id: "session-test" }, data: { status: "ready" } })
})

test("stays processing until every chunk insert has finished", async () => {
  const stored = deferred<number>()
  mocks.execute.mockReturnValue(stored.promise)
  const response = POST(uploadRequest())
  await vi.waitFor(() => expect(mocks.execute).toHaveBeenCalled())
  expect(mocks.sessionUpdate).not.toHaveBeenCalled()
  stored.resolve(1)
  expect((await response).status).toBe(200)
  expect(mocks.sessionUpdate).toHaveBeenLastCalledWith({ where: { id: "session-test" }, data: { status: "ready" } })
})

test.each([
  { empty: [] },
  { empty: [{ ...sections[0], extractedText: " \n\t " }] },
])("marks unreadable extraction as error and skips embeddings: $empty", async ({ empty }) => {
  mocks.identify.mockResolvedValue(empty)
  const response = await POST(uploadRequest())
  expect(response.status).toBe(200)
  expect(mocks.sheetCreate).toHaveBeenCalledTimes(empty.length)
  expect(mocks.embeddings).not.toHaveBeenCalled()
  expect(mocks.execute).not.toHaveBeenCalled()
  expect(mocks.sessionUpdate).toHaveBeenCalledExactlyOnceWith({ where: { id: "session-test" }, data: {
    status: "error", errorMessage: "This PDF appears to be empty or could not be read.",
  } })
})

test("retains empty pages while indexing recovered content in a partially extractable document", async () => {
  mocks.identify.mockResolvedValue([
    { ...sections[0], extractedText: "" }, sections[1],
    { ...sections[2], extractedText: " \n " },
  ])
  const response = await POST(uploadRequest())
  expect(response.status).toBe(200)
  expect(mocks.sheetCreate).toHaveBeenCalledTimes(3)
  expect(mocks.embeddings).toHaveBeenCalledExactlyOnceWith({ model: "text-embedding-3-small", input: ["[A-201] Blue pots."] })
  expect(mocks.execute.mock.calls[0][2]).toBe("sheet-1")
  expect(mocks.sessionUpdate).toHaveBeenLastCalledWith({ where: { id: "session-test" }, data: { status: "ready" } })
})

test.each(["identify", "sheetCreate", "embeddings", "execute"] as const)("marks the session error after %s fails and never ready", async (operation) => {
  mocks[operation].mockRejectedValue(new Error("synthetic failure"))
  const response = await POST(uploadRequest())
  expect(response.status).toBe(500)
  expect(mocks.sessionUpdate).toHaveBeenCalledExactlyOnceWith({ where: { id: "session-test" }, data: {
    status: "error", errorMessage: "synthetic failure",
  } })
  if (operation === "embeddings") expect(mocks.execute).not.toHaveBeenCalled()
})

test("a later embedding batch failure leaves the session error even when earlier chunks were stored", async () => {
  mocks.identify.mockResolvedValue(Array.from({ length: 101 }, (_, pageIndex) => ({
    pageIndex, sectionLabel: `Page ${pageIndex + 1}`, extractedText: "Synthetic notes.", extractionMethod: "text",
  })))
  const validBatch = mocks.embeddings.getMockImplementation()!
  mocks.embeddings.mockImplementationOnce(validBatch).mockRejectedValueOnce(new Error("second batch failed"))
  expect((await POST(uploadRequest())).status).toBe(500)
  expect(mocks.sheetCreate).toHaveBeenCalledTimes(101)
  expect(mocks.execute).toHaveBeenCalledTimes(100)
  expect(mocks.sessionUpdate).toHaveBeenCalledExactlyOnceWith({ where: { id: "session-test" }, data: {
    status: "error", errorMessage: "second batch failed",
  } })
})
