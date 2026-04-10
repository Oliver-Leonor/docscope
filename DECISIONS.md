# Decisions

A running log of the non-obvious choices I made while building PunchZero, organized by area. For each decision: **what I chose**, **why**, **what I considered instead**, and **the limitations I'm accepting**.

---

## Framework & Architecture

### I chose Next.js App Router over Pages Router

**What I chose.** Next.js 16 App Router, with server components by default and `"use client"` only where I need interactivity.

**Why.** Server components let the expensive work (Prisma queries, server-side rendering of the session list, Tailwind tokenization) happen on the server with zero client-bundle cost. Streaming route handlers are a first-class primitive, which matters a lot for the chat endpoint — I return a `ReadableStream<Uint8Array>` directly from the OpenAI stream and let Next.js pipe it to the browser with no extra framework. The App Router's file-system conventions (`loading.tsx`, `error.tsx`, nested layouts) gave me skeleton and error-boundary handling for free.

**What I considered.** Pages Router — more familiar, bigger ecosystem of examples. Ruled out because (a) its API routes don't have the same streaming ergonomics, (b) it would prevent me from using server components for the session list and home page, and (c) Pages is effectively in maintenance mode now.

**Limitations.** The learning curve for server/client boundaries is real — I spent some time working out that the session detail page needed to be a *client* component so it could poll the status API without a full re-request. In Next.js 16, `params` is a `Promise` that has to be awaited in route handlers and page components, which trips up anyone expecting the Next.js 14 API. The docs in `node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md` flag this as a breaking change.

### I chose a monolith over separate services

**What I chose.** Single Next.js app with frontend, API routes, and background-ish processing all in one repo and one deploy target.

**Why.** At this scope (a takehome + a future single-tenant tool) a monolith is strictly faster to build, easier to reason about, and cheaper to operate. One deploy, one set of env vars, one codebase, no cross-service auth, no extra network hops. TypeScript types flow end-to-end: the `CoverPageSheet` interface used by the UI is the same shape the API returns, so a refactor in one place forces a typecheck failure in the other.

**What I considered.** Splitting the PDF ingest into a standalone Node worker on Railway or Fly, keeping Next.js purely as the frontend. That would solve the 60-second function timeout for huge PDFs and decouple deploys. Ruled out because the complexity wasn't justified at this stage — I can add a worker later without changing the frontend (see "Synchronous processing" below, and #5 in the README).

**Limitations.** The upload route owns the whole ingest pipeline inline, which is the single biggest bottleneck under load.

### I chose synchronous PDF processing over a job queue

**What I chose.** `POST /api/upload` does blob upload → text extraction → sheet identification (with vision fallback) → chunking → embedding → DB writes all inline before returning. The client gets `{ sessionId }` back once everything is persisted.

**Why.** Simpler. The alternative is a queue (Inngest / BullMQ / Trigger.dev) + a worker + a webhook/polling layer — that's three more moving parts, none of which are needed for the takehome's sample PDFs (dozens of pages, native text). The client-side polling on the session page is already set up (status API refetches every 2s and animates new sheets as they land), so *the UI is ready* for an async backend whenever I want to make the switch; I just didn't need to pay the complexity cost today.

**What I considered.** Inngest (easiest to wire into Next.js, durable, free tier). Trigger.dev. A dedicated Node worker behind BullMQ + Upstash Redis. All of these are superior at scale; all of them are overkill right now.

**Limitations.** 60-second Vercel Hobby function timeout caps me at roughly a 50-page PDF with a handful of vision calls. Vercel Pro's 300s helps but isn't a real solution. See README §5.

---

## Database

### I chose Neon over Supabase / PlanetScale / RDS

**What I chose.** Neon serverless Postgres, pooled connection, `vector` extension enabled via Prisma's `extensions = [vector]` schema directive.

**Why.** (a) `pgvector` is available on Neon's free tier with zero setup. (b) Neon's pooler is the right default for Next.js serverless — every route handler is a short-lived connection, and the pooler handles the connection churn cleanly. (c) It's Postgres, so I get the full ecosystem: Prisma, raw SQL for the vector operations, `onDelete: Cascade` on foreign keys, `String[]` columns for `citedSheets`. (d) Branching is a nice bonus for future preview deploys.

