import { NextRequest, NextResponse } from "next/server"

import { prisma } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET /api/session/[id]/messages
 *
 * Returns every persisted message for the session in chronological order.
 * The chat UI calls this on mount to restore history when a user revisits
 * a session, and again after a streamed turn completes to replace its
 * optimistic local state with the authoritative server version (real
 * row IDs, server-parsed `citedSheets`).
 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id: sessionId } = await context.params

    const messages = await prisma.message.findMany({
      where: { sessionId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        role: true,
        content: true,
        citedSheets: true,
        createdAt: true,
      },
    })

    return NextResponse.json({ messages })
  } catch (error) {
    console.error("[api/messages] error:", error)
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to load messages",
      },
      { status: 500 },
    )
  }
}
