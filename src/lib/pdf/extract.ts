import { extractText } from "unpdf"

export interface PageText {
  pageIndex: number
  text: string
}

/**
 * Extract text from each page of a PDF buffer.
 *
 * Uses unpdf's serverless build of pdf.js for text extraction. This
 * application does not use unpdf's rendering APIs or rasterize pages
 * locally; vision receives single-page PDFs prepared with pdf-lib.
 *
 * `extractText` with `mergePages: false` returns one entry per page in
 * source order; we normalize to 0-indexed `pageIndex` to match the
 * `Sheet.pageIndex` column in the Prisma schema. Empty pages come back
 * as empty strings — we keep them in the result so that
 * `identifyDocumentSections` can decide whether to flip a blank page
 * to the vision-fallback path.
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
