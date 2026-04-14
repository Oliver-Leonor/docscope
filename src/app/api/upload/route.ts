import { put } from "@vercel/blob"
import { NextRequest, NextResponse } from "next/server"

import { prisma } from "@/lib/db"
import { embedAndStoreChunks } from "@/lib/ai/embeddings"
import { chunkText } from "@/lib/pdf/chunk"
import { identifyDocumentSections } from "@/lib/pdf/identify-sheets"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
// Vercel Pro max; on Hobby this is clamped to 60s automatically.
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
 *   4. Run `identifyDocumentSections` (text extraction + vision fallback
 *      for low-text pages), which returns one labeled entry per page.
 *   5. For each page: insert a `Sheet` row, chunk its extracted text,
 *      embed those chunks, and persist them as `Chunk` rows with
 *      pgvector embeddings.
 *   6. Flip the session to `ready` (or `error` + `errorMessage` when
 *      extraction recovered nothing at all).
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

    const sections = await identifyDocumentSections(buffer)

    if (sections.length === 0) {
      await prisma.session.update({
        where: { id: session.id },
        data: {
          status: "error",
          errorMessage:
            "This PDF appears to be empty or could not be read.",
        },
      })
      return NextResponse.json({ sessionId: session.id })
    }

    for (const section of sections) {
      const sheetRecord = await prisma.sheet.create({
        data: {
          sessionId: session.id,
          sheetNumber: section.sectionLabel,
          pageIndex: section.pageIndex,
          extractedText: section.extractedText,
          extractionMethod: section.extractionMethod,
        },
      })

      const chunks = chunkText(section.extractedText, section.sectionLabel)
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
