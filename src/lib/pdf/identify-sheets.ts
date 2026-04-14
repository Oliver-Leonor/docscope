import OpenAI from "openai"
import { PDFDocument } from "pdf-lib"

import { withRetry } from "../ai/retry"
import { extractTextPerPage } from "./extract"

export interface IdentifiedSection {
  pageIndex: number
  sectionLabel: string
  extractedText: string
  extractionMethod: "text" | "vision"
}

/** Back-compat alias — the rest of the pipeline still reads `sheetNumber`. */
export type IdentifiedSheet = IdentifiedSection

const VISION_MODEL = "gpt-4o-mini"
const VISION_MAX_TOKENS = 4000
const TEXT_ONLY_MIN_CHARS = 200

/**
 * Detects construction-style section prefixes found in drawing title
 * blocks — Architectural (A), Structural (S), Mechanical (M), Plumbing
 * (P), Electrical (E), Civil (C), Landscape (L). Accepts dashed
 * (`A-201`), dotted (`A.201`), and joined (`A201`) forms, all 1–4 digit
 * suffixes. Two-digit matches are allowed because this is a display
 * label, not a filter — the worst case is a false positive label that
 * the user can see on the cover page.
 */
const SECTION_PREFIX_RE = /\b([ASMPECL])[-.]?(\d{1,4})\b/

/**
 * Process every page of an uploaded PDF and return a labeled, extracted
 * section for each one.
 *
 * DocScope works on any PDF, so the strategy is:
 *
 *   1. Text extract every page with unpdf (free, fast, runs anywhere).
 *   2. For pages with reasonable text content (>= 200 chars), keep the
 *      text layer as-is and scan it for a recognizable section prefix
 *      (A-201, E-101, etc.). If none is found, label it "Page N".
 *   3. For pages with little or no text (scanned drawings, image-only
 *      title pages, photo PDFs), send the single-page PDF to
 *      gpt-4o-mini for vision extraction and label it by whatever the
 *      text recovery found, or fall back to "Page N".
 *
 * Every page of the uploaded PDF ends up represented in the output,
 * sorted by page index. Nothing is filtered out: if a user uploads a
 * 10-page PDF, they see 10 processed pages on the cover and can ask
 * questions that span any of them.
 *
 * Vision calls run in parallel via `Promise.all` so wall-clock time
 * scales with the slowest page, not the total page count.
 */
export async function identifyDocumentSections(
  pdfBuffer: Buffer,
): Promise<IdentifiedSection[]> {
  const pages = await extractTextPerPage(pdfBuffer)
  if (pages.length === 0) return []

  const visionCandidates: number[] = []
  const textEntries: IdentifiedSection[] = []

  for (const { pageIndex, text } of pages) {
    if (text.length >= TEXT_ONLY_MIN_CHARS) {
      textEntries.push({
        pageIndex,
        sectionLabel: findSectionLabel(text) ?? `Page ${pageIndex + 1}`,
        extractedText: text,
        extractionMethod: "text",
      })
    } else {
      visionCandidates.push(pageIndex)
    }
  }

  // No OpenAI key: skip vision entirely and mark any sparse pages with
  // whatever text we recovered (even if short). The UI still shows them.
  if (!process.env.OPENAI_API_KEY) {
    if (visionCandidates.length > 0) {
      console.warn(
        "[identify-sections] OPENAI_API_KEY not set — skipping vision, " +
          "falling back to text-layer extraction for every page",
      )
    }
    const fallback = visionCandidates.map((pageIndex): IdentifiedSection => {
      const raw = pages.find((p) => p.pageIndex === pageIndex)?.text ?? ""
      return {
        pageIndex,
        sectionLabel: findSectionLabel(raw) ?? `Page ${pageIndex + 1}`,
        extractedText: raw,
        extractionMethod: "text",
      }
    })
    return [...textEntries, ...fallback].sort(
      (a, b) => a.pageIndex - b.pageIndex,
    )
  }

  const singlePagePdfs = await extractPagesAsPdfDataUris(
    pdfBuffer,
    visionCandidates,
  )
  const openai = new OpenAI()

  const visionPromises = visionCandidates.map(
    async (pageIndex): Promise<IdentifiedSection> => {
      const dataUri = singlePagePdfs.get(pageIndex)
      const fallbackText =
        pages.find((p) => p.pageIndex === pageIndex)?.text ?? ""
      const fallbackLabel =
        findSectionLabel(fallbackText) ?? `Page ${pageIndex + 1}`

      if (!dataUri) {
        return {
          pageIndex,
          sectionLabel: fallbackLabel,
          extractedText: fallbackText,
          extractionMethod: "text",
        }
      }
      try {
        const { sectionLabel, extractedText } = await visionExtractPage(
          dataUri,
          pageIndex,
          openai,
        )
        return {
          pageIndex,
          sectionLabel: sectionLabel ?? fallbackLabel,
          extractedText,
          extractionMethod: "vision",
        }
      } catch (err) {
        console.error(
          `[identify-sections] vision extract failed for page ${pageIndex}:`,
          err,
        )
        return {
          pageIndex,
          sectionLabel: fallbackLabel,
          extractedText: fallbackText,
          extractionMethod: "text",
        }
      }
    },
  )

  const visionEntries = await Promise.all(visionPromises)

  return [...textEntries, ...visionEntries].sort(
    (a, b) => a.pageIndex - b.pageIndex,
  )
}

