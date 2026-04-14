"use client"

import { Loader2 } from "lucide-react"
import * as React from "react"

import { cn } from "@/lib/utils"

export interface MessageBubbleProps {
  role: "user" | "assistant"
  content: string
  citedSheets?: string[]
  pending?: boolean
  streaming?: boolean
  createdAt?: string
}

const CITATION_PATTERN = /\b(Page\s+\d+|[ASMPECL][-.]?\d{1,4})\b/g

/**
 * Walk through `text` and replace every inline citation ("Page 5",
 * "A-201", "E-101", …) with a styled `<span>` badge. Text outside
 * citations is kept as plain string nodes so `whitespace-pre-wrap`
 * continues to work.
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

    const raw = match[1]
    const canonical = canonicalizeCitation(raw)

    out.push(
      <span
        key={`cite-${key++}`}
        className="mx-0.5 inline-flex items-center rounded-md border border-brand/40 bg-brand/15 px-1.5 py-[1px] align-baseline font-mono text-[11px] font-semibold text-brand ring-1 ring-inset ring-brand/20"
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

function canonicalizeCitation(raw: string): string {
  if (/^Page\s+\d+$/i.test(raw)) {
    const n = raw.match(/\d+/)?.[0] ?? ""
    return `Page ${n}`
  }
  const m = /^([ASMPECL])[-.]?(\d{1,4})$/i.exec(raw)
  if (!m) return raw
  return `${m[1].toUpperCase()}-${m[2]}`
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

export function MessageBubble({
  role,
  content,
  citedSheets,
  pending = false,
  streaming = false,
  createdAt,
}: MessageBubbleProps) {
  const isUser = role === "user"
  const time = formatTime(createdAt)

  return (
    <div
      className={cn(
        "ds-fade-in group flex w-full",
        isUser ? "justify-end" : "justify-start",
      )}
    >
      <div
        className={cn(
          "relative max-w-[85%] px-4 py-3 text-[14px] leading-relaxed transition-all duration-200 sm:max-w-[80%]",
          isUser
            ? "rounded-2xl rounded-br-sm bg-brand text-foreground shadow-[0_1px_0_0_rgba(255,255,255,0.1)_inset]"
            : "rounded-2xl rounded-bl-sm border border-border bg-surface-elevated text-foreground",
        )}
      >
        {pending ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span className="text-sm">Thinking…</span>
          </div>
        ) : (
          <div className="whitespace-pre-wrap break-words">
            {isUser ? content : renderContent(content)}
            {streaming && <span className="ds-cursor" aria-hidden="true" />}
          </div>
        )}

        {!isUser &&
          !pending &&
          citedSheets &&
          citedSheets.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border pt-2.5">
              <span className="mr-1 font-mono text-[9px] uppercase tracking-[0.14em] text-[#71717a]">
                Sources
              </span>
              {citedSheets.map((s) => (
                <span
                  key={s}
                  className="rounded border border-brand/25 bg-brand/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-brand"
                >
                  {s}
                </span>
              ))}
            </div>
          )}

        {time && (
          <span
            className={cn(
              "pointer-events-none absolute -bottom-4 font-mono text-[10px] text-[#52525b] opacity-0 transition-opacity group-hover:opacity-100",
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