**What I considered.** Supabase — also has `pgvector`, but I wasn't using their auth or storage so the bundled features didn't pay for themselves. PlanetScale — no native vector support. RDS — too heavy, no serverless story. A dedicated vector DB (Pinecone, Weaviate) — see the next decision.

**Limitations.** Neon's cold-start on free tier can add ~1s to the first query after idle. Fine for a demo, worth knowing in prod.

### I chose pgvector over Pinecone / Weaviate / Qdrant

**What I chose.** Vectors live in a `vector(1536)` column on the same `Chunk` table that holds the text content. One database, one transaction boundary, one source of truth.

**Why.** Operational simplicity is the killer feature. Cascade deletes just work: `DELETE FROM Session` → Prisma cascades to Sheet → Chunk (with its embedding column) in a single transaction. No "the vector store still has orphan records from the deleted session" bug class to worry about. Backups cover everything. Querying is cheap joins: my `retrieveRelevantChunks` joins Chunk to Sheet to get `sheetNumber` in a single round-trip.

At this scale (thousands of chunks, not millions) pgvector's sequential scan is fast enough. I can bolt on an `hnsw` index later without moving any data:

```sql
CREATE INDEX ON "Chunk" USING hnsw (embedding vector_cosine_ops);
```

**What I considered.** Pinecone — much better at millions-of-vectors scale, but adds a second database with its own auth, its own billing, its own consistency story. Weaviate / Qdrant — self-hosted versions add infra; managed versions share the same cross-store complexity. Not worth it for the takehome.

**Limitations.** Without an index, query time scales linearly with chunk count. At this scale (hundreds to thousands of chunks per session) I've measured query latencies under 200ms, including the embedding round-trip. At millions of chunks I'd need the index, and at hundreds of millions I'd reconsider the dedicated-vector-DB question.

### I chose Prisma + raw SQL for vectors over pure raw SQL

**What I chose.** Prisma owns the schema and generates the client. All relational operations go through the Prisma client. Vector operations use `prisma.$executeRaw` and `prisma.$queryRaw` with explicit `::vector` casts.

**Why.** Prisma does the boring stuff (migrations via `db push`, typed client, cascade declarations, `String[]` JSON serialization) exceptionally well. Where it falls short — it can't represent `vector(1536)` in its type system — I drop to parameterized raw SQL, which is no worse than writing any other hand-tuned SQL. The Prisma schema still documents the column via `Unsupported("vector(1536)")`, which is enough to keep `db push` behaving.

The raw-SQL path is small and self-contained — it lives entirely in `src/lib/ai/embeddings.ts`:

```ts
const vectorLiteral = "[" + vec.join(",") + "]"
await prisma.$executeRaw`
  INSERT INTO "Chunk" (id, "sheetId", content, embedding, "createdAt")
  VALUES (${id}, ${chunk.sheetId}, ${chunk.content}, ${vectorLiteral}::vector, NOW())
`
```

**What I considered.** Writing everything in `pg` or `postgres.js` directly. Would give tighter control but sacrifice the typed client, the migrations, and the cascade semantics, in exchange for nothing I actually need. I considered Drizzle too — its raw SQL story is better, but the Prisma ecosystem was faster to set up at the start.

**Limitations.** My vector inserts bypass Prisma's default-value machinery, so I have to generate UUIDs client-side with the `uuid` package. The `Chunk.id` column still has a DB default, but Prisma's raw SQL doesn't invoke it. Not a real problem, just a line of boilerplate I'm aware of.

---

## PDF Processing

### I chose two-pass sheet identification over vision-only

**What I chose.** Pass 1 is pdfjs text extraction + regex scan. Pass 2 is gpt-4o-mini vision on pages that had less than 100 characters of extracted text.

**Why.** Cost. Most real construction PDFs have a native text layer on most pages — the text-first pass catches them for free. Vision-only would burn ~$0.01 per page × 100 pages = ~$1.00 per PDF, and most of those calls would be redundant. The heuristic is a ~5–10× cost reduction on realistic inputs. See README §4.

