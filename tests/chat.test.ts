import { NextRequest } from "next/server"
import { beforeEach, expect, test, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  session: vi.fn(), history: vi.fn(), save: vi.fn(),
  embeddings: vi.fn(), query: vi.fn(), completion: vi.fn(),
}))
vi.mock("openai", () => ({ default: class {
  embeddings = { create: mocks.embeddings }
  chat = { completions: { create: mocks.completion } }
} }))
vi.mock("@/lib/db", () => ({ prisma: {
  session: { findUnique: mocks.session },
  message: { findMany: mocks.history, create: mocks.save },
  $queryRaw: mocks.query,
} }))

import { POST } from "@/app/api/session/[id]/chat/route"
import { extractCitedSources } from "@/lib/ai/chat"
import { deferred } from "./helpers"

const token = (content: string) => ({ choices: [{ delta: { content } }] })
function request(message: unknown = "  Synthetic question  ") {
  return POST(new NextRequest("http://localhost/api/session/session-test/chat", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  }), { params: Promise.resolve({ id: "session-test" }) })
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset()
  vi.spyOn(console, "error").mockImplementation(() => {})
  mocks.session.mockResolvedValue({ id: "session-test", status: "ready" })
  mocks.history.mockResolvedValue([
    { role: "assistant", content: "Older answer" },
    { role: "user", content: "Older question" },
  ])
  mocks.save.mockResolvedValue({})
  mocks.embeddings.mockResolvedValue({ data: [{ index: 0, embedding: Array(1536).fill(0) }] })
  mocks.query.mockResolvedValue([{ content: "Blue pots.", sheetNumber: "Page 3", similarity: 0.9 }])
  mocks.completion.mockImplementation(async () => (async function* () {
    yield token("According to Page ")
    yield token("3, blue pots. A-201.")
  })())
})

test("keeps the text stream, model settings, chronological prompt, citations and persistent messages", async () => {
  const response = await request()
  expect(response.status).toBe(200)
  expect(response.headers.get("Content-Type")).toBe("text/plain; charset=utf-8")
  expect(response.headers.get("Cache-Control")).toBe("no-cache, no-transform")
  expect(response.headers.get("X-Accel-Buffering")).toBe("no")
  expect(await response.text()).toBe("According to Page 3, blue pots. A-201.")
  expect(mocks.history).toHaveBeenCalledExactlyOnceWith({ where: { sessionId: "session-test" }, orderBy: { createdAt: "desc" }, take: 10 })
  const config = mocks.completion.mock.calls[0][0]
  expect(config).toMatchObject({ model: "gpt-4o-mini", stream: true, temperature: 0.2, max_tokens: 1500 })
  expect(config.messages).toEqual([
    { role: "system", content: expect.stringContaining("[Source: Page 3]\nBlue pots.") },
    { role: "user", content: "Older question" },
    { role: "assistant", content: "Older answer" },
    { role: "user", content: "Synthetic question" },
  ])
  expect(mocks.save.mock.calls).toEqual([
    [{ data: { sessionId: "session-test", role: "user", content: "Synthetic question", citedSheets: [] } }],
    [{ data: { sessionId: "session-test", role: "assistant", content: "According to Page 3, blue pots. A-201.", citedSheets: ["Page 3", "A-201"] } }],
  ])
})

test("overlaps query embedding/search with history then user persistence, and waits for both before LLM initialization", async () => {
  const history = deferred<Array<{ role: string; content: string }>>()
  const saved = deferred<object>()
  const search = deferred<Array<{ content: string; sheetNumber: string; similarity: number }>>()
  mocks.history.mockReturnValue(history.promise)
  mocks.save.mockReturnValueOnce(saved.promise)
  mocks.query.mockReturnValue(search.promise)
  const response = request()
  await vi.waitFor(() => expect(mocks.query).toHaveBeenCalled())
  expect(mocks.history).toHaveBeenCalled()
  expect(mocks.embeddings).toHaveBeenCalledExactlyOnceWith({ model: "text-embedding-3-small", input: "Synthetic question" })
  expect(mocks.save).not.toHaveBeenCalled()
  expect(mocks.completion).not.toHaveBeenCalled()
  history.resolve([])
  await vi.waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1))
  expect(mocks.completion).not.toHaveBeenCalled()
  search.resolve([])
  await new Promise<void>((resolve) => setImmediate(resolve))
  expect(mocks.completion).not.toHaveBeenCalled()
  saved.resolve({})
  expect(await (await response).text()).toContain("According to Page 3")
  expect(mocks.completion).toHaveBeenCalledTimes(1)
})

