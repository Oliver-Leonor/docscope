import { extractText } from "unpdf"

export interface PageText {
  pageIndex: number
  text: string
}

/**
 * Extract text from each page of a PDF buffer.
 *
 * Uses `unpdf`, a serverless-friendly redistribution of pdf.js. Unlike
 * `pdf-parse` / raw `pdfjs-dist`, unpdf ships a build that does not pull
 * in `@napi-rs/canvas` and does not touch `DOMMatrix` / `Path2D` / `ImageData`
 * at module load, so it boots cleanly inside a Vercel serverless function.
 *
 * `extractText` with `mergePages: false` returns one entry per page in
 * source order; we normalize to 0-indexed `pageIndex` to match the
 * `Sheet.pageIndex` column in the Prisma schema. Empty pages come back
 * as empty strings — we keep them in the result so that
 * `identifyElectricalSheets` can decide whether to flip a blank page to
 * the vision-fallback path.
 */
export async function extractTextPerPage(
  pdfBuffer: Buffer,
): Promise<PageText[]> {
  const { text } = await extractText(new Uint8Array(pdfBuffer), {
    mergePages: false,
  })
  return text.map((pageText, idx) => ({
    pageIndex: idx,
    text: (pageText ?? "").trim(),
  }))
}
