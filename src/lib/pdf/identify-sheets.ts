import OpenAI from "openai"
import { PDFDocument } from "pdf-lib"

import { withRetry } from "../ai/retry"
import { extractTextPerPage } from "./extract"

export interface IdentifiedSheet {
  pageIndex: number
  sheetNumber: string
  extractedText: string
  extractionMethod: "text" | "vision"
}

const VISION_MODEL = "gpt-4o-mini"
const VISION_MAX_TOKENS = 4000

/**
 * Checklist of things to extract on an electrical sheet. Used by both
 * content extraction and combined identify+extract prompts so they stay
 * consistent.
 */
const EXTRACTION_CHECKLIST = `- Panel schedule data (panel names, ratings, circuit numbers, breaker sizes, loads)
- Equipment specifications (voltage, amperage, phase, wire sizes)
- Notes and general notes sections
- Title block information
- Conduit and wire specifications
- Any schedules or tables with their complete data
- Legend and symbol descriptions
- All annotations and callouts`

/**
 * Identify the electrical sheets in a construction drawing PDF and pull
 * their full content out via vision.
 *
 * The strategy has two phases, but they serve different goals:
 *
 *   Phase 1 — IDENTIFICATION (cheap text-based).
 *     Run unpdf text extraction on every page and regex-scan for
 *     `E-xxx`. Pages with a text match are immediately confirmed as
 *     electrical sheets. Pages with less than 100 characters of text
 *     and no match are queued as vision identification candidates
 *     (these are usually scanned/image-only drawings).
 *
 *   Phase 2 — CONTENT EXTRACTION (always vision).
 *     Every confirmed electrical sheet is split out as its own
 *     single-page PDF and sent to `gpt-4o-mini` via OpenAI's native
 *     PDF file input. The model gets BOTH the embedded text layer and
 *     a high-resolution rendering of the page, so it can read panel
 *     schedules, single-line diagrams, equipment schedules, wire
 *     tables, and title-block notes that are rendered as graphics
 *     (which our text-only pass can't recover). Accepting the vision
 *     cost (~$0.01–$0.02/page, ~$0.10–$0.20 for a typical 7-sheet set)
 *     is well worth the accuracy gain.
 *
 * Why send PDFs instead of rasterizing first:
 *   - Vercel serverless has no `DOMMatrix` / `Path2D` / `ImageData`,
 *     so anything that tries to render PDF.js into a canvas blows up
 *     at module load. `pdf-img-convert`, raw `pdfjs-dist`, and
 *     `pdf-parse`'s `getScreenshot` all fail in that environment.
 *   - OpenAI's chat completions API accepts `type: "file"` content
 *     parts with a base64 `data:application/pdf;base64,...` payload
 *     and renders pages internally on a vision-capable model
 *     (`gpt-4o`, `gpt-4o-mini`, `o1`). That moves the rasterization
 *     out of our serverless function entirely.
 *   - Single-page PDF extraction with `pdf-lib` is pure JS, has no
 *     native deps, and works on any runtime.
 *
 * Vision calls are run in parallel via `Promise.all` so the wall-clock
 * cost scales with the slowest single sheet instead of the total
 * sheet count.
 *
 * Every returned sheet is marked `extractionMethod: "vision"` unless a
 * specific vision call failed — in which case we gracefully fall back
 * to whatever unpdf recovered and mark that one sheet as `"text"` so
 * the cover page shows the user what happened.
 */
