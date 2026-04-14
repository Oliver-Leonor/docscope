export interface TextChunk {
  content: string
  sectionLabel: string
}

/**
 * Split extracted page text into overlapping chunks ready for embedding.
 *
 * Strategy:
 *   - Target ~500 tokens / ~2000 chars per chunk.
 *   - 200-char overlap between adjacent chunks so context isn't severed
 *     mid-sentence at chunk boundaries.
 *   - Prefer splitting on blank-line paragraph boundaries; fall back to
 *     a hard character window when a single paragraph is larger than the
 *     target budget.
 *   - Every chunk is prefixed with `[{sectionLabel}]` (e.g. `[Page 5]`
 *     or `[A-201]`) so that the LLM sees the source page inline when
 *     the chunk is retrieved, even without extra metadata plumbing.
 *
 * Why 500 tokens: small enough for precise retrieval, large enough to
 * carry meaningful context. At query time we retrieve top-5 chunks,
 * giving ~2,500 tokens of grounding — plenty of headroom in a modern
 * chat model context window.
 */
export function chunkText(text: string, sectionLabel: string): TextChunk[] {
  const TARGET = 2000
  const OVERLAP = 200

  const cleaned = normalize(text)
  if (!cleaned) return []

  // Split on blank-line paragraph boundaries, then also split on single
  // newlines if paragraphs aren't giving us enough granularity.
  const rawSegments = cleaned.split(/\n\s*\n+/)
  const segments: string[] = []
  for (const seg of rawSegments) {
    const trimmed = seg.trim()
    if (!trimmed) continue
    if (trimmed.length <= TARGET) {
      segments.push(trimmed)
    } else {
      // Further break huge paragraphs on single newlines before the
      // hard window kicks in.
      const subs = trimmed.split(/\n+/).map((s) => s.trim()).filter(Boolean)
      if (subs.length > 1) {
        segments.push(...subs)
      } else {
        segments.push(trimmed)
      }
    }
  }

  // Pack segments into chunks, greedily filling up to TARGET.
  const packed: string[] = []
  let current = ""
  for (const seg of segments) {
    if (!current) {
      current = seg
      continue
    }
    if (current.length + 1 + seg.length <= TARGET) {
      current += "\n" + seg
    } else {
      packed.push(current)
      // Carry OVERLAP chars of context forward into the next chunk.
      const tail = current.slice(-OVERLAP)
      current = tail.length && !seg.startsWith(tail) ? tail + "\n" + seg : seg
    }
  }
  if (current) packed.push(current)

  // Any single packed chunk still above the ceiling gets hard-windowed.
  const windowed: string[] = []
  for (const chunk of packed) {
    if (chunk.length <= TARGET * 1.2) {
      windowed.push(chunk)
      continue
    }
    let start = 0
    const step = TARGET - OVERLAP
    while (start < chunk.length) {
      windowed.push(chunk.slice(start, start + TARGET))
      if (start + TARGET >= chunk.length) break
      start += step
    }
  }

  return windowed.map((content) => ({
    content: `[${sectionLabel}] ${content}`,
    sectionLabel,
  }))
}

/**
 * Collapse runs of whitespace and normalize newlines so chunking behaves
 * predictably on messy PDF text output.
 */
function normalize(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}
