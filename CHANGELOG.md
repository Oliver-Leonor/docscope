# Changelog

## Interview-readiness cleanup

- Enforced a shared 4 MB (4,000,000-byte) upload limit in the browser and server, with a server-side PDF signature check before storage or processing.
- Documented the existing multipart server upload and synchronous processing flow. Kept the upload route's requested 300-second maximum and removed its conflicting `vercel.json` entry.
- Updated the chat prompt to instruct the model to support factual answers with retrieved document content and acknowledge insufficient information; this does not guarantee compliance or correctness.
- Session deletion now deletes the uploaded Vercel Blob before cascading database deletion; a Blob failure preserves the session for retry.
- Corrected extraction, indexing, progress, API type-safety, and local environment setup claims.
- Removed unsupported performance, cost, and recall claims; distinguished informal development observations from reproducible benchmarks.

## DocScope — General-purpose document intelligence

Rebranded and generalized from a construction-drawing-specific prototype into a general-purpose PDF Q&A tool. Key changes:

- **General section detection** — Replaced the electrical-sheet-only (E-xxx) regex filter with a broader prefix detector that recognizes construction section labels (A/S/M/P/E/C/L) and falls back to `Page N` labels for everything else. Processing attempts every page; only recovered text produces indexed chunks. Vision may also supply a descriptive section label.
- **Generalized chat prompt** — Changed the assistant persona from an electrical engineer to a general document analyst that cites pages and sections. This version allowed clearly distinguished general knowledge; the interview-readiness cleanup above changes the instructions to request factual answers from retrieved document content only.
- **Citation parsing** — Server-side and client-side citation extractors now recognize both `Page N` and construction-style section labels; they share identical regex definitions.
- **Brand refresh** — UI copy, metadata, and CSS namespace updated to DocScope. The dark theme, design tokens, streaming chat UX, and cover-page-then-chat pattern are unchanged.
- **Portfolio README + DECISIONS.md** — Rewritten as a portfolio-style project write-up.

## Visual polish pass

Refined dark-theme design system with semantic surface / border / brand tokens, a four-tier depth scale, and reusable animation utilities (`ds-fade-in`, `ds-lift`, `ds-soft-pulse`, `ds-cursor`, `ds-scroll`). Chat uses a streaming cursor and live citation parsing so the Sources footer populates while tokens stream in.
