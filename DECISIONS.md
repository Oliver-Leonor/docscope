# Architecture Decisions

This document explains the architectural decisions behind **DocScope**, a document intelligence tool I built to demonstrate full-stack AI application development. For each decision: **what I chose**, **why**, **what I considered instead**, and **the limitations I'm accepting**.

---

## Framework & Architecture

### I chose Next.js App Router over Pages Router

**What I chose.** Next.js 16 App Router, with server components by default and `"use client"` only where I need interactivity.

**Why.** Server components let the expensive work (Prisma queries, server-side rendering of the session list, Tailwind tokenization) happen on the server with zero client-bundle cost. Streaming route handlers are a first-class primitive, which matters a lot for the chat endpoint — I return a `ReadableStream<Uint8Array>` directly from the OpenAI stream and let Next.js pipe it to the browser with no extra framework. The App Router's file-system conventions (`loading.tsx`, `error.tsx`, nested layouts) gave me skeleton and error-boundary handling for free.

**What I considered.** Pages Router — more familiar, bigger ecosystem of examples. Ruled out because (a) its API routes don't have the same streaming ergonomics, (b) it would prevent me from using server components for the session list and home page, and (c) Pages is effectively in maintenance mode now.

**Limitations.** The learning curve for server/client boundaries is real — the session detail page needed to be a *client* component so it could poll the status API without a full re-request. In Next.js 16, `params` is a `Promise` that has to be awaited in route handlers and page components, which trips up anyone expecting the Next.js 14 API.

### I chose a monolith over separate services

**What I chose.** Single Next.js app with frontend, API routes, and background-ish processing all in one repo and one deploy target.

**Why.** At this scope a monolith is strictly faster to build, easier to reason about, and cheaper to operate. One deploy, one set of env vars, one codebase, no cross-service auth, no extra network hops. TypeScript types flow end-to-end: the `CoverPageSheet` interface used by the UI is the same shape the API returns, so a refactor in one place forces a typecheck failure in the other.

**What I considered.** Splitting the PDF ingest into a standalone Node worker on Railway or Fly, keeping Next.js purely as the frontend. That would solve the serverless function timeout for huge PDFs and decouple deploys. Ruled out because the complexity wasn't justified at this stage — I can add a worker later without changing the frontend (see "Synchronous processing" below).

**Limitations.** The upload route owns the whole ingest pipeline inline, which is the single biggest bottleneck under load.

### I chose synchronous PDF processing over a job queue

**What I chose.** `POST /api/upload` does blob upload → text extraction → page identification (with vision fallback) → chunking → embedding → DB writes all inline before returning. The client gets `{ sessionId }` back once everything is persisted.

**Why.** Simpler. The alternative is a queue (Inngest / BullMQ / Trigger.dev) + a worker + a webhook/polling layer — that's three more moving parts. The client-side polling on the session page is already set up (status API refetches every 2s and animates new pages as they land), so *the UI is ready* for an async backend whenever I want to make the switch; I just didn't need to pay the complexity cost today.

**What I considered.** Inngest (easiest to wire into Next.js, durable, free tier). Trigger.dev. A dedicated Node worker behind BullMQ + Upstash Redis. All of these are superior at scale; all of them are overkill right now.

**Limitations.** 60-second Vercel Hobby function timeout caps me at roughly a 50-page PDF with a handful of vision calls. Vercel Pro's 300s helps but isn't a real solution long-term.

---

## Database

### I chose Neon over Supabase / PlanetScale / RDS

**What I chose.** Neon serverless Postgres, pooled connection, `vector` extension enabled via Prisma's `extensions = [vector]` schema directive.

**Why.** (a) `pgvector` is available on Neon's free tier with zero setup. (b) Neon's pooler is the right default for Next.js serverless — every route handler is a short-lived connection, and the pooler handles the connection churn cleanly. (c) It's Postgres, so I get the full ecosystem: Prisma, raw SQL for the vector operations, `onDelete: Cascade` on foreign keys, `String[]` columns for citation arrays. (d) Branching is a nice bonus for future preview deploys.

**What I considered.** Supabase — also has `pgvector`, but I wasn't using their auth or storage so the bundled features didn't pay for themselves. PlanetScale — no native vector support. RDS — too heavy, no serverless story.

**Limitations.** Neon's cold-start on free tier can add ~1s to the first query after idle. Fine for a demo, worth knowing in prod.

### I chose pgvector over Pinecone / Weaviate / Qdrant

