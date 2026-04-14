# Changelog

## DocScope — General-purpose document intelligence

Rebranded and generalized from a construction-drawing-specific prototype into a general-purpose PDF Q&A tool. Key changes:

- **General section detection** — Replaced the electrical-sheet-only (E-xxx) regex filter with a broader prefix detector that recognizes construction section labels (A/S/M/P/E/C/L) and falls back to `Page N` labels for everything else. All pages of every uploaded PDF are now processed and indexed.
- **Generalized chat prompt** — The assistant persona is now a general document analyst that cites pages and sections, not an electrical engineer. System prompt instructs the model to cite exact pages/sections and clearly distinguish document content from general knowledge.
- **Citation parsing** — Server-side and client-side citation extractors now recognize both `Page N` and construction-style section labels; they share identical regex definitions.
- **Brand refresh** — UI copy, metadata, and CSS namespace updated to DocScope. The dark theme, design tokens, streaming chat UX, and cover-page-then-chat pattern are unchanged.
- **Portfolio README + DECISIONS.md** — Rewritten as a portfolio-style project write-up.

## Visual polish pass

Refined dark-theme design system with semantic surface / border / brand tokens, a four-tier depth scale, and reusable animation utilities (`ds-fade-in`, `ds-lift`, `ds-soft-pulse`, `ds-cursor`, `ds-scroll`). Chat uses a streaming cursor and live citation parsing so the Sources footer populates while tokens stream in.
