# PunchZero — Electrical PDF QA

Upload a construction drawing set (PDF), automatically identify the electrical sheets (E‑xxx), extract their contents, and ask natural-language questions about the electrical scope with citations back to the source sheets.

Built with Next.js 16 (App Router), Prisma + Neon Postgres with pgvector, OpenAI (`gpt-4o-mini` + `text-embedding-3-small`), and shadcn/ui on Tailwind CSS v4.

---

## Setup

### Prerequisites

- **Node.js 18+** (tested on 25)
- **npm**
- A **Neon** Postgres database (free tier is fine) with the `vector` extension available
- An **OpenAI** API key with access to `gpt-4o-mini` and `text-embedding-3-small`
- A **Vercel Blob** store (only required if you want uploads to work; the rest of the app runs without it)

### 1. Clone & install

```bash
git clone <this-repo> electrical-pdf-qa
cd electrical-pdf-qa
npm install
```

### 2. Create a Neon database

1. Sign in at <https://console.neon.tech> and click **New Project**.
2. Pick any region. Neon ships with `pgvector` preinstalled — you don't need to run `CREATE EXTENSION` manually, Prisma handles it.
3. Copy the **pooled** connection string from the dashboard. It looks like `postgresql://user:pw@host-pooler.region.aws.neon.tech/neondb?sslmode=require&channel_binding=require`.

### 3. Environment variables

Copy the example file and fill in the three values:

```bash
cp .env.example .env.local
```

```dotenv
# .env.local
DATABASE_URL="postgresql://<user>:<pw>@<host>-pooler.<region>.aws.neon.tech/neondb?sslmode=require&channel_binding=require"
OPENAI_API_KEY="sk-proj-…"
BLOB_READ_WRITE_TOKEN="vercel_blob_rw_…"
```

> **Prisma CLI tip:** Prisma reads `.env` (not `.env.local`) by default. Either duplicate `DATABASE_URL` into a `.env` file for CLI commands, or prefix every Prisma command with `DATABASE_URL="…" npx prisma …`.

### 4. Push the schema

```bash
npx prisma db push
```

This creates the `Session`, `Sheet`, `Chunk`, and `Message` tables, enables the `vector` extension, and generates the Prisma client. Re-run it any time you change `prisma/schema.prisma`.

### 5. Run the dev server

```bash
npm run dev
```

Open <http://localhost:3000>. You should see the **PunchZero** home page with an upload dropzone and an empty "Past sessions" list.

Upload a PDF drawing set and the app will:

1. Stream the file to Vercel Blob.
2. Run text extraction on every page (`pdf-parse` v2).
3. Regex-scan each page for `E-xxx` sheet numbers.
4. For any low-text pages, fall back to `gpt-4o-mini` vision on a rasterized page.
5. Chunk the extracted text, embed with `text-embedding-3-small`, and store vectors in pgvector.
6. Flip the session to `ready` and hand you a cover page + chat UI.

---

## Required README Answers

### 1. What stack did you use and why each piece?

- **Next.js 16 (App Router)** — full-stack React in one codebase: pages, streaming route handlers, server components, and a single deploy target. Deploys to Vercel with zero config, and the App Router's server components let me do the expensive PDF work on the server without shipping it to the client.
- **TypeScript** — everything from the vector-SQL helpers to the Chat client state machine is typed end-to-end, so refactors like "change how `citedSheets` flows through the stream" stay safe.
- **Tailwind CSS v4 + shadcn/ui (on Base UI)** — zero time wasted fighting CSS specificity, consistent tokens via `@theme` (brand + surface + mono fonts), and shadcn gives me a small curated set of accessible primitives (Button, Dialog, Badge, etc.) that I can restyle without an abstraction tax.
- **Postgres (Neon) + Prisma + pgvector** — one database for both the relational data (sessions, sheets, messages) and the vector embeddings. No second system to operate, no cross-store consistency problems. Neon's serverless pooler is a good fit for the read-heavy, burst-heavy pattern this app has.
- **OpenAI (`gpt-4o-mini` + `text-embedding-3-small`)** — `gpt-4o-mini` is ~15× cheaper than `gpt-4o` while being perfectly capable for retrieval-grounded answers, and `text-embedding-3-small` is the cheapest modern embedding model at $0.02/1M tokens. Both have the fast first-token latency chat UX depends on.
- **Vercel Blob** — same ecosystem as the app, one `put()` call, and blob URLs are persistent so I can re-process a PDF later without making the user re-upload.
- **`pdf-parse` v2 + `@napi-rs/canvas`** — `pdf-parse` v2 is a Node-first wrapper around `pdfjs-dist` that gives me both per-page text extraction *and* page rasterization from a single library. `@napi-rs/canvas` ships prebuilt binaries, so no native-compile headaches on macOS, Linux, or Vercel.

### 2. How did you identify electrical pages? What's your fallback?

Two passes, cheapest-first:

1. **Text-first regex pass.** Extract text per page with `pdf-parse`, then run a tiered regex (`/\bE-(\d{3,4})\b/`, `/\bE\.(\d{3,4})\b/`, `/\bE(\d{3,4})\b/`) against each page. I require 3–4 digits — two-digit matches produce too many false positives in mechanical/structural legends and grid labels. Every hit is canonicalized to `E-XXX`. On native-text PDFs this catches the sheets at literally zero API cost.

2. **Vision fallback for scanned pages.** Any page whose extracted text is under 100 characters (usually a scanned raster drawing or an image-heavy title page) is flagged as a vision candidate. For each one, I rasterize it via `pdf-parse`'s `getScreenshot({ partial, desiredWidth: 1200 })` (pdfjs-dist + `@napi-rs/canvas` under the hood), base64-encode the PNG, and ask `gpt-4o-mini` with JSON mode: "what's the sheet number in the title block, and if it starts with E, dump all the readable text on the page." The model's answer is fed back through the same canonicalizing regex so output is always `E-XXX` form.

Non-electrical sheets (cover pages, A-101, M-101, S-201, etc.) fall off naturally because neither pass produces an `E-` match.

### 3. How did you handle visual content (panel schedules, diagrams, symbols)?

A character-count threshold decides when a page goes to vision. On a typical scanned drawing set or panel-schedule page, pdfjs will only recover a handful of glyphs, and the vision model is asked to read and return "every readable label, note, schedule entry, panel tag, circuit reference, and specification on the page" as a single JSON string. That captured text goes into the same RAG pipeline as text-extracted content — the chunker, embedder, and retriever don't know or care which source it came from, so a question like "what's the rating of panel P1?" works whether P1 came from a native PDF text layer or a rasterized schedule.

I deliberately do **not** try to interpret graphical symbols (one-lines, schematic devices, etc.). The LLM handles natural-language reasoning over the surrounding text and labels, which is where 95% of answerable questions live in practice.

### 4. How did you think about LLM cost?

Three levers, in order of impact:

1. **Text-first, vision-fallback.** A 100-page drawing set with mostly native text costs ~$0 for Pass 1 plus ~$0.10–$0.20 for the handful of scanned pages in Pass 2. Vision-only would be ~$1.00 for the same PDF. This single heuristic is a ~5–10× cost reduction.
2. **Cheap model selection.** `gpt-4o-mini` at $0.15/1M input, $0.60/1M output, vs. `gpt-4o` at $2.50/$10. For retrieval-grounded answers the quality gap is tiny and the cost gap is ~15×. `text-embedding-3-small` at $0.02/1M is the cheapest modern embedding model.
3. **Retrieval before generation.** Top-5 chunks at ~2,000 chars each ≈ 2,500 tokens of grounding per query, rather than stuffing whole sheets into the prompt. A typical chat turn costs ~$0.0005 in, ~$0.001 out.

**Current cost per PDF:** ~$0.05 – $0.15 including upload, chunking, embedding, and a few exploratory chat turns.

**At 100 PDFs/day × 100+ pages each,** the next moves would be: (a) switch embeddings to the **Batch API** (50% cheaper, 24h turnaround is fine because the embeds happen during ingest, not chat), (b) cache assistant responses keyed on `(sessionId, normalized_query)` since many users ask the same things, (c) evaluate a local embedding model (e.g., `bge-small-en-v1.5` or `all-MiniLM-L6-v2`) running on the server to drop embedding cost to zero, and (d) pre-compute a per-sheet summary during ingest so retrieval can return summaries instead of raw chunks for broad questions.

### 5. What would break first under heavy load?

**The synchronous upload pipeline.** Right now `POST /api/upload` does blob storage → text extraction → regex ID → optional vision calls → chunking → embedding → DB writes inline, before it returns. On Vercel Pro that's a 300-second function budget; on Hobby it's 60 seconds. A 200-page scanned drawing set with 30+ vision calls will blow past both.

The fix is straightforward: move processing to a background worker (**Inngest** or **BullMQ + Redis**), have the upload route return `{ sessionId }` immediately after blob upload + session-row creation, and let the client poll `/api/session/[id]/status` for progress. The polling infrastructure and "processing" state machine are already wired up (the session page refetches every 2s and animates new sheets in as they land), so switching to an async backend is purely a server-side refactor.

**The second bottleneck is pgvector at scale.** At thousands of chunks, a sequential scan per query is fine. At millions, I'd add an `ivfflat` or `hnsw` index on `Chunk.embedding`, and when that's no longer enough, move to a dedicated vector store (Pinecone, Weaviate, or Qdrant) with a keyword prefilter on `sessionId`.

### 6. If you had one more week?

