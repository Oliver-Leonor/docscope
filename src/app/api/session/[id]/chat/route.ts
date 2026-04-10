import { NextRequest, NextResponse } from "next/server"

import { generateChatResponse } from "@/lib/ai/chat"
import { prisma } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

/**
 * POST /api/session/[id]/chat
 *
 * Body: `{ "message": string }`
 * Response: `text/plain` chunked stream of assistant tokens.
 *
 * The response body is piped directly from the OpenAI streaming
 * completion via a `ReadableStream` built in
 * {@link generateChatResponse}. The browser consumes it with
 * `Response.body.getReader()` for token-by-token UX. Server-side, once
 * the stream closes, the full assistant message is persisted to the
 * `Message` table with parsed citation metadata.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id: sessionId } = await context.params

    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      select: { id: true, status: true },
    })
    if (!session) {
      return NextResponse.json(
        { error: "Session not found" },
        { status: 404 },
      )
    }
    if (session.status !== "ready") {
      return NextResponse.json(
        { error: "Session is still processing" },
        { status: 400 },
      )
    }

    const body = (await request.json().catch(() => ({}))) as {
      message?: unknown
    }
    if (typeof body.message !== "string" || !body.message.trim()) {
      return NextResponse.json(
        { error: "Message is required" },
        { status: 400 },
      )
    }

    const stream = await generateChatResponse(sessionId, body.message.trim())

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      },
    })
  } catch (error) {
    console.error("[api/chat] error:", error)
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to generate response",
      },
      { status: 500 },
    )
  }
}