**What I chose.** Vectors live in a `vector(1536)` column on the same `Chunk` table that holds the text content. One database, one transaction boundary, one source of truth.

**Why.** Operational simplicity is the killer feature. Cascade deletes just work: `DELETE FROM Session` → Prisma cascades to Sheet → Chunk (with its embedding column) in a single transaction. No "the vector store still has orphan records from the deleted session" bug class to worry about. Backups cover everything. Querying is cheap joins: my `retrieveRelevantChunks` joins Chunk to Sheet to get the section label in a single round-trip.

At this scale (thousands of chunks, not millions) pgvector's sequential scan is fast enough. I can bolt on an `hnsw` index later without moving any data:

```sql
CREATE INDEX ON "Chunk" USING hnsw (embedding vector_cosine_ops);
```

**What I considered.** Pinecone — much better at millions-of-vectors scale, but adds a second database with its own auth, its own billing, its own consistency story. Weaviate / Qdrant — self-hosted versions add infra; managed versions share the same cross-store complexity.

**Limitations.** Without an index, query time scales linearly with chunk count. At this scale (hundreds to thousands of chunks per session) I've measured query latencies under 200ms including the embedding round-trip.

### I chose Prisma + raw SQL for vectors over pure raw SQL

**What I chose.** Prisma owns the schema and generates the client. All relational operations go through the Prisma client. Vector operations use `prisma.$executeRaw` and `prisma.$queryRaw` with explicit `::vector` casts.

**Why.** Prisma does the boring stuff (migrations via `db push`, typed client, cascade declarations, `String[]` JSON serialization) exceptionally well. Where it falls short — it can't represent `vector(1536)` in its type system — I drop to parameterized raw SQL, which is no worse than writing any other hand-tuned SQL. The Prisma schema still documents the column via `Unsupported("vector(1536)")`, which is enough to keep `db push` behaving.

**What I considered.** Writing everything in `pg` or `postgres.js` directly. Would give tighter control but sacrifice the typed client, the migrations, and the cascade semantics, in exchange for nothing I actually need. I considered Drizzle too — its raw SQL story is better, but the Prisma ecosystem was faster to set up at the start.

**Limitations.** My vector inserts bypass Prisma's default-value machinery, so I have to generate UUIDs client-side with the `uuid` package.

---

## PDF Processing

### I chose two-pass extraction over vision-only

**What I chose.** Pass 1 is unpdf text extraction on every page. Pages with at least ~200 characters of recovered text skip vision entirely. Pass 2 is `gpt-4o-mini` vision on the remaining low-text pages (usually scanned rasters or image-heavy pages).

**Why.** Cost. Most real PDFs have a native text layer on most pages — the text-first pass catches them for free. Vision-only would burn ~$0.01 per page × 100 pages = ~$1.00 per PDF, and most of those calls would be redundant. The heuristic is a ~5–10× cost reduction on realistic inputs.

**What I considered.** Vision-only — most reliable but eye-wateringly expensive. Smaller open-source OCR models (Tesseract) — added a native dependency and gave worse results than gpt-4o-mini vision on the scanned pages I tested.

**Limitations.** The character-count threshold is a judgment call. A page with just a few labels in the native text layer but a scanned body would incorrectly skip vision. In practice this is rare because real PDF pages almost always have at least a title/heading in text.

### I chose `unpdf` over raw `pdfjs-dist` / `pdf-parse`

**What I chose.** `unpdf`, a serverless-friendly redistribution of `pdfjs-dist`, for per-page text extraction. Page-to-PDF splitting for vision uses `pdf-lib`.

**Why.** Vercel serverless has no `DOMMatrix` / `Path2D` / `ImageData`, so anything that tries to render PDF.js into a canvas blows up at module load. `pdf-parse`, `pdf-img-convert`, and raw `pdfjs-dist` all fail in that environment. `unpdf` ships a Node-friendly build that only does text extraction — no canvas imports, no wasm, no native dependencies.

For vision, instead of rasterizing to a PNG (which would need canvas), I split the source PDF into single-page PDFs with `pdf-lib` (pure JS) and send them directly to OpenAI via the `type: "file"` content part. OpenAI renders the page internally on its vision-capable models. That moves rasterization out of the serverless function entirely.

**What I considered.**

