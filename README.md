# DocScope — AI Document Intelligence

Upload any PDF. Ask questions. Get answers with page-level citations.

DocScope is a full-stack document intelligence application that processes PDF uploads, extracts content using AI vision and text parsing, and provides a RAG-powered chat interface for natural-language Q&A grounded in the document's actual content.

## Live Demo

[docscope.vercel.app](https://docscope.vercel.app) _(or your actual URL)_

## Features

- **PDF Upload & Processing** — Upload any PDF up to 100MB. Pages are automatically analyzed and content is extracted.
- **Hybrid Extraction** — Text-heavy pages use fast text parsing. Image-heavy pages (diagrams, tables, charts) use GPT-4o-mini vision for accurate extraction.
- **RAG-Powered Chat** — Ask natural-language questions and get answers grounded in the document content with page-level citations.
- **Streaming Responses** — Real-time token streaming for responsive chat UX.
- **Session Persistence** — All uploads and conversations are saved. Revisit any document at any time.
- **Cost Optimized** — Text-first extraction minimizes API costs. Vision is used only where needed.

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Framework | Next.js 16 (App Router) | Full-stack React, API routes + SSR, one-click Vercel deploy |
| Language | TypeScript | Type safety across the entire stack |
| Styling | TailwindCSS + shadcn/ui | Rapid, consistent dark-theme UI |
| Database | PostgreSQL (Neon) + pgvector | Serverless Postgres with vector similarity search |
| ORM | Prisma | Type-safe queries with raw SQL escape hatch for vectors |
| LLM | OpenAI GPT-4o-mini | Best cost/quality ratio for RAG Q&A |
| Embeddings | text-embedding-3-small | Cheapest embedding model, 1536 dimensions |
| Vision | GPT-4o-mini vision | Extracts text from diagrams, charts, and image-heavy pages |
| File Storage | Vercel Blob | Client-side upload, no payload size limits |
| Deployment | Vercel | Serverless, auto-deploy on push |

## Architecture

```
Upload Flow:
Client → Vercel Blob (direct upload) → /api/upload → PDF parsing
→ Page-by-page extraction (text or vision) → Chunk + embed → pgvector

Chat Flow:
User question → Embed query → pgvector cosine similarity → Top-5 chunks
→ GPT-4o-mini with grounded system prompt → Streaming response → Citations
```

## Running Locally

```bash
git clone https://github.com/Oliver-Leonor/docscope.git
cd docscope
npm install
cp .env.example .env.local
# Fill in: DATABASE_URL, OPENAI_API_KEY, BLOB_READ_WRITE_TOKEN
npx prisma db push
npm run dev
```

Open <http://localhost:3000> and upload a PDF to try it.

## Key Architecture Decisions

See [DECISIONS.md](./DECISIONS.md) for detailed rationale on every technical choice.

## Author

**Oliver Leonor** — Full-Stack Software Engineer
- Portfolio: [minimal-portfolio-one.vercel.app](https://minimal-portfolio-one.vercel.app)
- GitHub: [github.com/Oliver-Leonor](https://github.com/Oliver-Leonor)
- LinkedIn: [linkedin.com/in/oliver-leonor-582706228](https://linkedin.com/in/oliver-leonor-582706228)
