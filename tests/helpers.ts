import { NextRequest } from "next/server"
import { PDFDocument, StandardFonts } from "pdf-lib"

export function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

// Created in memory, with invented content only; no existing documents are read.
export async function syntheticPdf(pageCount: number) {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  for (let i = 0; i < pageCount; i++) {
    const page = pdf.addPage()
    const text = `Synthetic garden notes for page ${i + 1}. ` +
      "The demonstration garden has blue pots and a weekly watering schedule. ".repeat(5)
    page.drawText(text, { font, size: 10, x: 30, y: 750, maxWidth: 500 })
  }
  return Buffer.from(await pdf.save())
}

export function uploadRequest(buffer: Uint8Array = Buffer.from("%PDF-test")) {
  const form = new FormData()
  form.set("pdf", new File([new Uint8Array(buffer)], "synthetic.pdf", { type: "application/pdf" }))
  return new NextRequest("http://localhost/api/upload", { method: "POST", body: form })
}
