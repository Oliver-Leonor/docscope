# Architecture Decisions

This document explains the architectural decisions behind **DocScope**, a document intelligence tool I built to demonstrate full-stack AI application development. For each decision: **what I chose**, **why**, **what I considered instead**, and **the limitations I'm accepting**.

The repository contains no reproducible latency, cost, model-quality, or retrieval-recall benchmarks. Configuration values below describe the implementation; development observations and design choices are not measured performance guarantees.

---

## Framework & Architecture

### I chose Next.js App Router over Pages Router

**What I chose.** Next.js 16 App Router, with server components by default and `"use client"` only where I need interactivity.

**Why.** Server components keep Prisma queries and rendering of the session list on the server without shipping that database code to the browser. Tailwind generates CSS during the build; it is not runtime work performed by server components. Streaming route handlers matter for the chat endpoint — I return a `ReadableStream<Uint8Array>` built from the OpenAI stream and let Next.js pipe it to the browser with no extra framework. The App Router's file-system conventions (`loading.tsx`, `error.tsx`, nested layouts) provide the hooks for the skeletons and error boundaries implemented here.

**What I considered.** Pages Router — more familiar, bigger ecosystem of examples. Ruled out because (a) its API routes don't have the same streaming ergonomics, (b) it would prevent me from using server components for the session list and home page, and (c) Pages is effectively in maintenance mode now.

**Limitations.** The learning curve for server/client boundaries is real — the session detail page needed to be a *client* component so it could poll the status API without a full re-request. In Next.js 16, `params` is a `Promise` that has to be awaited in route handlers and page components, which trips up anyone expecting the Next.js 14 API.

### I chose a monolith over separate services

**What I chose.** Single Next.js app with frontend, API routes, and synchronous document processing all in one repo and one deploy target.

**Why.** I chose a monolith to reduce deployment and coordination work: one deploy target and codebase, without a separate ingestion service. This is a simplicity choice, not a measured development-speed or operating-cost comparison. TypeScript checks the server and UI code, but the HTTP response is independently constructed and the client casts its JSON to `SessionStatus`. API/UI shape agreement is not enforced across that boundary by the compiler.

**What I considered.** Splitting PDF ingestion into a standalone worker while keeping Next.js as the frontend. That could give processing a lifetime separate from the upload request, but would require job handling and status reporting. I kept ingestion inline for this prototype.

**Limitations.** The upload route owns the whole ingest pipeline inline, so ingestion holds a request open until completion. No load test establishes which stage becomes the main bottleneck.

### I chose synchronous PDF processing over a job queue

**What I chose.** `POST /api/upload` receives a multipart PDF, enforces a 4 MB (4,000,000-byte) file limit before reading its buffer, checks the PDF signature, then does blob upload → text extraction → page identification (with vision fallback) → chunking → embedding → DB writes all inline before returning. The client gets `{ sessionId }` back after processing and persistence complete.

**Why.** Simpler. The alternative is a queue (Inngest / BullMQ / Trigger.dev) + a worker + a webhook/polling layer — that's three more moving parts. The session page can poll the status API every 2s while a session is processing, but the upload UI normally navigates there only after processing finishes. The upload itself shows a waiting indicator, not live page-by-page progress.

**What I considered.** Inngest, Trigger.dev, or a dedicated Node worker behind BullMQ + Upstash Redis. A separate job system could decouple ingestion from the upload request, but adds operational work. I have not benchmarked these alternatives for this application.

**Limitations.** The upload route's `maxDuration = 300` is the repository's requested maximum, not a verified live deployment limit. There is no fixed page-count capacity: completion depends on document contents, extraction work, external API calls, and database latency. The conservative 4 MB file limit allows for multipart overhead, but `request.formData()` still receives the request before the file-size check. Direct-to-object-storage uploads would be appropriate for larger files; processing would still face the function-duration limit.

---

## Database

### I chose Neon over Supabase / PlanetScale / RDS

**What I chose.** PostgreSQL with Neon as the intended host, and the `vector` extension declared via Prisma's `extensions = [vector]` schema directive. The connection endpoint comes from `DATABASE_URL`; the repository does not enforce use of a pooled endpoint.

**Why.** PostgreSQL lets me keep relational data and vectors together, using Prisma, raw SQL for vector operations, `onDelete: Cascade` on foreign keys, and `String[]` columns for citation arrays. A pooled endpoint can help manage connections across function instances; the application reuses a Prisma client within a running instance.

