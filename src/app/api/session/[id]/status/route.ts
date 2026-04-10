import { NextRequest, NextResponse } from "next/server"

import { prisma } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET /api/session/[id]/status
 *
 * Returns the current processing state of a session along with enough
 * metadata for the session cover page: file name, sheet list, total
 * sheet count, and any error surfaced during processing.
 *
 * Note: in Next.js 16 the `params` argument of a route handler is a
 * Promise and must be awaited.
 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params

  try {
    const session = await prisma.session.findUnique({
      where: { id },
      include: {
        sheets: {
          select: {
            sheetNumber: true,
            pageIndex: true,
            extractionMethod: true,
          },
          orderBy: { sheetNumber: "asc" },
        },
      },
    })

    if (!session) {
      return NextResponse.json(
        { error: "Session not found" },
        { status: 404 },
      )
    }

    return NextResponse.json({
      id: session.id,
      status: session.status,
      pdfFileName: session.pdfFileName,
      pdfBlobUrl: session.pdfBlobUrl,
      errorMessage: session.errorMessage,
      sheets: session.sheets,
      totalSheets: session.sheets.length,
      createdAt: session.createdAt,
    })
  } catch (error) {
    console.error("[api/session/status] error:", error)
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to load session",
      },
      { status: 500 },
    )
  }
}
