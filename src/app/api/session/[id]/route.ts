import { del } from "@vercel/blob"
import { NextRequest, NextResponse } from "next/server"

import { prisma } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * DELETE /api/session/[id]
 *
 * Deletes the uploaded PDF, then the session and its related rows.
 * The Prisma schema declares `onDelete: Cascade` on every child relation
 * (Sheet → Chunk, Sheet ← Session, Message ← Session), so a single
 * `session.delete` cascades all the way down to Chunk embeddings.
 *
 * Returns 204 on success, 404 when the session doesn't exist, and
 * 500 for unexpected errors.
 */
export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params

    const existing = await prisma.session.findUnique({
      where: { id },
      select: { id: true, pdfBlobUrl: true },
    })
    if (!existing) {
      return NextResponse.json(
        { error: "Session not found" },
        { status: 404 },
      )
    }

    // Delete the Blob first so a storage failure preserves its URL for retry.
    // Deleting the DB row first could leave a public Blob without its reference.
    // If the DB delete then fails, the session remains but its PDF is gone;
    // retrying is safe because del() also succeeds when the Blob is absent.
    await del(existing.pdfBlobUrl)
    await prisma.session.delete({ where: { id } })
    return new NextResponse(null, { status: 204 })
  } catch (error) {
    console.error("[api/session DELETE] error:", error)
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to delete session",
      },
      { status: 500 },
    )
  }
}