- **`pdf-parse` v1 / v2** — needs canvas for rasterization, blows up on Vercel's runtime.
- **`pdf-img-convert`** — wraps pdfjs-dist but pins an old version of `canvas` that fails to build.
- **`pdf2pic`** — depends on GraphicsMagick / ImageMagick, doesn't work on Vercel.
- **Raw `pdfjs-dist` + `@napi-rs/canvas`** — works locally but adds ~40MB of native binaries to the function bundle and is brittle under Turbopack.

**Limitations.** Because vision goes through OpenAI's `type: "file"` input, every vision call round-trips the whole page PDF (base64-encoded). For page-heavy PDFs this is measurably slower per call than sending a small PNG would be.

---

## AI / LLM

### I chose `gpt-4o-mini` over `gpt-4o` / Claude

**What I chose.** `gpt-4o-mini` for both the chat completions and the vision fallback. `text-embedding-3-small` for the embedding model.

**Why.** For retrieval-grounded answers, the model's job is to read context and paraphrase accurately — it doesn't need the headroom `gpt-4o` gives you for long chains of reasoning. `gpt-4o-mini` is ~15× cheaper on both input and output tokens, ~2× faster on first-token latency, and indistinguishable for this workload.

For vision, `gpt-4o-mini` handles page-level extraction reliably when I set `response_format: { type: "json_object" }` and ask for a structured `{sectionLabel, extractedText}` response.

**What I considered.** `gpt-4o` — ~15× more expensive with no perceptible quality difference for grounded answers. Claude Sonnet — comparable quality, not integrated with the `openai` SDK I'm already using for embeddings. Claude Haiku — similar tradeoff.

**Limitations.** For questions that require cross-page synthesis ("compare the three quarterly summaries") a more capable model would probably do better. A two-model setup eventually makes sense: `gpt-4o-mini` for simple grounded answers, a bigger model for flagged multi-hop questions.

### I chose `text-embedding-3-small` over `ada-002`

**What I chose.** `text-embedding-3-small`, 1536 dimensions.

**Why.** It's the current cheapest OpenAI embedding model at $0.02/1M tokens (vs ada-002 at $0.10/1M — 5× cheaper) with higher MTEB scores on document retrieval benchmarks. Same dimensionality as ada-002 means I can keep `vector(1536)` in the schema and swap models later if I ever want to upgrade to `text-embedding-3-large` (3072 dims, would need a schema migration).

**Limitations.** 1536 dimensions is a good quality/cost balance — but `text-embedding-3-large` at 3072 dims measurably improves retrieval recall on hard queries. Not worth the cost right now.

### I chose direct RAG implementation over LangChain / LlamaIndex

**What I chose.** Hand-rolled RAG in `src/lib/ai/chat.ts`: fetch history, save user message, retrieve chunks, build system prompt, stream completion, parse citations, save assistant message. ~150 lines total.

**Why.** The whole flow is small and the "framework" wouldn't save much code — it would just add a layer of abstraction I'd have to debug when something goes wrong. LangChain's streaming story in particular has had a lot of churn and I wanted full control over the `ReadableStream<Uint8Array>` I return to the client (including the critical "persist assistant message *before* `controller.close()`" detail that's load-bearing for serverless correctness).

**What I considered.** LangChain — big ecosystem, adds maintenance burden. LlamaIndex — good for document loaders, overkill for simple retrieval. The Vercel AI SDK — direct stream handling works fine; I can switch later if I want framed protocol support.

**Limitations.** I'm reinventing a few wheels (chunker, retriever, streaming handler). If the feature surface grows — multi-tool calls, agent loops, complex prompt templates — a framework starts to pay for itself.

### I chose 2000-char chunks with 200-char overlap

**What I chose.** Target ~2000 characters per chunk (~500 tokens), 200 characters of overlap between adjacent chunks, split on paragraph boundaries first then hard-window as a fallback. Every chunk is prefixed with its section label (e.g. `[Page 5]` or `[A-201]`) so the source is visible to the model in the retrieval context.

