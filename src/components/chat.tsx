"use client"

import { Loader2, Send, Sparkles } from "lucide-react"
import * as React from "react"

import { MessageBubble } from "@/components/message-bubble"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface ChatMessage {
  id: string
  role: "user" | "assistant"
  content: string
  citedSheets: string[]
  createdAt?: string
}

interface ChatProps {
  sessionId: string
  className?: string
}

const SUGGESTED_QUESTIONS = [
  "What is the main electrical service size and voltage?",
  "How many electrical panels are on this project?",
  "What type of conduit is specified?",
  "Are there any EV charging provisions?",
]

const CLIENT_CITATION_PATTERN = /\bE[-.]?(\d{3,4})\b/gi

/**
 * Parse citations from streaming text on the client so the "Sources"
 * row on the assistant bubble updates live. Matches the server-side
 * `extractCitedSheets` regex in `lib/ai/chat.ts` so the final client
 * render and the server-persisted `citedSheets` stay in sync.
 */
function extractCitationsClient(text: string): string[] {
  if (!text) return []
  const seen = new Set<string>()
  const out: string[] = []
  let m: RegExpExecArray | null
  const re = new RegExp(CLIENT_CITATION_PATTERN.source, "gi")
  while ((m = re.exec(text)) !== null) {
    const canonical = `E-${m[1]}`
    if (!seen.has(canonical)) {
      seen.add(canonical)
      out.push(canonical)
    }
  }
  return out
}

/**
 * Chat panel for a ready session.
 *
 * Responsibilities:
 *   - On mount, fetch existing history from `/api/session/[id]/messages`
 *     so revisiting a session restores the full thread.
 *   - Send new turns to `/api/session/[id]/chat`, reading the streamed
 *     response chunk-by-chunk through `Response.body.getReader()`.
 *   - Maintain an optimistic local message list that updates on every
 *     decoded chunk, then reconcile against the server's canonical
 *     message list after the stream closes.
 *   - Auto-scroll on new content, keyboard shortcuts (Enter sends,
 *     Shift+Enter newline), and suggested starter questions when empty.
 */
