"use client"

import { Loader2 } from "lucide-react"
import * as React from "react"

import { cn } from "@/lib/utils"

export interface MessageBubbleProps {
  role: "user" | "assistant"
  content: string
  citedSheets?: string[]
  pending?: boolean
  createdAt?: string
}

const CITATION_PATTERN = /\b(E[-.]?\d{3,4})\b/gi

/**
 * Walk through `text` and replace every inline citation (E-101 / E.101
 * / E101) with a styled `<span>` badge. Text outside citations is kept
 * as plain string nodes so `whitespace-pre-wrap` continues to work.
 */
function renderContent(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = []
  let lastIndex = 0
  let key = 0

  for (const match of text.matchAll(CITATION_PATTERN)) {
    const start = match.index ?? 0
    if (start > lastIndex) {
      out.push(text.slice(lastIndex, start))
    }

    const raw = match[1].toUpperCase().replace(".", "-")
    const canonical = raw.startsWith("E-") ? raw : `E-${raw.slice(1)}`

    out.push(
      <span
        key={`cite-${key++}`}
        className="mx-0.5 inline-flex items-center rounded border border-brand/40 bg-brand/15 px-1.5 py-0.5 font-mono text-[11px] font-medium text-brand align-baseline"
      >
        {canonical}
      </span>,
    )
    lastIndex = start + match[0].length
  }

  if (lastIndex < text.length) {
    out.push(text.slice(lastIndex))
  }
  return out
}

function formatTime(iso?: string): string | undefined {
  if (!iso) return undefined
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return undefined
  return d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  })
}

/**
 * Single chat message bubble.
 *
 * User messages are right-aligned on a brand-blue fill; assistant
 * messages are left-aligned on the surface-lighter color with a border.
 * Assistant content runs through `renderContent`, which inline-badges
 * sheet references, and shows a source footer listing every cited
 * sheet the server (or the optimistic client regex) extracted.
 *
 * When `pending` is true — the placeholder bubble we insert while the
 * stream first-token latency is in flight — the bubble renders a spinner
 * and "Thinking…" instead of the empty content.
 */
export function MessageBubble({
  role,
  content,
  citedSheets,
  pending = false,
  createdAt,
}: MessageBubbleProps) {
  const isUser = role === "user"
  const time = formatTime(createdAt)

  return (
    <div
      className={cn("group flex w-full", isUser ? "justify-end" : "justify-start")}
    >
      <div
        className={cn(
          "relative max-w-[85%] rounded-xl px-4 py-2.5 text-sm leading-relaxed transition-all duration-200",
          isUser
            ? "bg-brand text-white"
            : "border border-white/10 bg-[#1a1a1e] text-white/90",
        )}
      >
        {pending ? (
          <div className="flex items-center gap-2 text-white/60">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span>Thinking…</span>
          </div>
        ) : (
          <div className="whitespace-pre-wrap break-words">
            {isUser ? content : renderContent(content)}
          </div>
        )}

        {!isUser &&
          !pending &&
          citedSheets &&
          citedSheets.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-white/10 pt-2">
              <span className="mr-1 text-[10px] uppercase tracking-wider text-white/40">
                Sources
              </span>
              {citedSheets.map((s) => (
                <span
                  key={s}
                  className="rounded border border-brand/30 bg-brand/10 px-1.5 py-0.5 font-mono text-[10px] text-brand"
                >
                  {s}
                </span>
              ))}
            </div>
          )}

        {time && (
          <span
            className={cn(
              "pointer-events-none absolute -bottom-4 text-[10px] text-white/30 opacity-0 transition-opacity group-hover:opacity-100",
              isUser ? "right-1" : "left-1",
            )}
          >
            {time}
          </span>
        )}
      </div>
    </div>
  )
}
