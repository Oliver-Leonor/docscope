import { put } from "@vercel/blob"
import { NextRequest, NextResponse } from "next/server"

import { prisma } from "@/lib/db"
import { embedAndStoreChunks } from "@/lib/ai/embeddings"
import { chunkText } from "@/lib/pdf/chunk"
import { identifyElectricalSheets } from "@/lib/pdf/identify-sheets"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
// Vercel Pro max; on hobby this is clamped to 60s automatically.
export const maxDuration = 300

/**
 * POST /api/upload
 *
 * Accepts a multipart PDF upload and, inline, runs the full processing
 * pipeline:
 *
 *   1. Parse multipart form; validate .pdf extension.
 *   2. Upload the raw bytes to Vercel Blob for persistence.
 *   3. Create a `Session` row in `processing` state.
 *   4. Run `identifyElectricalSheets` (text extraction + vision fallback).
 *   5. For each confirmed electrical page: insert a `Sheet` row, chunk
 *      its extracted text, embed those chunks, and persist to `Chunk`.
 *   6. Flip the session to `ready` (or `error` + `errorMessage` when no
 *      electrical sheets were found).
 *
 * Why inline instead of a background worker:
 *   - Typical drawing sets in this app are <100 pages.
 *   - A Vercel Pro function can run 300s; Hobby gets 60s. That covers the
 *     expected workload.
 *   - Simpler to debug than a Trigger.dev / Inngest setup.
 *   - For production scale this would move to a queue + worker.
 *
 * The client opens the session page immediately after the response
 * returns and polls `/api/session/[id]/status` for updates. Because we
 * process inline the status will already be `ready` by the time the
 * first poll lands — polling is still useful when processing fails.
 */
export async function POST(request: NextRequest) {
  let sessionId: string | null = null
  try {
    const formData = await request.formData()
    const file = formData.get("pdf")
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "Missing 'pdf' file in form data" },
        { status: 400 },
      )
    }
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      return NextResponse.json(
        { error: "Please upload a .pdf file" },
        { status: 400 },
      )
    }

    const buffer = Buffer.from(await file.arrayBuffer())

    const blob = await put(`pdfs/${Date.now()}-${file.name}`, buffer, {
      access: "public",
      contentType: "application/pdf",
    })

    const session = await prisma.session.create({
      data: {
        pdfFileName: file.name,
        pdfBlobUrl: blob.url,
        status: "processing",
      },
    })
    sessionId = session.id

    const electricalSheets = await identifyElectricalSheets(buffer)

    if (electricalSheets.length === 0) {
      await prisma.session.update({
        where: { id: session.id },
        data: {
          status: "error",
          errorMessage:
            "No electrical sheets (E-xxx) were found in this PDF.",
        },
      })
      return NextResponse.json({ sessionId: session.id })
    }

    for (const sheet of electricalSheets) {
      const sheetRecord = await prisma.sheet.create({
        data: {
          sessionId: session.id,
          sheetNumber: sheet.sheetNumber,
          pageIndex: sheet.pageIndex,
          extractedText: sheet.extractedText,
          extractionMethod: sheet.extractionMethod,
        },
      })

      const chunks = chunkText(sheet.extractedText, sheet.sheetNumber)
      if (chunks.length > 0) {
        await embedAndStoreChunks(
          chunks.map((c) => ({
            content: c.content,
            sheetId: sheetRecord.id,
          })),
        )
      }
    }

    await prisma.session.update({
      where: { id: session.id },
      data: { status: "ready" },
    })

    return NextResponse.json({ sessionId: session.id })
  } catch (error) {
    console.error("[api/upload] error:", error)
    if (sessionId) {
      await prisma.session
        .update({
          where: { id: sessionId },
          data: {
            status: "error",
            errorMessage:
              error instanceof Error ? error.message : "Unknown error",
          },
        })
        .catch(() => {})
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to process PDF",
      },
      { status: 500 },
    )
  }
}
