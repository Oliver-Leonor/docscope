# DocScope — AI Document Intelligence

Upload any PDF. Ask questions. Get answers with page-level citations.

DocScope is a full-stack document intelligence application that processes PDF uploads, extracts content using AI vision and text parsing, and provides a RAG-powered chat interface for natural-language Q&A grounded in the document's actual content.

## Live Demo

https://electrical-pdf-qa.vercel.app/

## Features

- **PDF Upload & Processing** — Upload PDFs up to 4 MB (4,000,000 bytes), enforced by both the browser and server. The server also checks the PDF file signature before storage or processing. Each page is processed; only recovered text produces indexed chunks.
- **Hybrid Extraction** — Text parsing runs on every page. Pages with fewer than 200 recovered text characters use GPT-4o-mini vision as a fallback. This is a text-length heuristic, not image-content detection.
- **RAG-Powered Chat** — Ask natural-language questions about the document. The assistant is instructed to answer factual questions only from retrieved document content, cite source pages or sections, and say when the available content is insufficient instead of adding general-knowledge facts.
- **Streaming Responses** — Real-time token streaming for responsive chat UX.
- **Session Persistence** — All uploads and conversations are saved. Revisit any document at any time.
- **Cost Optimized** — Text-first extraction reduces vision calls by using the recovered-text-length threshold.

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Framework | Next.js 16 (App Router) | Full-stack React, API routes + SSR, one-click Vercel deploy |
| Language | TypeScript | Type safety across the entire stack |
| Styling | TailwindCSS + shadcn/ui | Rapid, consistent dark-theme UI |
| Database | PostgreSQL (Neon) + pgvector | Serverless Postgres with vector similarity search |
| ORM | Prisma | Type-safe queries with raw SQL escape hatch for vectors |
| LLM | OpenAI GPT-4o-mini | Used for document Q&A and vision extraction |
| Embeddings | text-embedding-3-small | 1536-dimensional embeddings for stored chunks and queries |
| Vision | GPT-4o-mini vision | Extracts text from diagrams, charts, and image-heavy pages |
| File Storage | Vercel Blob | Server uploads the PDF after receiving and validating the multipart request |
| Deployment | Vercel | Serverless, auto-deploy on push |

## Architecture

```
Upload Flow:
Browser → multipart POST /api/upload → Server receives and buffers PDF
→ Vercel Blob → Extraction (text or vision) → Chunking → Embeddings
→ PostgreSQL/pgvector → Response with sessionId → Session page

Chat Flow:
User question → Embed query → pgvector cosine similarity → Top-5 chunks
→ GPT-4o-mini with grounded system prompt → Streaming response → Citations
```

Processing runs synchronously before the upload response. The 4 MB file limit is deliberately conservative because the multipart request adds overhead. The upload route requests a maximum duration of 300 seconds; the live deployment's effective limit has not been verified. Completion time depends on document contents, extraction work, external APIs, and database latency. Larger-file support would be a future change using direct-to-object-storage uploads; that flow is not implemented here.

Answer grounding is guided by prompt instructions, which do not guarantee correctness or prevent the model from using outside knowledge. Citations are model-generated references, not independent verification. Retrieval uses the top five chunks, so missing information in those excerpts does not prove it is absent from the whole document.

## Running Locally

```bash
git clone https://github.com/Oliver-Leonor/docscope.git
cd docscope
npm install
cp .env.example .env
# Fill in: DATABASE_URL, OPENAI_API_KEY, BLOB_READ_WRITE_TOKEN
npx prisma db push
npm run dev
```

Open <http://localhost:3000> and upload a PDF to try it.

Both Prisma CLI and Next.js read the root `.env` file.

## Key Architecture Decisions

See [DECISIONS.md](./DECISIONS.md) for detailed rationale on every technical choice.

## Author

**Oliver Leonor** — Full-Stack Software Engineer
- Portfolio: [minimal-portfolio-one.vercel.app](https://minimal-portfolio-one.vercel.app)
- GitHub: [github.com/Oliver-Leonor](https://github.com/Oliver-Leonor)
- LinkedIn: [linkedin.com/in/oliver-leonor-582706228](https://linkedin.com/in/oliver-leonor-582706228)