**What I considered.** Supabase, PlanetScale, and RDS. I chose a hosted PostgreSQL setup for this prototype; the repository contains no comparative cost or performance evaluation of these providers.

**Limitations.** Connection startup and database availability can affect the first query after idle. The repository contains no cold-start measurements, so I do not claim a specific latency.

### I chose pgvector over Pinecone / Weaviate / Qdrant

**What I chose.** Vectors live in a `vector(1536)` column on the same `Chunk` table that holds the text content. Relational data and embeddings share a database; the original PDF lives separately in Vercel Blob.

**Why.** Database cascade deletion removes a Session's Sheets, Chunks (including embeddings), and Messages together. Database backups can include those records, but do not include the separately stored PDF. `retrieveRelevantChunks` joins Chunk to Sheet for the section label in one database query, after a separate embedding API request.

The schema currently has no vector-search index. An `hnsw` index is a possible future change to evaluate against representative queries and data volumes:

```sql
CREATE INDEX ON "Chunk" USING hnsw (embedding vector_cosine_ops);
```

**What I considered.** Pinecone, Weaviate, and Qdrant would introduce a separate vector store and synchronization work. The repository contains no comparison supporting a performance advantage at a particular dataset size.

**Limitations.** Retrieval appeared responsive during informal development use, but no reproducible timing results are checked in. Without a vector-search index, distance calculations and ranking must account for the matching session's candidate chunks; end-to-end latency also includes the embedding API request.

Deleting a session spans Blob storage and the database, so it is not atomic. The API deletes the Blob first: a storage failure preserves the session and its Blob URL for retry. If the database deletion then fails, retry tolerates the already-missing Blob and can finish the database cleanup. This preserves a retry target instead of risking a public orphaned Blob after deleting its database reference.

### I chose Prisma + raw SQL for vectors over pure raw SQL

**What I chose.** Prisma owns the schema and generates the client. All relational operations go through the Prisma client. Vector operations use `prisma.$executeRaw` and `prisma.$queryRaw` with explicit `::vector` casts.

**Why.** Prisma provides schema synchronization via `db push`, a generated client, cascade declarations, and array fields for citations. The project does not keep a migration history. For `vector(1536)`, I use parameterized raw SQL and document the column with `Unsupported("vector(1536)")` in the schema.

**What I considered.** Writing queries directly with `pg` or `postgres.js`, or using Drizzle. I kept Prisma for its generated client and schema declarations; this was a tooling preference, not a measured setup-speed comparison.

**Limitations.** My vector inserts bypass Prisma's default-value machinery, so I generate UUIDs in server-side application code with the `uuid` package.

---

## PDF Processing

### I chose two-pass extraction over vision-only

**What I chose.** Pass 1 is unpdf text extraction on every page. Pages with at least ~200 characters of recovered text skip vision entirely. Pass 2 is `gpt-4o-mini` vision on the remaining low-text pages (usually scanned rasters or image-heavy pages).

**Why.** Pages meeting the text-length threshold avoid a vision API call. The code supports that reduction in calls, but the cost benefit depends on the input documents and API usage. No per-page cost or savings multiplier has been benchmarked in this repository.

**What I considered.** Vision-only would send every page for vision extraction. In informal development trials, Tesseract's output looked worse than GPT-4o-mini's on the scanned pages I tried. That is a development observation, not a controlled accuracy comparison; the sample set and scored results are not checked in.

**Limitations.** The character-count threshold is a heuristic, not image-content detection. A page with at least 200 characters in its text layer can skip vision even if a scanned body or diagram contains additional information. Pages with no recovered text are still listed, but produce no chunks to index.

### I chose `unpdf` over raw `pdfjs-dist` / `pdf-parse`

**What I chose.** `unpdf`, a serverless-friendly redistribution of `pdfjs-dist`, for per-page text extraction. Page-to-PDF splitting for vision uses `pdf-lib`.

**Why.** Commit `38da07e` records the switch away from earlier PDF parsing/rendering dependencies after serverless compatibility problems during development. That history is not a compatibility test across all library versions or runtimes. The current code uses unpdf's text-extraction API and does not rasterize pages locally; unpdf also provides rendering APIs that this application does not use.

For vision, instead of rasterizing to a PNG (which would need canvas), I split the source PDF into single-page PDFs with `pdf-lib` (pure JS) and send them directly to OpenAI via the `type: "file"` content part. OpenAI renders the page internally on its vision-capable models. That moves rasterization out of the serverless function entirely.