/**
 * Find a construction-style section label (A-201, E-101, S-101, …) in
 * a page's text. Returns `null` when nothing matches so the caller can
 * fall back to a generic "Page N" label.
 *
 * All three spacings (dashed, dotted, joined) are normalized to the
 * canonical dashed form so downstream display and retrieval stay
 * consistent.
 */
export function findSectionLabel(text: string): string | null {
  if (!text) return null
  const m = SECTION_PREFIX_RE.exec(text)
  if (!m) return null
  return `${m[1].toUpperCase()}-${m[2]}`
}

/**
 * Split a multi-page PDF into a map of `pageIndex` → single-page PDF
 * encoded as a `data:application/pdf;base64,...` URI, ready to feed to
 * an OpenAI `type: "file"` content block. Pure JS via `pdf-lib`, so it
 * runs inside Vercel serverless with no native dependencies.
 */
async function extractPagesAsPdfDataUris(
  pdfBuffer: Buffer,
  pageIndices: number[],
): Promise<Map<number, string>> {
  if (pageIndices.length === 0) return new Map()

  const srcDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true })
  const out = new Map<number, string>()

  for (const pageIndex of pageIndices) {
    try {
      const pageDoc = await PDFDocument.create()
      const [copied] = await pageDoc.copyPages(srcDoc, [pageIndex])
      pageDoc.addPage(copied)
      const dataUri = await pageDoc.saveAsBase64({ dataUri: true })
      out.set(pageIndex, dataUri)
    } catch (err) {
      console.error(
        `[identify-sections] failed to extract page ${pageIndex} as PDF:`,
        err,
      )
    }
  }

  return out
}

/**
 * Vision extraction for a single page. Sends the page PDF to
 * `gpt-4o-mini` via OpenAI's native PDF `type: "file"` input and asks
 * the model to:
 *   - Identify the section label from the title block (if any).
 *   - Extract every readable piece of text, data, label, and value on
 *     the page, preserving table structure.
 *
 * Returns the parsed JSON. Throws on API errors so the caller can
 * gracefully fall back to text-layer recovery for this page.
 */
async function visionExtractPage(
  pdfDataUri: string,
  pageIndex: number,
  openai: OpenAI,
): Promise<{ sectionLabel: string | null; extractedText: string }> {
  const prompt = `This is one page of a PDF document. Extract ALL readable content from it as thoroughly as possible:
- Any title, header, or section label at the top of the page or in a title block
- Body text, paragraphs, and notes
- Table contents (preserve row/column structure as best you can)
- Labels, values, numbers, and annotations on diagrams, charts, or drawings
- Callouts and legend entries

Respond with a single JSON object in this exact shape:
{"sectionLabel": string | null, "extractedText": string}

- Set sectionLabel to a short identifying label for this page if one is clearly visible (e.g. "A-201", "E-101", "Chapter 3", "Section 4.2", "Introduction"). Otherwise set it to null and a generic "Page N" label will be used.
- Fill extractedText with the thorough content described above. Be exhaustive — capture every piece of readable text on the page, even if it seems incidental.`

  const response = await withRetry(() =>
    openai.chat.completions.create({
      model: VISION_MODEL,
      max_completion_tokens: VISION_MAX_TOKENS,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            {
              type: "file",
              file: {
                filename: `page-${pageIndex + 1}.pdf`,
                file_data: pdfDataUri,
              },
            },
          ],
        },
      ],
    }),
  )

  const raw = response.choices[0]?.message?.content ?? "{}"
  let parsed: { sectionLabel?: unknown; extractedText?: unknown }
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { sectionLabel: null, extractedText: "" }
  }

  const rawLabel =
    typeof parsed.sectionLabel === "string" ? parsed.sectionLabel.trim() : ""
  const extractedText =
    typeof parsed.extractedText === "string" ? parsed.extractedText : ""

  const normalized = rawLabel ? findSectionLabel(rawLabel) ?? rawLabel : null
  return { sectionLabel: normalized, extractedText }
}