- **PDF page thumbnails on the cover page.** Render each identified sheet to a small image (the same `pdf-parse.getScreenshot` pipeline) so a user can visually confirm "yes, that's really E-201."
- **Inline PDF viewer.** When the assistant cites "Sheet E-201," make it a link that opens a split-pane with the actual page rendered on the right.
- **Batch processing to a queue** (see #5) — biggest reliability win.
- **Evaluation harness.** Drop the sample PDFs in a `fixtures/` folder, write a set of ground-truth Q&A pairs, and run a nightly eval script that measures retrieval recall and answer correctness. Gate PRs on the score.
- **Multi-PDF comparison.** "Compare the service sizes across Buildings A, B, and C."
- **Auth + workspaces.** Right now anyone with a session URL can read it — fine for a demo, not for a real deployment.

---

## Deployment

### Vercel

1. Push the repo to GitHub (or GitLab/Bitbucket).
2. In the Vercel dashboard, **Add New → Project**, pick the repo, keep the defaults (Next.js auto-detected).
3. In **Settings → Environment Variables**, add:
   - `DATABASE_URL` — the Neon pooled connection string
   - `OPENAI_API_KEY` — your OpenAI key
   - `BLOB_READ_WRITE_TOKEN` — from **Storage → Blob → Create Store** in the Vercel dashboard
   - Optionally, `NEXT_PUBLIC_SITE_URL` for canonical Open Graph URLs
4. Deploy. `next.config.ts` already externalizes the native PDF + canvas packages via `serverExternalPackages`, and `vercel.json` sets `maxDuration: 60` on the upload and chat routes.
5. After the first deploy, re-run `npx prisma db push` locally (pointed at the production `DATABASE_URL`) to ensure the schema is applied.

### Neon

1. **Create project** at <https://console.neon.tech>.
2. The `vector` extension is available by default on all tiers — Prisma will create it automatically when you run `db push` (the schema declares `extensions = [vector]`).
3. Copy the **pooled** connection string (the one with `-pooler` in the hostname) — the direct connection has a stricter per-project connection cap that Next.js serverless invocations can blow through.
4. Paste it into `.env.local` and into Vercel's env vars.

### Verifying the deploy

After the first production deploy, sanity check:

```bash
curl -o /dev/null -w "%{http_code}\n" https://<your-app>.vercel.app/
curl -o /dev/null -w "%{http_code}\n" https://<your-app>.vercel.app/api/session/00000000-0000-0000-0000-000000000000/status
```

The first should return `200`, the second `404`. Then upload a real PDF through the UI and confirm the cover page populates and the chat streams back a response with inline `E-XXX` citations.

---

## Project layout

```
src/
├─ app/
│  ├─ layout.tsx                  root layout, DM Sans + JetBrains Mono, full OG metadata
│  ├─ page.tsx                    home: upload zone + Suspense'd session list
│  ├─ loading.tsx                 route-level skeleton
│  ├─ error.tsx                   root error boundary
│  ├─ globals.css                 Tailwind v4 @theme tokens (brand, surface, fonts)
│  ├─ session/[id]/
│  │  ├─ page.tsx                 client component, polls status, renders cover + chat
│  │  ├─ loading.tsx              session route skeleton
│  │  └─ error.tsx                session-scoped error boundary
│  └─ api/
│     ├─ upload/route.ts          multipart upload + full ingest pipeline
│     └─ session/[id]/
│        ├─ route.ts              DELETE (cascades to sheets/chunks/messages)
│        ├─ status/route.ts       polling endpoint for session state
│        ├─ messages/route.ts     chat history fetch
│        └─ chat/route.ts         streaming RAG response
├─ lib/
│  ├─ db.ts                       Prisma singleton
│  ├─ utils.ts                    cn() tailwind merge helper
│  ├─ pdf/
│  │  ├─ extract.ts               extractTextPerPage, getPageCount
│  │  ├─ identify-sheets.ts       two-pass sheet identifier + vision fallback
│  │  └─ chunk.ts                 paragraph-aware chunker with overlap
│  └─ ai/
│     ├─ embeddings.ts            batch embed + pgvector raw SQL + cosine retrieval
│     └─ chat.ts                  RAG system prompt + streaming response + citation parsing
└─ components/
   ├─ upload-zone.tsx             drag-and-drop, state machine, progress
   ├─ session-list.tsx            server component + SessionListSkeleton export
   ├─ delete-session-button.tsx   confirmation dialog + DELETE call + router.refresh
   ├─ cover-page.tsx              presentational cover page with staggered sheet animations
   ├─ chat.tsx                    streaming chat, focus management, suggested questions
   ├─ message-bubble.tsx          user/assistant bubbles with inline citation badges
   └─ ui/                         shadcn primitives (Button, Dialog, Badge, …)
```

---

## Useful commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Next.js dev server on `:3000` |
| `npm run build` | Production build |
| `npm run start` | Start a production build |
| `npm run lint` | ESLint (flat config) |
| `npx tsc --noEmit` | Typecheck only (no emit) |
| `npx prisma studio` | Browse the DB in a local web UI |
| `npx prisma db push` | Sync the schema (create tables, enable `vector`) |
| `npx prisma generate` | Regenerate the Prisma client |

---

## License

Built for the PunchZero takehome.