test("delivers the first token before generation finishes and waits for assistant persistence before ending the stream", async () => {
  const remainingTokens = deferred()
  const persisted = deferred<object>()
  mocks.save.mockResolvedValueOnce({}).mockReturnValueOnce(persisted.promise)
  mocks.completion.mockImplementation(async () => (async function* () {
    yield { choices: [{ delta: {} }] }
    yield token("According to Page ")
    await remainingTokens.promise
    yield token("3, blue pots.")
  })())
  const response = await request()
  const reader = response.body!.getReader()
  const first = await reader.read()
  expect(new TextDecoder().decode(first.value)).toBe("According to Page ")
  expect(first.done).toBe(false)
  expect(mocks.save).toHaveBeenCalledTimes(1)
  remainingTokens.resolve()
  expect(new TextDecoder().decode((await reader.read()).value)).toBe("3, blue pots.")
  await vi.waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2))
  let closed = false
  const done = reader.read().then((value) => { closed = true; return value })
  await new Promise<void>((resolve) => setImmediate(resolve))
  expect(closed).toBe(false)
  persisted.resolve({})
  expect((await done).done).toBe(true)
})

test("settles user persistence before reporting a parallel retrieval failure", async () => {
  const persisted = deferred<object>()
  mocks.save.mockReturnValueOnce(persisted.promise)
  mocks.embeddings.mockRejectedValueOnce(new Error("synthetic retrieval failure"))
  let settled = false
  const response = request().then((value) => { settled = true; return value })
  await vi.waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1))
  expect(settled).toBe(false)
  persisted.resolve({})
  expect((await response).status).toBe(500)
  expect(mocks.completion).not.toHaveBeenCalled()
  expect(mocks.save).toHaveBeenCalledTimes(1)
})

test.each(["history", "save", "completion"] as const)("reports %s failure before streaming", async (operation) => {
  mocks[operation].mockRejectedValueOnce(new Error("synthetic failure"))
  const response = await request()
  expect(response.status).toBe(500)
  expect(await response.json()).toEqual({ error: "synthetic failure" })
  if (operation === "history") expect(mocks.save).not.toHaveBeenCalled()
})

test("stream failure errors the body without persisting a complete assistant answer", async () => {
  const fail = deferred()
  mocks.completion.mockImplementation(async () => (async function* () {
    yield token("Partial answer")
    await fail.promise
    throw new Error("synthetic stream failure")
  })())
  const reader = (await request()).body!.getReader()
  expect(new TextDecoder().decode((await reader.read()).value)).toBe("Partial answer")
  fail.resolve()
  await expect(reader.read()).rejects.toThrow("synthetic stream failure")
  expect(mocks.save).toHaveBeenCalledTimes(1)
})

test("assistant persistence failure errors the stream instead of reporting successful completion", async () => {
  const persistence = deferred<object>()
  mocks.save.mockResolvedValueOnce({}).mockReturnValueOnce(persistence.promise)
  const reader = (await request()).body!.getReader()
  await reader.read()
  await reader.read()
  const done = reader.read()
  persistence.reject(new Error("synthetic persistence failure"))
  await expect(done).rejects.toThrow("synthetic persistence failure")
})

test.each([
  { session: null, status: 404 },
  { session: { id: "session-test", status: "processing" }, status: 400 },
  { session: { id: "session-test", status: "error" }, status: 400 },
])("validates session before starting retrieval ($status, $session)", async ({ session, status }) => {
  mocks.session.mockResolvedValue(session)
  expect((await request()).status).toBe(status)
  expect(mocks.history).not.toHaveBeenCalled()
  expect(mocks.embeddings).not.toHaveBeenCalled()
})

test.each(["  ", null, 42])("rejects invalid messages before starting AI work: %j", async (message) => {
  expect((await request(message)).status).toBe(400)
  expect(mocks.history).not.toHaveBeenCalled()
  expect(mocks.embeddings).not.toHaveBeenCalled()
})

test("normalizes and deduplicates page and section citations", () => {
  expect(extractCitedSources("Page 3, page 3, A.201 and A-201; E101")).toEqual(["Page 3", "A-201", "E-101"])
})
