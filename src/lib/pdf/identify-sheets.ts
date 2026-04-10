import OpenAI from "openai"
import { PDFParse } from "pdf-parse"

import { extractTextPerPage } from "./extract"

export interface IdentifiedSheet {
  pageIndex: number
  sheetNumber: string
  extractedText: string
  extractionMethod: "text" | "vision"
}

/**
 * Identify the electrical sheets in a construction drawing PDF.
 *
 * Two-pass strategy:
 *
 *   Pass 1 (cheap): run native text extraction across every page and scan
 *     each page's text with {@link findSheetNumber}. Anything matching the
 *     E-xxx pattern is confirmed as an electrical sheet with
 *     `extractionMethod: "text"`.
 *
 *   Pass 2 (fallback): any page that looked mostly empty in Pass 1
 *     (`text.length < 100`) and had no regex match is likely a scanned
 *     raster drawing. We rasterize just those pages with PDFParse's
 *     built-in screenshot renderer and hand the image to gpt-4o-mini
 *     vision to read the title block.
 *
 * Why two passes: vision is ~$0.01/image. A 100-page set with mostly
 * text-extractable pages costs ~$0 for Pass 1 plus ~$0.10–0.20 for the
 * handful of scanned pages in Pass 2. Vision-only would be ~$1.00.
 *
 * Non-electrical pages (cover, architectural, structural, mechanical, etc.)
 * are filtered out — only pages with a confirmed E-xxx sheet number are
 * returned, sorted by their position in the source PDF.
 */
export async function identifyElectricalSheets(
  pdfBuffer: Buffer,
): Promise<IdentifiedSheet[]> {
  const pages = await extractTextPerPage(pdfBuffer)

  const confirmed: IdentifiedSheet[] = []
  const visionCandidates: number[] = []

  // Pass 1: regex scan on extracted text.
  for (const { pageIndex, text } of pages) {
    const sheetNumber = findSheetNumber(text)
    if (sheetNumber) {
      confirmed.push({
        pageIndex,
        sheetNumber,
        extractedText: text,
        extractionMethod: "text",
      })
      continue
    }
    // Scanned / image-only pages tend to have almost no extractable text.
    if (text.length < 100) {
      visionCandidates.push(pageIndex)
    }
  }

  // Pass 2: vision fallback for low-text pages.
  if (visionCandidates.length > 0 && process.env.OPENAI_API_KEY) {
    const openai = new OpenAI()
    for (const pageIndex of visionCandidates) {
      try {
        const result = await visionIdentifySheet(pdfBuffer, pageIndex, openai)
        if (result.sheetNumber) {
          confirmed.push({
            pageIndex,
            sheetNumber: result.sheetNumber,
            extractedText: result.extractedText,
            extractionMethod: "vision",
          })
        }
      } catch (err) {
        console.error(
          `[identify-sheets] vision fallback failed for page ${pageIndex}:`,
          err,
        )
      }
    }
  }

  confirmed.sort((a, b) => a.pageIndex - b.pageIndex)
  return confirmed
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
 * Vision fallback: rasterize a single page with PDFParse's built-in
 * screenshot renderer (pdfjs-dist + @napi-rs/canvas under the hood),
 * send it to gpt-4o-mini, and parse a structured JSON response.
 *
 * The prompt asks the model to look at the title block (conventionally
 * bottom-right on construction drawings), return the sheet number only
 * when it starts with "E", and also dump readable text from the rest
 * of the page so downstream RAG has something to embed.
 */
async function visionIdentifySheet(
  pdfBuffer: Buffer,
  pageIndex: number,
  openai: OpenAI,
): Promise<{ sheetNumber: string | null; extractedText: string }> {
  const parser = new PDFParse({ data: new Uint8Array(pdfBuffer) })
  let pngBase64: string
  try {
    const shot = await parser.getScreenshot({
      partial: [pageIndex + 1], // pdf-parse uses 1-indexed page numbers
      desiredWidth: 1200,
      imageBuffer: true,
      imageDataUrl: false,
    })
    const page = shot.pages[0]
    if (!page || !page.data?.byteLength) {
      return { sheetNumber: null, extractedText: "" }
    }
    pngBase64 = Buffer.from(page.data).toString("base64")
  } finally {
    await parser.destroy().catch(() => {})
  }

  const dataUrl = `data:image/png;base64,${pngBase64}`

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    max_tokens: 2000,
    messages: [
      {
        role: "system",
        content:
          "You read construction drawing sheets. Always respond with a single JSON object: " +
          '{"sheetNumber": string | null, "extractedText": string}. ' +
          "Set sheetNumber only when the title block shows an electrical sheet " +
          "(starts with the letter E, e.g. E-101, E-201). Normalize to E-XXX form. " +
          "For non-electrical sheets (A-, S-, M-, P-, cover pages, etc.) return null. " +
          "When it IS electrical, fill extractedText with every readable label, note, " +
          "schedule entry, panel tag, circuit reference, and specification on the page.",
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "What is the sheet number? Return JSON only.",
          },
          {
            type: "image_url",
            image_url: { url: dataUrl, detail: "high" },
          },
        ],
      },
    ],
  })

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