The regex itself is tiered for specificity: `E-101` (dashed) is the most common format, `E.101` (dotted) shows up in some older sets, and `E101` (no separator) is common in title blocks. All three normalize to canonical `E-XXX` so downstream code never needs to know which form appeared.

**What I considered.** Vision-only — most reliable but eye-wateringly expensive. Template matching via OpenCV against known title-block layouts — brittle and doesn't handle the huge variation in real drawing templates. A smaller open-source OCR model (Tesseract) — added a native dependency and gave worse results than gpt-4o-mini vision on the scanned pages I tested.

**Limitations.** The 100-character threshold is a judgment call. A sheet with just a few title-block labels in the native text layer but a scanned drawing body would incorrectly skip vision. In practice this is rare because title blocks on real drawings almost always have at least 200–500 chars of standard metadata (title, scale, date, project number, etc.) — but I'd want to validate this threshold against more real-world samples before relying on it.

### I chose `pdf-parse` v2 over raw pdf.js / pdfium

**What I chose.** `pdf-parse` v2 (version 2.4.5, which is a complete rewrite from v1). It's a thin Node-first wrapper around `pdfjs-dist` that exposes both `getText()` and `getScreenshot()` on a single `PDFParse` class.

**Why.** One library does both the text extraction and the page rasterization I need for the vision fallback. Its `getText()` returns per-page text with 1-indexed `num` (which I convert to 0-indexed `pageIndex` to match my schema), and `getScreenshot({ partial, desiredWidth })` gives me a PNG buffer ready to base64 for the OpenAI vision call. No need for a separate rasterization library.

**What I considered.**

- **`pdf-parse` v1** — unmaintained, has a long-standing `index.js` bug that runs debug code at import time, and has no native screenshot support.
- **`pdf-img-convert`** — wraps pdfjs-dist but pins an old version of `canvas` that fails to build on Node 25 / macOS Darwin 25. I tried to install it and the nested `canvas` native build blew up. Had to rip it out.
- **`pdf2pic`** — depends on GraphicsMagick / ImageMagick, doesn't work on Vercel.
- **Raw `pdfjs-dist` with `@napi-rs/canvas`** — works, but is 100+ lines of setup code for what `pdf-parse` v2 gives me in 5.

**Limitations.** `pdf-parse` v2 depends on `pdfjs-dist` 5.x which requires `@napi-rs/canvas` (installed separately) for Node rendering. I had to add `pdf-parse`, `pdfjs-dist`, `@napi-rs/canvas`, `canvas`, `sharp`, and `pdf-lib` to `serverExternalPackages` in `next.config.ts` so Turbopack doesn't try to bundle their native / wasm deps into the server chunks.

### I chose a character-count threshold for vision fallback

**What I chose.** `text.length < 100` is the trigger for Pass 2 vision.

**Why.** It's dead simple and runs locally with no extra API calls. Pages that render with only a handful of characters are overwhelmingly either blank, cover pages, or scanned rasters where pdfjs couldn't recover glyphs. Those are exactly the cases where vision is worth the cost.

**What I considered.** Looking at the ratio of text area to page area (pdfjs exposes text item positions), checking whether the page has embedded images, or training a classifier on real drawing data. All of these are more accurate; none of them were needed to beat the baseline by a wide margin.

**Limitations.** It will incorrectly skip vision on scanned pages that happen to have a small embedded text layer (e.g., a CAD export where only the border template has text). The fallout is tolerable — the sheet just doesn't make it into the electrical set, so the user sees it missing from the cover page and can re-upload.

---

## AI / LLM

### I chose `gpt-4o-mini` over `gpt-4o` / Claude

**What I chose.** `gpt-4o-mini` for both the chat completions and the vision fallback. `text-embedding-3-small` for the embedding model.