**Why.** 500 tokens is small enough for precise retrieval (the top-5 result won't be dominated by one huge chunk) but large enough to carry meaningful context. 200-char overlap is enough to preserve context across the typical sentence boundary without inflating storage.

**Limitations.** The chunker doesn't look at semantic boundaries (section headings, bullet lists, tables). For highly structured content, a layout-aware chunker would do better. Fine for now because the section-label prefix gives the model a strong anchor even when a chunk lands mid-paragraph.

### I chose top-5 retrieval with temperature 0.2

**What I chose.** `retrieveRelevantChunks(sessionId, query, topK=5)` with `temperature: 0.2` on the chat completion.

**Why.** 5 × 2000 chars ≈ 2,500 tokens of grounding context, well under `gpt-4o-mini`'s 128k window but more than enough to answer a specific question with citations. Empirically, top-5 is where recall saturates on typical queries.

Temperature 0.2 minimizes stylistic variance and hallucinated details for a grounded Q&A workload. 0.0 is technically best for factual tasks but introduces weird artifacts on OpenAI's tokenizers; 0.2 is the sweet spot.

**Limitations.** For very broad questions ("summarize this whole document") top-5 is too narrow. A proper answer would use a summary-over-summaries approach which I haven't built.

---

## UI

### I chose shadcn/ui over Material UI / Chakra

**What I chose.** shadcn/ui's Button, Card, Input, ScrollArea, Badge, Separator, and Dialog primitives, sitting on top of Tailwind CSS v4 and Base UI.

**Why.** shadcn installs components as plain source files I can edit — there's no library to wrestle with, no theme provider, no prop API I have to learn. The design tokens (brand color, surface colors, fonts) live in `src/app/globals.css` under `@theme`, and every shadcn component picks them up automatically.

**Limitations.** Base UI (shadcn's new primitive layer, replacing Radix in recent versions) has a different API from Radix — notably, `asChild` isn't a prop on Base UI's `Dialog.Trigger`. I hit this in the `DeleteSessionButton` component and had to style the trigger directly.

### I chose streaming responses over full responses

**What I chose.** The chat endpoint returns `new Response(readableStream)` with `Content-Type: text/plain; charset=utf-8`. The client reads it chunk-by-chunk via `response.body.getReader()` and a `TextDecoder({ stream: true })`, updating the last assistant message on every chunk.

**Why.** First-token latency dominates perceived speed. `gpt-4o-mini` typically takes 1–2 seconds to first token and 2–3 seconds total — if I waited for the full response the user would stare at a spinner for 3 seconds every turn. With streaming, they see the answer start to appear within 1 second, which feels dramatically more responsive.

The client-side live citation parsing (`extractCitationsClient` in `chat.tsx`) means the "Sources" footer on the assistant bubble populates *while* the tokens are streaming, not after.

**Limitations.** The raw-text stream protocol doesn't have a structured way to carry metadata (retrieval scores, tool calls) alongside the tokens. If I wanted to show "retrieving..." then "generating..." separately, I'd need to switch to SSE or the AI SDK's framed protocol.

### I chose the cover-page-then-chat pattern

**What I chose.** On the session page, the cover page (file name, processed pages list, status pill) is at the top, with the chat panel directly below it. As pages are processed, they animate in.

**Why.** The cover page is the user's first confirmation that the app did what it said it would do — they *see* the processed pages appear with their labels and extraction method (text vs vision), and it builds confidence that the chat answers below are grounded in the right content. Showing it before the chat reinforces the mental model "we extracted these pages, now ask about them."

**Limitations.** On very small screens, scrolling past the cover page to reach the chat is a bit of friction. A future polish item would be collapsing the cover page into a single-line summary once the user has scrolled past it the first time.

---

## Tradeoffs & Limitations

A consolidated list of things I know I'm accepting:

- **Synchronous PDF processing** caps the practical PDF size at ~50 pages on Vercel Hobby (60s timeout) or ~200 pages on Pro (300s). Past that, the upload request times out. Fix: queue + worker.
- **No auth.** Anyone with a session URL can read and delete it. Fine for a demo. Fix: NextAuth or Clerk + a `User` table with a foreign key on `Session`.
- **Vision cost is non-trivial** at scale. Fix: more aggressive thresholding, cache vision responses by page content hash.
- **pgvector without an index** works well at thousands of chunks, gets linearly slower at millions. Fix: `CREATE INDEX ... USING hnsw`.
- **No inline PDF preview.** When the assistant cites "Page 5" you can't click to view the actual page. Fix: pdfjs rendering in a side panel, or linking out to the blob URL at the specific page.
- **No batching of vision calls.** Each low-text page fires a separate gpt-4o-mini vision request.
- **Client-side and server-side citation parsing are duplicated** (one regex in `chat.tsx`, one in `chat.ts`). They're kept identical deliberately so the streaming UI shows the same citations the server persists, but it's a DRY violation.
- **No automated tests.** Verified the full pipeline end-to-end manually. Fix: Vitest with the PDF pipeline + HTTP route tests, gated in CI.