export async function identifyElectricalSheets(
  pdfBuffer: Buffer,
): Promise<IdentifiedSheet[]> {
  const pages = await extractTextPerPage(pdfBuffer)

  // Phase 1: text regex identification.
  const textConfirmed: Array<{ pageIndex: number; sheetNumber: string }> = []
  const visionCandidates: number[] = []
  for (const { pageIndex, text } of pages) {
    const sheetNumber = findSheetNumber(text)
    if (sheetNumber) {
      textConfirmed.push({ pageIndex, sheetNumber })
      continue
    }
    // Low/no text → likely a scanned raster; try to identify via vision.
    if (text.length < 100) {
      visionCandidates.push(pageIndex)
    }
  }

  if (textConfirmed.length === 0 && visionCandidates.length === 0) {
    return []
  }

  // Graceful degradation when no OpenAI key is configured: return the
  // text-confirmed sheets with whatever unpdf recovered, and drop
  // vision candidates entirely.
  if (!process.env.OPENAI_API_KEY) {
    console.warn(
      "[identify-sheets] OPENAI_API_KEY not set — skipping vision extraction, " +
        "falling back to text-layer extraction for content",
    )
    return textConfirmed
      .map(({ pageIndex, sheetNumber }) => ({
        pageIndex,
        sheetNumber,
        extractedText:
          pages.find((p) => p.pageIndex === pageIndex)?.text ?? "",
        extractionMethod: "text" as const,
      }))
      .sort((a, b) => a.pageIndex - b.pageIndex)
  }

  // Split out every page we need as its own single-page PDF (base64
  // data URI), ready to drop straight into an OpenAI `type: "file"`
  // content part.
  const pagesToExtract = Array.from(
    new Set([
      ...textConfirmed.map((t) => t.pageIndex),
      ...visionCandidates,
    ]),
  ).sort((a, b) => a - b)
  const singlePagePdfs = await extractPagesAsPdfDataUris(
    pdfBuffer,
    pagesToExtract,
  )

  const openai = new OpenAI()

  // Phase 2a: thorough content extraction for text-confirmed sheets.
  const contentPromises = textConfirmed.map(
    async ({ pageIndex, sheetNumber }): Promise<IdentifiedSheet> => {
      const dataUri = singlePagePdfs.get(pageIndex)
      if (!dataUri) {
        // Page extraction failed — fall back to text-layer text.
        return {
          pageIndex,
          sheetNumber,
          extractedText:
            pages.find((p) => p.pageIndex === pageIndex)?.text ?? "",
          extractionMethod: "text",
        }
      }
      try {
        const extractedText = await visionExtractContent(
          dataUri,
          sheetNumber,
          pageIndex,
          openai,
        )
        return {
          pageIndex,
          sheetNumber,
          extractedText,
          extractionMethod: "vision",
        }
      } catch (err) {
        console.error(
          `[identify-sheets] vision extract failed for ${sheetNumber} (page ${pageIndex}):`,
          err,
        )
        return {
          pageIndex,
          sheetNumber,
          extractedText:
            pages.find((p) => p.pageIndex === pageIndex)?.text ?? "",
          extractionMethod: "text",
        }
      }
    },
  )

  // Phase 2b: combined identify + extract for vision-only candidates.
  const candidatePromises = visionCandidates.map(
    async (pageIndex): Promise<IdentifiedSheet | null> => {
      const dataUri = singlePagePdfs.get(pageIndex)
      if (!dataUri) return null
      try {
        const result = await visionIdentifyAndExtract(
          dataUri,
          pageIndex,
          openai,
        )
        if (!result.sheetNumber) return null
        return {
          pageIndex,
          sheetNumber: result.sheetNumber,
          extractedText: result.extractedText,
          extractionMethod: "vision",
        }
      } catch (err) {
        console.error(
          `[identify-sheets] vision identify failed for page ${pageIndex}:`,
          err,
        )
        return null
      }
    },
  )

  const settled = await Promise.all([...contentPromises, ...candidatePromises])

  return settled
    .filter((r): r is IdentifiedSheet => r !== null)
    .sort((a, b) => a.pageIndex - b.pageIndex)
}

/**
 * Find an electrical sheet number in a blob of text.
 *
 * Looks for the conventions used on real drawings (most specific first):
 *   1. Dashed: `E-101`, `E-201`, `E-501`, `E-1001`
 *   2. Dotted: `E.101`
 *   3. No separator: `E101`, `E001`
 *
 * Always 3–4 digits — 2-digit matches produce too many false positives
 * ("E01" often appears in mechanical legends, grid labels, etc.).
 *
 * The returned value is normalized to canonical `E-XXX` form so that
 * "E101", "E-101", and "E.101" all collapse to the same sheet record.
 */
export function findSheetNumber(text: string): string | null {
  if (!text) return null

  const dashed = /\bE-(\d{3,4})\b/i.exec(text)
  if (dashed) return `E-${dashed[1]}`

  const dotted = /\bE\.(\d{3,4})\b/i.exec(text)
  if (dotted) return `E-${dotted[1]}`

  const noSep = /\bE(\d{3,4})\b/.exec(text)
  if (noSep) return `E-${noSep[1]}`

  return null
}