**Why.** For retrieval-grounded answers, the model's job is to read context and paraphrase accurately — it doesn't need the headroom `gpt-4o` gives you for long chains of reasoning. `gpt-4o-mini` is ~15× cheaper on both input and output tokens, ~2× faster on first-token latency, and indistinguishable for this workload. I verified this on my end-to-end test: a query for "main electrical service and EV chargers" returned a fully correct answer citing both E-001 and E-101, streamed in ~3.9 seconds total.

For vision, `gpt-4o-mini` handles construction title blocks well in my spot checks. It reads the sheet number correctly and follows the "return JSON" instruction reliably when I set `response_format: { type: "json_object" }`.

**What I considered.** `gpt-4o` — ~15× more expensive with no perceptible quality difference for grounded answers. Claude Sonnet — comparable quality, not integrated with the `openai` SDK I'm already using for embeddings, so I'd be juggling two SDKs. Claude Haiku — similar tradeoff.

**Limitations.** For questions that require cross-sheet synthesis ("compare the service sizes on these three buildings") a more capable model would probably do better. I'd consider a two-model setup eventually: `gpt-4o-mini` for simple grounded answers, `gpt-4o` or Claude Opus for flagged multi-hop questions.

### I chose `text-embedding-3-small` over `ada-002`

**What I chose.** `text-embedding-3-small`, 1536 dimensions (same as ada-002, so no schema change when I upgrade later).

**Why.** It's the current cheapest OpenAI embedding model at $0.02/1M tokens (vs ada-002 at $0.10/1M — 5× cheaper) with higher MTEB scores on document retrieval benchmarks. Same dimensionality as ada-002 means I can keep `vector(1536)` in the schema and swap models later if I ever want to upgrade to `text-embedding-3-large` (3072 dims, would need a schema migration).

**What I considered.** `text-embedding-3-large` — better quality but 6× more expensive and requires a wider vector column. Local embedding models (`bge-small-en-v1.5`, `all-MiniLM-L6-v2`) — free, but adds a runtime dependency and would need `@xenova/transformers` or ONNX Runtime bundled with the server. Deferred until I care about the embedding cost line item.

**Limitations.** 1536 dimensions is the standard for a reason — it's a good quality/cost balance — but `text-embedding-3-large` at 3072 dims measurably improves retrieval recall on hard queries. Not worth the cost right now.

### I chose direct RAG implementation over LangChain / LlamaIndex

**What I chose.** Hand-rolled RAG in `src/lib/ai/chat.ts`: fetch history, save user message, retrieve chunks, build system prompt, stream completion, parse citations, save assistant message. ~120 lines total.

**Why.** The whole flow is small and the "framework" wouldn't save much code — it would just add a layer of abstraction I'd have to debug when something goes wrong. LangChain's streaming story in particular has had a lot of churn and I wanted full control over the `ReadableStream<Uint8Array>` I return to the client (including the critical "persist assistant message *before* `controller.close()`" detail that's load-bearing for serverless correctness).

**What I considered.** LangChain — big ecosystem, adds maintenance burden. LlamaIndex — good for document loaders, overkill for my simple retrieval. The Vercel AI SDK — I actually have it in `package.json` from the spec but don't use it; my `ReadableStream` handling is direct. I could switch to `streamText()` from `ai/openai` later for slightly less boilerplate.

**Limitations.** I'm reinventing a few wheels (chunker, retriever, streaming handler). If the feature surface grows — multi-tool calls, agent loops, complex prompt templates — a framework starts to pay for itself.

### I chose 2000-char chunks with 200-char overlap

**What I chose.** Target ~2000 characters per chunk (~500 tokens), 200 characters of overlap between adjacent chunks, split on paragraph boundaries first then hard-window as a fallback. Every chunk is prefixed with `[Sheet E-XXX]` so the source is visible to the model in the retrieval context.

