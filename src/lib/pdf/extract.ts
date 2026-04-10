import { PDFParse } from "pdf-parse"

export interface PageText {
  pageIndex: number
  text: string
}

/**
 * Extract text from each page of a PDF buffer.
 *
 * `pdf-parse` v2 (built on pdfjs-dist) splits text per page natively: the
 * returned `TextResult` has a `.pages` array with 1-indexed page numbers.
 * We normalize to 0-indexed `pageIndex` to match the `Sheet.pageIndex`
 * column in the Prisma schema.
 *
 * Empty pages come back as empty strings — we keep them in the result so
 * that `identifyElectricalSheets` can decide whether to flip a blank page
 * to the vision-fallback path.
 */
export async function extractTextPerPage(
  pdfBuffer: Buffer,
): Promise<PageText[]> {
  const parser = new PDFParse({ data: new Uint8Array(pdfBuffer) })
  try {
    const result = await parser.getText({
      lineEnforce: true,
      pageJoiner: "",
    })
    const pages: PageText[] = result.pages.map((p) => ({
      pageIndex: p.num - 1,
      text: (p.text ?? "").trim(),
    }))
    pages.sort((a, b) => a.pageIndex - b.pageIndex)
    return pages
  } finally {
    await parser.destroy().catch(() => {})
  }
}

/**
 * Return the total number of pages in a PDF without extracting text.
 */
export async function getPageCount(pdfBuffer: Buffer): Promise<number> {
  const parser = new PDFParse({ data: new Uint8Array(pdfBuffer) })
  try {
    const info = await parser.getInfo()
    return info.total ?? 0
  } finally {
    await parser.destroy().catch(() => {})
  }
}
