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
  "What is this document about?",
  "Summarize the key points",
  "What are the main specifications?",
  "List all tables and their data",
  "What standards or codes are referenced?",
]

const CITATION_PATTERN = /\b(?:Page\s+(\d+)|([ASMPECL])[-.]?(\d{1,4}))\b/gi

function extractCitationsClient(text: string): string[] {
  if (!text) return []
  const seen = new Set<string>()
  const out: string[] = []
  const re = new RegExp(CITATION_PATTERN.source, "gi")
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const canonical = m[1]
      ? `Page ${m[1]}`
      : `${m[2].toUpperCase()}-${m[3]}`
    if (!seen.has(canonical)) {
      seen.add(canonical)
      out.push(canonical)
    }
  }
  return out
}

export function Chat({ sessionId, className }: ChatProps) {
  const [messages, setMessages] = React.useState<ChatMessage[]>([])
  const [input, setInput] = React.useState("")
  const [isLoading, setIsLoading] = React.useState(false)
  const [isStreaming, setIsStreaming] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)

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
        /* non-fatal */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [sessionId])

  React.useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [messages])

  React.useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = Math.min(el.scrollHeight, 160) + "px"
  }, [input])

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
    <section className={cn("flex min-h-0 flex-1 flex-col gap-3", className)}>
      <div className="flex items-center gap-3">
        <h2 className="font-heading text-[11px] font-medium uppercase tracking-[0.14em] text-[#71717a]">
          Chat
        </h2>
        <div className="h-px flex-1 bg-border" />
      </div>

      <div className="flex min-h-[560px] flex-1 flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset]">
        <div
          ref={scrollRef}
          className="ds-scroll flex-1 space-y-5 overflow-y-auto px-5 py-6 sm:px-6"
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
                streaming={
                  isStreaming &&
                  idx === messages.length - 1 &&
                  m.role === "assistant" &&
                  m.content.length > 0
                }
              />
            ))
          )}
        </div>

        {error && (
          <div className="flex items-center gap-2 border-t border-red-500/20 bg-red-500/[0.04] px-4 py-2 text-xs text-red-300">
            <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
            {error}
          </div>
        )}

        <form
          className="flex items-end gap-2 border-t border-border bg-[#0f0f12] p-3 sm:p-4"
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
            placeholder="Ask about this document…"
            disabled={isLoading}
            className="ds-scroll flex-1 resize-none rounded-lg border border-border bg-surface px-3.5 py-2.5 text-sm text-foreground placeholder:text-[#52525b] transition-all duration-150 focus:border-brand/60 focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:opacity-60"
          />
          <Button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="h-10 min-w-[44px] bg-brand px-3.5 text-foreground shadow-[0_1px_0_0_rgba(255,255,255,0.1)_inset] transition-colors hover:bg-brand-hover disabled:bg-[#1f2937] disabled:text-[#52525b]"
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

      <p className="flex items-center gap-1.5 px-0.5 text-[11px] text-[#52525b]">
        <kbd className="rounded border border-border bg-surface px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
          Enter
        </kbd>
        to send ·
        <kbd className="rounded border border-border bg-surface px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
          Shift+Enter
        </kbd>
        for a new line. Answers cite specific pages.
      </p>
    </section>
  )
}

function EmptyState({ onPick }: { onPick: (q: string) => void }) {
  return (
    <div className="ds-fade-in flex flex-col items-center gap-6 py-12">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-brand/25 bg-brand/10 text-brand shadow-[0_0_40px_-10px_rgba(59,130,246,0.4)]">
        <Sparkles className="h-6 w-6" />
      </div>
      <div className="text-center">
        <p className="font-heading text-[15px] font-medium text-foreground">
          Ask anything about this document
        </p>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Answers are grounded in the extracted content with citations back to
          the source pages.
        </p>
      </div>
      <div className="flex max-w-2xl flex-wrap justify-center gap-2">
        {SUGGESTED_QUESTIONS.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => onPick(q)}
            className="rounded-full border border-border bg-surface-elevated px-3.5 py-1.5 text-xs text-muted-foreground transition-all duration-150 hover:border-brand/40 hover:bg-brand/10 hover:text-foreground"
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  )
}