**What I considered.**

- **`pdf-parse`, `pdf-img-convert`, and raw `pdfjs-dist`** — earlier parsing/rendering approaches raised compatibility issues during development; no reproducible version-by-version comparison is included.
- **`pdf2pic`** — an alternative conversion approach I did not retain in the implementation.
- **Raw `pdfjs-dist` + `@napi-rs/canvas`** — would add local rendering dependencies. There is no checked-in bundle-size comparison supporting a specific size increase.

**Limitations.** Each vision request includes a base64-encoded single-page PDF. Payload size depends on the page; no PDF-versus-PNG latency comparison has been measured reproducibly here.

---

## AI / LLM

### I chose `gpt-4o-mini` over `gpt-4o` / Claude

**What I chose.** `gpt-4o-mini` for both the chat completions and the vision fallback. `text-embedding-3-small` for the embedding model.

**Why.** I chose `gpt-4o-mini` for this prototype's document Q&A and vision calls, with cost and response time as design considerations. The repository contains no model comparison establishing a cost ratio, speed advantage, or equivalent answer quality.

For vision, the code requests `response_format: { type: "json_object" }` and asks for `{sectionLabel, extractedText}`. That specifies the response format; it does not establish extraction accuracy or completeness.

**What I considered.** `gpt-4o`, Claude Sonnet, and Claude Haiku. I kept the existing OpenAI integration; no controlled comparison of these models is included.

**Limitations.** Cross-page synthesis ("compare the three quarterly summaries") can require evidence outside the retrieved chunks. A different model would need evaluation on representative questions; switching models alone would not recover missing evidence.

### I chose `text-embedding-3-small` over `ada-002`

**What I chose.** `text-embedding-3-small`, 1536 dimensions.

**Why.** `text-embedding-3-small` is the model used for both stored chunks and query embeddings. The code validates 1536-dimensional chunk embeddings against the schema's `vector(1536)` column. The repository contains no pricing snapshot or retrieval benchmark comparing it with `ada-002`.

**Limitations.** No evaluation here establishes that another embedding model improves recall on DocScope's documents. A model change would require re-embedding stored content; a different dimension would also require changing the schema and dimension validation.

### I chose direct RAG implementation over LangChain / LlamaIndex

**What I chose.** Hand-rolled RAG in `src/lib/ai/chat.ts`: fetch history, save user message, retrieve chunks, build system prompt, stream completion, parse citations, save assistant message. The prompt instructs the model to base factual answers on retrieved document content, acknowledge insufficient evidence, and avoid filling gaps with general knowledge. These are instructions, not a technical barrier to unsupported answers.

**Why.** The whole flow is small and the "framework" wouldn't save much code — it would just add a layer of abstraction I'd have to debug when something goes wrong. LangChain's streaming story in particular has had a lot of churn and I wanted full control over the `ReadableStream<Uint8Array>` I return to the client (including the critical "persist assistant message *before* `controller.close()`" detail that's load-bearing for serverless correctness).

**What I considered.** LangChain — big ecosystem, adds maintenance burden. LlamaIndex — good for document loaders, overkill for simple retrieval. The Vercel AI SDK — direct stream handling works fine; I can switch later if I want framed protocol support.

**Limitations.** I'm reinventing a few wheels (chunker, retriever, streaming handler). If the feature surface grows — multi-tool calls, agent loops, complex prompt templates — a framework starts to pay for itself.

### I chose 2000-char chunks with 200-char overlap

**What I chose.** Target ~2000 characters per chunk, with a 200-character overlap target, split on paragraph boundaries first then hard-window as a fallback. These are character-based heuristics, not enforced token counts. Every chunk is prefixed with its section label (e.g. `[Page 5]` or `[A-201]`) so the source is visible to the model in the retrieval context.

**Why.** I chose these targets to limit context size while retaining some text across chunk boundaries. Overlap duplicates text and adds storage/embedding work. There is no evaluation establishing that these settings preserve every sentence boundary or maximize retrieval quality.

**Limitations.** The chunker doesn't identify semantic boundaries such as headings or tables. A layout-aware alternative would need evaluation. The section-label prefix identifies the source but does not restore structure lost during extraction or splitting.

### I chose top-5 retrieval with temperature 0.2

**What I chose.** `retrieveRelevantChunks(sessionId, query, topK=5)` with `temperature: 0.2` on the chat completion.

**Why.** Top-5 limits how many chunks enter the prompt. Combined with the chunker's ~2000-character target, this is a context-size heuristic, not a measured recall optimum or a guarantee that the answer is present.

