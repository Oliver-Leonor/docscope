import OpenAI from "openai"
import { PDFParse } from "pdf-parse"

import { withRetry } from "../ai/retry"
import { extractTextPerPage } from "./extract"

export interface IdentifiedSheet {
  pageIndex: number
  sheetNumber: string
  extractedText: string
  extractionMethod: "text" | "vision"
}

const VISION_MODEL = "gpt-4o-mini"
/**
 * Rasterization width for vision calls. 2000px is wide enough that small
 * schedule values, circuit numbers, and title-block callouts remain
 * legible to the model. 1200px — what we previously used for identification
 * — was enough to read title blocks but lost too much detail on panel
 * schedules and wire tables.
 */
const VISION_WIDTH = 2000
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
 *     Run pdf-parse text extraction on every page and regex-scan for
 *     `E-xxx`. Pages with a text match are immediately confirmed as
 *     electrical sheets. Pages with less than 100 characters of text
 *     and no match are queued as vision identification candidates
 *     (these are usually scanned/image-only drawings).
 *
 *   Phase 2 — CONTENT EXTRACTION (always vision).
 *     Every confirmed electrical sheet goes through a thorough
 *     `gpt-4o-mini` vision call at 2000px width. Construction drawings
 *     are inherently visual — panel schedules, single-line diagrams,
 *     equipment schedules, wire tables, and title-block notes are
 *     rendered as graphics, not selectable text, so pdf-parse recovers
 *     almost nothing useful from them. pdf-parse's text layer is good
 *     enough to *find* which pages are electrical (the sheet number
 *     itself is usually in the vector layer) but not to *understand*
 *     them. Accepting the vision cost (~$0.01–$0.02/page, ~$0.10–$0.20
 *     for a typical 7-sheet set) is well worth the accuracy gain.
 *
 * Vision calls are run in parallel via `Promise.all` so the wall-clock
 * cost scales with the slowest single sheet instead of the total
 * sheet count. Rasterization is batched into a single pdf-parse pass
 * so pdfjs-dist + @napi-rs/canvas are only set up once per upload.
 *
 * Every returned sheet is marked `extractionMethod: "vision"` unless a
 * specific vision call failed — in which case we gracefully fall back
 * to whatever pdf-parse recovered and mark that one sheet as `"text"`
 * so the cover page shows the user what happened.
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
  // text-confirmed sheets with whatever pdf-parse recovered, and drop
  // vision candidates entirely.
  if (!process.env.OPENAI_API_KEY) {
    console.warn(
      "[identify-sheets] OPENAI_API_KEY not set — skipping vision extraction, " +
        "falling back to pdf-parse text for content",
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

  // Rasterize every page we need in a single pdf-parse pass.
  const pagesToRasterize = Array.from(
    new Set([
      ...textConfirmed.map((t) => t.pageIndex),
      ...visionCandidates,
    ]),
  ).sort((a, b) => a - b)
  const rasterized = await rasterizePages(pdfBuffer, pagesToRasterize)

  const openai = new OpenAI()

  // Phase 2a: thorough content extraction for text-confirmed sheets.
  const contentPromises = textConfirmed.map(
    async ({ pageIndex, sheetNumber }): Promise<IdentifiedSheet> => {
      const base64 = rasterized.get(pageIndex)
      if (!base64) {
        // Rasterization failed for this page — fall back to pdf-parse text.
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
          base64,
          sheetNumber,
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
      const base64 = rasterized.get(pageIndex)
      if (!base64) return null
      try {
        const result = await visionIdentifyAndExtract(base64, openai)
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
 * Rasterize a set of PDF pages in a single pdf-parse pass at
 * `VISION_WIDTH`. Returns a map of 0-indexed `pageIndex` → base64 PNG
 * string, ready to drop into an OpenAI vision `image_url` data URL.
 *
 * pdf-parse's `getScreenshot` accepts `partial: number[]` of 1-indexed
 * page numbers and returns `{ pages: Screenshot[] }` where each page has
 * its own `pageNumber`. We translate back to 0-indexed for the map key
 * so callers can match against the identifier in our schema.
 */
async function rasterizePages(
  pdfBuffer: Buffer,
  pageIndices: number[],
): Promise<Map<number, string>> {
  if (pageIndices.length === 0) return new Map()

  const parser = new PDFParse({ data: new Uint8Array(pdfBuffer) })
  try {
    const shot = await parser.getScreenshot({
      partial: pageIndices.map((i) => i + 1),
      desiredWidth: VISION_WIDTH,
      imageBuffer: true,
      imageDataUrl: false,
    })
    const out = new Map<number, string>()
    for (const page of shot.pages) {
      if (page?.data?.byteLength) {
        out.set(
          page.pageNumber - 1,
          Buffer.from(page.data).toString("base64"),
        )
      }
    }
    return out
  } finally {
    await parser.destroy().catch(() => {})
  }
}

/**
 * Thorough content extraction on a page we already know is electrical.
 * The prompt names the sheet number inline so the model has context for
 * where values like panel tags and circuit numbers "belong."
 *
 * Returns the raw extracted text (possibly empty if the model has
 * nothing to report). Throws on API errors so the caller can degrade
 * gracefully to pdf-parse text for this one sheet.
 */
async function visionExtractContent(
  base64: string,
  sheetNumber: string,
  openai: OpenAI,
): Promise<string> {
  const prompt = `This is an electrical construction drawing (Sheet ${sheetNumber}). Extract ALL readable text, labels, values, specifications, and data from this drawing. Include:
${EXTRACTION_CHECKLIST}

Format the extracted content as structured text, preserving table structures where possible. Be thorough — capture every piece of readable text on the sheet.`

  const response = await withRetry(() =>
    openai.chat.completions.create({
      model: VISION_MODEL,
      max_tokens: VISION_MAX_TOKENS,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            {
              type: "image_url",
              image_url: {
                url: `data:image/png;base64,${base64}`,
                detail: "high",
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
 * Combined identify + extract for pages where pdf-parse recovered too
 * little text for the regex pass. The model is asked to read the title
 * block first and only produce extracted content when the sheet number
 * starts with `E`. Uses JSON mode so the reply is machine-parseable.
 *
 * Sheet numbers returned by the model are re-run through
 * `findSheetNumber` to enforce canonical `E-XXX` form.
 */
async function visionIdentifyAndExtract(
  base64: string,
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
      max_tokens: VISION_MAX_TOKENS,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            {
              type: "image_url",
              image_url: {
                url: `data:image/png;base64,${base64}`,
                detail: "high",
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