**Why.** 500 tokens is small enough for precise retrieval (the top-5 result won't be dominated by one huge chunk) but large enough to carry meaningful engineering context (a typical panel schedule or note block fits in one chunk). 200-char overlap is enough to preserve context across the typical sentence boundary without inflating storage. The paragraph-first split respects the document's natural structure; the hard-window fallback guarantees no chunk exceeds the target by more than ~20%.

**What I considered.** 1000-char chunks — more granular but more storage and worse context preservation. 4000-char chunks — fewer round trips but less precise retrieval. Sentence-level chunks — too granular, blows up embedding cost with little upside. LangChain's `RecursiveCharacterTextSplitter` — similar logic, would add a dep for ~30 lines of code.

**Limitations.** The chunker doesn't look at semantic boundaries (section headings, bullet lists, schedules). For highly structured content, a layout-aware chunker would do better. Fine for now because the `[Sheet E-XXX]` prefix gives the model a strong anchor even when a chunk lands mid-paragraph.

### I chose top-5 retrieval

**What I chose.** `retrieveRelevantChunks(sessionId, query, topK=5)`.

**Why.** 5 × 2000 chars ≈ 2,500 tokens of grounding context, which is well under `gpt-4o-mini`'s 128k window but more than enough to answer a specific engineering question with citations. Empirically, top-5 is where recall saturates on the kinds of queries I've tested — adding more chunks rarely brought in new relevant information but did dilute the prompt.

**What I considered.** Top-3 (too little for multi-sheet questions like "compare A, B, C"), top-10 (doubled cost, minimal recall gain). Re-ranking the retrieved chunks with a cross-encoder — would be a real quality boost but adds a second API call.

**Limitations.** For very broad questions ("summarize all the electrical scope") top-5 is clearly too narrow. A proper answer would use a summary-over-summaries approach (map-reduce or hierarchical summarization), which I haven't built.

### I chose temperature 0.2

**What I chose.** `temperature: 0.2` on the chat completion.

**Why.** The model's job is to read grounding context and report it faithfully with accurate citations. Low temperature minimizes stylistic variance and hallucinated details. 0.0 is technically best for factual tasks but introduces weird artifacts on OpenAI's tokenizers (repetition loops, stuck token ladders); 0.2 is the sweet spot in my experience.

**What I considered.** 0.0 (see above), 0.7 (too creative for a grounded Q&A tool — the model started paraphrasing values inaccurately in my tests).

**Limitations.** Low temperature = less varied writing. Answers to "explain the electrical scope" come out a little dry. A user-facing temperature slider is easy to add later if this matters.

---

## UI

### I chose shadcn/ui over Material UI / Chakra

**What I chose.** shadcn/ui's Button, Card, Input, ScrollArea, Badge, Separator, Progress, and Dialog primitives, sitting on top of Tailwind CSS v4 and Base UI.

**Why.** shadcn installs components as plain source files I can edit — there's no library to wrestle with, no theme provider, no prop API I have to learn, no dependency update that breaks something I care about. Every component is just a `.tsx` file in my repo using Tailwind classes. The design tokens (brand color, surface colors, fonts) live in `src/app/globals.css` under `@theme`, and every shadcn component picks them up automatically.

**What I considered.** Material UI — heavy, opinionated design language, hard to make look native to this dark-brutalist theme without fighting their theme system. Chakra — lighter but still a style-prop API I'd have to marry with Tailwind. Radix primitives + raw Tailwind — exactly what shadcn *is*, without the curated starter components.

**Limitations.** Base UI (shadcn's new primitive layer, replacing Radix in recent versions) has a different API from Radix — notably, `asChild` isn't a prop on Base UI's `Dialog.Trigger`. I hit this in the `DeleteSessionButton` component: my first attempt used `<DialogTrigger asChild>` and failed typecheck. The fix was to style the trigger directly, which is arguably cleaner anyway.

### I chose streaming responses over full responses

**What I chose.** The chat endpoint returns `new Response(readableStream)` with `Content-Type: text/plain; charset=utf-8`. The client reads it chunk-by-chunk via `response.body.getReader()` and a `TextDecoder({ stream: true })`, updating the last assistant message on every chunk.

**Why.** First-token latency dominates perceived speed. `gpt-4o-mini` typically takes 1–2 seconds to first token and 2–3 seconds total — if I waited for the full response the user would stare at a spinner for 3 seconds every turn. With streaming, they see the answer start to appear within 1 second, which feels dramatically more responsive.

The client-side live citation parsing (`extractCitationsClient` in `chat.tsx`) means the "Sources: E-101" footer on the assistant bubble populates *while* the tokens are streaming, not after. Small detail, big perceived polish.

**What I considered.** Server-Sent Events (SSE) — strictly more structured than plain text but adds framing overhead I don't need when the client is happy with raw tokens. Full non-streaming responses — much simpler but worse UX. The Vercel AI SDK's `streamText` — would work, but I wanted to own the stream for the "persist before close" fix.

**Limitations.** The raw-text stream protocol is simple but doesn't have a structured way to carry metadata (e.g., retrieval scores or tool calls) alongside the tokens. If I wanted to show "retrieving..." then "generating..." separately, I'd need to switch to SSE or the AI SDK's framed protocol.

### I chose the cover-page-then-chat pattern

**What I chose.** On the session page, the cover page (file name, sheet list, status pill) is at the top, with the chat panel directly below it. When the session is still processing, the cover page shows a skeleton of the sheet list and a status pill, and the chat is hidden behind a "processing" notice. As sheets are identified, they animate in.

**Why.** The cover page is the evaluator's first confirmation that the app did what it said it would do — it *sees* the 6 E-sheets appear with their page numbers and extraction method (text vs vision), and it builds confidence that the chat answers below are grounded in the right content. Showing it before the chat reinforces the mental model "we found these sheets, now ask about them." The spec recommended this pattern and I think it's right.

**What I considered.** A collapsible sidebar for the sheet list (too busy), a tab-based layout with "Sheets" and "Chat" tabs (hides the sheets from the chat view), a single "everything at once" grid (too dense on mobile).

**Limitations.** On very small screens, scrolling past the cover page to reach the chat is a bit of friction. A future polish item would be collapsing the cover page into a single-line summary once the user has scrolled past it the first time.

---

## Tradeoffs & Limitations

A consolidated list of things I know I'm accepting:

- **Synchronous PDF processing** caps the practical PDF size at ~50 pages on Vercel Hobby (60s timeout) or ~200 pages on Pro (300s). Past that, the upload request times out. Fix: queue + worker.
- **No auth.** Anyone with a session URL can read and delete it. Fine for a demo, not for anything with real PII. Fix: NextAuth or Clerk + a `User` table with a foreign key on `Session`.
- **Vision cost is non-trivial** at the 100-PDFs/day scale (~$10/day if every PDF has a handful of scanned pages). Fix: more aggressive thresholding, cache vision responses by page content hash.
- **pgvector without an index** works well at thousands of chunks, gets linearly slower at millions. Fix: `CREATE INDEX ... USING hnsw`.
- **No inline PDF preview.** When the assistant cites "Sheet E-201" you can see the sheet in the cover page list but can't click to view the actual page. Fix: pdfjs-dist rendering in a side panel, or linking out to the blob URL at the specific page.
- **The 100-char text-length threshold** for the vision fallback is hand-tuned and not validated against a wide sample of real drawing sets. Fix: build an eval harness and sweep the threshold against ground-truth labels.
- **No batching of vision calls.** Each low-text page fires a separate gpt-4o-mini vision request. OpenAI doesn't batch vision requests as of the last time I checked, but if they do in the future that'd be the obvious optimization.
- **Client-side citation parsing and server-side citation parsing are duplicated** (one regex in `chat.tsx`, one in `chat.ts`). They're kept identical deliberately so the streaming UI shows the same citations the server persists, but it's a DRY violation. Fix: a shared `src/lib/ai/citations.ts` if I ever need a third caller.
- **pdf-parse + pdfjs-dist + canvas** native deps need to be in `serverExternalPackages`. It's fragile — if someone adds a new native PDF dep and forgets to update `next.config.ts`, Turbopack will try to bundle wasm into the server chunks and break the build.
- **No automated tests.** I verified the full pipeline with a hand-written end-to-end script against the real Neon + OpenAI credentials, but there's no CI gate and no regression suite. Fix: Vitest with the PDF pipeline + HTTP route tests, gated in CI.