export function Chat({ sessionId, className }: ChatProps) {
  const [messages, setMessages] = React.useState<ChatMessage[]>([])
  const [input, setInput] = React.useState("")
  const [isLoading, setIsLoading] = React.useState(false)
  const [isStreaming, setIsStreaming] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)

  // Load history on mount.
  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/session/${sessionId}/messages`, {
          cache: "no-store",
        })
        if (!res.ok) return
        const data = (await res.json()) as { messages?: ChatMessage[] }
        if (!cancelled && Array.isArray(data.messages)) {
          setMessages(data.messages)
        }
      } catch {
        // non-fatal; user can still start a fresh conversation
      }
    })()
    return () => {
      cancelled = true
    }
  }, [sessionId])

  // Auto-scroll as new content streams in.
  React.useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [messages])

  // Auto-grow the textarea up to a cap.
  React.useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = Math.min(el.scrollHeight, 160) + "px"
  }, [input])

  // Focus the composer on mount so a user can start typing without
  // an extra click, and re-focus it whenever a streaming turn wraps up.
  React.useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  React.useEffect(() => {
    if (!isLoading) {
      textareaRef.current?.focus()
    }
  }, [isLoading])

  const sendMessage = React.useCallback(
    async (raw: string) => {
      const message = raw.trim()
      if (!message || isLoading) return

      setError(null)
      setInput("")
      setIsLoading(true)

      const now = new Date().toISOString()
      const tempUserId = `temp-user-${Date.now()}`
      const tempAssistantId = `temp-assistant-${Date.now()}`
      setMessages((prev) => [
        ...prev,
        {
          id: tempUserId,
          role: "user",
          content: message,
          citedSheets: [],
          createdAt: now,
        },
        {
          id: tempAssistantId,
          role: "assistant",
          content: "",
          citedSheets: [],
          createdAt: now,
        },
      ])

      try {
        const res = await fetch(`/api/session/${sessionId}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message }),
        })

        if (!res.ok || !res.body) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: string
          }
          throw new Error(data.error || `Chat failed (HTTP ${res.status})`)
        }

        setIsStreaming(true)
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ""

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const citations = extractCitationsClient(buffer)
          setMessages((prev) => {
            const copy = [...prev]
            const idx = copy.length - 1
            const last = copy[idx]
            if (last && last.id === tempAssistantId) {
              copy[idx] = {
                ...last,
                content: buffer,
                citedSheets: citations,
              }
            }
            return copy
          })
        }

        // Flush any trailing bytes sitting in the decoder.
        buffer += decoder.decode()
        setMessages((prev) => {
          const copy = [...prev]
          const idx = copy.length - 1
          const last = copy[idx]
          if (last && last.id === tempAssistantId) {
            copy[idx] = {
              ...last,
              content: buffer,
              citedSheets: extractCitationsClient(buffer),
            }
          }
          return copy
        })

        // Reconcile with server-canonical rows (real IDs, parsed citations).
        void fetch(`/api/session/${sessionId}/messages`, { cache: "no-store" })
          .then((r) => (r.ok ? r.json() : null))
          .then((data: { messages?: ChatMessage[] } | null) => {
            if (data && Array.isArray(data.messages)) {
              setMessages(data.messages)
            }
          })
          .catch(() => {})
      } catch (err) {
        setError(err instanceof Error ? err.message : "Chat failed")
        // Drop the failed placeholder assistant bubble; keep user turn.
        setMessages((prev) => prev.filter((m) => m.id !== tempAssistantId))
      } finally {
        setIsLoading(false)
        setIsStreaming(false)
      }
    },
    [sessionId, isLoading],
  )

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      void sendMessage(input)
    }
  }

  return (
    <section className={cn("flex flex-col gap-3", className)}>
      <h2 className="font-heading text-sm font-medium uppercase tracking-wider text-white/50">
        Chat
      </h2>

      <div className="flex min-h-[540px] flex-col overflow-hidden rounded-xl border border-white/10 bg-[#111113]">
        <div
          ref={scrollRef}
          className="flex-1 space-y-4 overflow-y-auto px-4 py-5"
        >
          {messages.length === 0 ? (
            <EmptyState
              onPick={(q) => {
                void sendMessage(q)
              }}
            />
          ) : (
            messages.map((m, idx) => (
              <MessageBubble
                key={m.id}
                role={m.role}
                content={m.content}
                citedSheets={m.citedSheets}
                createdAt={m.createdAt}
                pending={
                  isStreaming &&
                  idx === messages.length - 1 &&
                  m.role === "assistant" &&
                  m.content.length === 0
                }
              />
            ))
          )}
        </div>

        {error && (
          <div className="border-t border-red-500/20 bg-red-500/5 px-4 py-2 text-xs text-red-300">
            {error}
          </div>
        )}

        <form
          className="flex items-end gap-2 border-t border-white/10 bg-[#0f0f12] p-3"
          onSubmit={(e) => {
            e.preventDefault()
            void sendMessage(input)
          }}
        >
          <textarea
            ref={textareaRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Ask about the electrical scope…"
            disabled={isLoading}
            className="flex-1 resize-none rounded-lg border border-white/10 bg-[#1a1a1e] px-3 py-2 text-sm text-white placeholder:text-white/30 transition-all duration-200 focus:border-brand/60 focus:outline-none focus:ring-1 focus:ring-brand/40 disabled:opacity-60"
          />
          <Button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="h-9 bg-brand text-white transition-all duration-200 hover:bg-brand-dark disabled:bg-brand/40"
            aria-label="Send message"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </form>
      </div>

      <p className="text-[11px] text-white/30">
        Enter to send · Shift+Enter for a new line. Answers are grounded in
        the extracted electrical sheets.
      </p>
    </section>
  )
}

function EmptyState({ onPick }: { onPick: (q: string) => void }) {
  return (
    <div className="flex flex-col items-center gap-5 py-10">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand/10 text-brand ring-1 ring-brand/30">
        <Sparkles className="h-5 w-5" />
      </div>
      <div className="text-center">
        <p className="text-sm font-medium text-white">
          Ask anything about this drawing set
        </p>
        <p className="mt-1 text-xs text-white/50">
          Answers are grounded in the extracted electrical sheets with
          citations back to the source.
        </p>
      </div>
      <div className="flex max-w-2xl flex-wrap justify-center gap-2">
        {SUGGESTED_QUESTIONS.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => onPick(q)}
            className="rounded-full border border-white/10 bg-[#1a1a1e] px-3 py-1.5 text-xs text-white/80 transition-all duration-200 hover:border-brand/50 hover:bg-[#14141a] hover:text-white"
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  )
}