Temperature 0.2 is the configured generation setting. No evaluation in this repository establishes an optimal temperature or a reduction in hallucinations.

**Limitations.** For broad questions ("summarize this whole document"), top-5 may omit relevant pages. Whole-document summarization would need a separate approach and evaluation; it is not implemented here.

---

## UI

### I chose shadcn/ui over Material UI / Chakra

**What I chose.** shadcn/ui's Button, Card, Input, ScrollArea, Badge, Separator, and Dialog primitives, sitting on top of Tailwind CSS v4 and Base UI.

**Why.** shadcn installs components as plain source files I can edit — there's no library to wrestle with, no theme provider, no prop API I have to learn. The design tokens (brand color, surface colors, fonts) live in `src/app/globals.css` under `@theme`, and every shadcn component picks them up automatically.

**Limitations.** Base UI (shadcn's new primitive layer, replacing Radix in recent versions) has a different API from Radix — notably, `asChild` isn't a prop on Base UI's `Dialog.Trigger`. I hit this in the `DeleteSessionButton` component and had to style the trigger directly.

### I chose streaming responses over full responses

**What I chose.** The chat endpoint returns `new Response(readableStream)` with `Content-Type: text/plain; charset=utf-8`. The client reads it chunk-by-chunk via `response.body.getReader()` and `decoder.decode(value, { stream: true })`, updating the last assistant message on every chunk.

**Why.** Streaming lets the UI display received text before the complete answer is available. Database access and retrieval still happen before generation begins. The repository contains no reproducible first-token or total-response latency measurements, so no response-time target is claimed.

The client-side live citation parsing (`extractCitationsClient` in `chat.tsx`) means the "Sources" footer on the assistant bubble populates *while* the tokens are streaming, not after.

**Limitations.** The raw-text stream protocol doesn't have a structured way to carry metadata (retrieval scores, tool calls) alongside the tokens. If I wanted to show "retrieving..." then "generating..." separately, I'd need to switch to SSE or the AI SDK's framed protocol.

### I chose the cover-page-then-chat pattern

**What I chose.** On the session page, the cover page (file name, processed pages list, status pill) is at the top, with the chat panel directly below it. In the normal upload flow, processing has finished before navigation; the completed page list animates into view.

**Why.** The cover page is the user's first confirmation that the app did what it said it would do — they *see* the processed pages appear with their labels and extraction method (text vs vision), and it builds confidence that the chat answers below are grounded in the right content. Showing it before the chat reinforces the mental model "we extracted these pages, now ask about them."

**Limitations.** On very small screens, scrolling past the cover page to reach the chat is a bit of friction. A future polish item would be collapsing the cover page into a single-line summary once the user has scrolled past it the first time.

---

## Tradeoffs & Limitations

A consolidated list of things I know I'm accepting:

- **Synchronous PDF processing** must finish within the deployment's effective function-duration limit. The route requests 300 seconds, but even PDFs within the 4 MB upload limit may time out depending on processing work and service latency.
- **Prompt-based grounding** asks the model to use only retrieved document content and acknowledge insufficient evidence. It does not prevent hallucinations or the use of outside knowledge. Citations are model-generated references, not proof of correctness, and top-5 retrieval may miss relevant content elsewhere in the PDF.
- **No auth.** The homepage lists sessions publicly, visitors can read and delete them, and uploaded PDFs use public Blob access. This is a demo limitation. Fix: authentication and ownership checks.
- **Vision usage** grows with the number of low-text pages and retries. Cost has not been benchmarked here. Possible future changes: threshold evaluation and caching vision responses by page content hash.
- **No vector-search index** is declared in the schema. Retrieval cost at larger data volumes needs measurement before choosing an index or claiming a capacity limit.
- **No inline PDF preview.** When the assistant cites "Page 5" you can't click to view the actual page. Fix: pdfjs rendering in a side panel, or linking out to the blob URL at the specific page.
- **No batching of vision calls.** Each low-text page fires a separate gpt-4o-mini vision request.
- **Client-side and server-side citation parsing are duplicated** (one regex in `chat.tsx`, one in `chat.ts`). They're kept identical deliberately so the streaming UI shows the same citations the server persists, but it's a DRY violation.
- **No checked-in automated test suite.** Development included manual end-to-end checks, but the repository has no reproducible performance benchmark or scored retrieval evaluation. A future test suite could cover the PDF pipeline and HTTP routes.
