import { NextRequest, NextResponse } from "next/server"

import { prisma } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * DELETE /api/session/[id]
 *
 * Removes a session and every row that belongs to it. The Prisma
 * schema declares `onDelete: Cascade` on every child relation
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
      select: { id: true },
    })
    if (!existing) {
      return NextResponse.json(
        { error: "Session not found" },
        { status: 404 },
      )
    }

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