/**
 * Split a multi-page PDF into a map of `pageIndex` → single-page PDF
 * encoded as a `data:application/pdf;base64,...` URI, ready to feed to
 * an OpenAI `type: "file"` content block.
 *
 * Uses `pdf-lib` (pure JS, no native deps) so it runs cleanly inside a
 * Vercel serverless function — no canvas, no DOMMatrix, no WASM. We
 * load the source document once and copy each requested page into its
 * own throwaway `PDFDocument`, then base64-encode that page-PDF.
 *
 * Per-page failures are isolated so one corrupt page can't take down
 * the whole upload — a missing entry in the returned map causes the
 * caller to fall back to the page's text-layer extraction.
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
        `[identify-sheets] failed to extract page ${pageIndex} as PDF:`,
        err,
      )
    }
  }

  return out
}

/**
 * Thorough content extraction on a page we already know is electrical.
 * Sends the single-page PDF to `gpt-4o-mini` via OpenAI's native PDF
 * `type: "file"` input — the model receives both the embedded text
 * layer and a vision rendering of the page, which is what we need to
 * read panel schedules, schedules, and title-block notes.
 *
 * The prompt names the sheet number inline so the model has context
 * for where values like panel tags and circuit numbers "belong."
 *
 * Returns the raw extracted text (possibly empty if the model has
 * nothing to report). Throws on API errors so the caller can degrade
 * gracefully to text-layer extraction for this one sheet.
 */
async function visionExtractContent(
  pdfDataUri: string,
  sheetNumber: string,
  pageIndex: number,
  openai: OpenAI,
): Promise<string> {
  const prompt = `This is an electrical construction drawing (Sheet ${sheetNumber}). Extract ALL readable text, labels, values, specifications, and data from this drawing. Include:
${EXTRACTION_CHECKLIST}

Format the extracted content as structured text, preserving table structures where possible. Be thorough — capture every piece of readable text on the sheet.`

  const response = await withRetry(() =>
    openai.chat.completions.create({
      model: VISION_MODEL,
      max_completion_tokens: VISION_MAX_TOKENS,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            {
              type: "file",
              file: {
                filename: `sheet-${pageIndex + 1}.pdf`,
                file_data: pdfDataUri,
              },
            },
          ],
        },
      ],
    }),
  )

  return response.choices[0]?.message?.content ?? ""
}

/**
 * Combined identify + extract for pages where the text layer recovered
 * too little to run the regex pass. The model is asked to read the
 * title block first and only produce extracted content when the sheet
 * number starts with `E`. Uses JSON mode so the reply is
 * machine-parseable.
 *
 * Sheet numbers returned by the model are re-run through
 * `findSheetNumber` to enforce canonical `E-XXX` form.
 */
async function visionIdentifyAndExtract(
  pdfDataUri: string,
  pageIndex: number,
  openai: OpenAI,
): Promise<{ sheetNumber: string | null; extractedText: string }> {
  const prompt = `This is a construction drawing. First, look at the title block and determine the sheet number. Then, if and only if the sheet number starts with the letter E (indicating an electrical sheet), extract ALL readable text, labels, values, specifications, and data from the drawing. Include:
${EXTRACTION_CHECKLIST}

Respond with a single JSON object in this exact shape:
{"sheetNumber": string | null, "extractedText": string}

- Set sheetNumber to the canonical form (e.g. "E-101") only if this is an electrical sheet. For non-electrical sheets (A-, S-, M-, P-, cover pages, etc.) set it to null.
- When it IS electrical, fill extractedText with the thorough content described above, preserving table structures where possible. Be thorough — capture every piece of readable text on the sheet.
- When it is NOT electrical, set extractedText to an empty string.`

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
                filename: `sheet-${pageIndex + 1}.pdf`,
                file_data: pdfDataUri,
              },
            },
          ],
        },
      ],
    }),
  )

  const raw = response.choices[0]?.message?.content ?? "{}"
  let parsed: { sheetNumber?: unknown; extractedText?: unknown }
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { sheetNumber: null, extractedText: "" }
  }

  const rawSheetNumber =
    typeof parsed.sheetNumber === "string" ? parsed.sheetNumber : null
  const extractedText =
    typeof parsed.extractedText === "string" ? parsed.extractedText : ""

  // Normalize through the same regex so model output is always canonical.
  const normalized = rawSheetNumber ? findSheetNumber(rawSheetNumber) : null
  return { sheetNumber: normalized, extractedText }
}
