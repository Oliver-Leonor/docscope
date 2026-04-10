"use client"

import { AlertCircle, ArrowLeft, Loader2, Zap } from "lucide-react"
import Link from "next/link"
import { use, useEffect, useState } from "react"

import { Chat } from "@/components/chat"
import { CoverPage, type CoverPageSheet } from "@/components/cover-page"

interface SessionStatus {
  id: string
  status: string
  pdfFileName: string
  pdfBlobUrl: string | null
  errorMessage: string | null
  sheets: CoverPageSheet[]
  totalSheets: number
  createdAt: string
}

type ViewState =
  | { kind: "loading" }
  | { kind: "not_found" }
  | { kind: "error"; message: string }
  | { kind: "loaded"; session: SessionStatus }

/**
 * Session detail page.
 *
 * Client component because we need to poll `/api/session/[id]/status`
 * every 2s while the upload pipeline is still running and swap the
 * cover page + chat in without a full route reload. Uses React 19's
 * `use()` to unwrap the `params` Promise that Next.js 16 hands us.
 *
 * The server's initial data fetch is delegated to the status API —
 * that keeps this page purely client-side, avoids double-fetching
 * on hydration, and gives us one authoritative source of truth for
 * session state (useful later for SWR / real-time push).
 *
 * Layout follows the spec: compact nav, then cover page, then chat
 * below when the session is ready.
 */
export default function SessionPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const [state, setState] = useState<ViewState>({ kind: "loading" })

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const load = async (): Promise<void> => {
      try {
        const res = await fetch(`/api/session/${id}/status`, {
          cache: "no-store",
        })
        if (cancelled) return
        if (res.status === 404) {
          setState({ kind: "not_found" })
          return
        }
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: string
          }
          setState({
            kind: "error",
            message: data.error || `HTTP ${res.status}`,
          })
          return
        }
        const data = (await res.json()) as SessionStatus
        if (cancelled) return
        setState({ kind: "loaded", session: data })

        // Re-poll every 2s while still processing.
        if (data.status === "processing") {
          timer = setTimeout(() => {
            void load()
          }, 2000)
        }
      } catch (err) {
        if (cancelled) return
        setState({
          kind: "error",
          message: err instanceof Error ? err.message : "Network error",
        })
        timer = setTimeout(() => {
          void load()
        }, 3000)
      }
    }

    void load()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [id])

  return (
    <main className="flex flex-col gap-6">
      <nav className="flex items-center justify-between">
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm text-white/50 transition-all duration-200 hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to sessions
        </Link>
        <span className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-white/40">
          <Zap className="h-3 w-3 text-brand" />
          PunchZero · Session {id.slice(0, 8)}
        </span>
      </nav>

      {state.kind === "loading" && <LoadingState />}
      {state.kind === "not_found" && <NotFoundState />}
      {state.kind === "error" && <ErrorState message={state.message} />}
      {state.kind === "loaded" && (
        <>
          <CoverPage
            pdfFileName={state.session.pdfFileName}
            status={state.session.status}
            sheets={state.session.sheets}
            totalSheets={state.session.totalSheets}
            errorMessage={state.session.errorMessage}
          />

          {state.session.status === "processing" && (
            <ProcessingNotice />
          )}

          {state.session.status === "ready" && (
            <Chat sessionId={state.session.id} />
          )}
        </>
      )}
    </main>
  )
}

function LoadingState() {
  return (
    <div className="flex items-center justify-center gap-2 py-20 text-sm text-white/50">
      <Loader2 className="h-4 w-4 animate-spin" />
      Loading session…
    </div>
  )
}

function NotFoundState() {
  return (
    <div className="rounded-xl border border-white/10 bg-[#111113] p-8 text-center">
      <p className="font-medium text-white">Session not found</p>
      <p className="mt-1 text-sm text-white/50">
        The session you&apos;re looking for doesn&apos;t exist or was removed.
      </p>
      <Link
        href="/"
        className="mt-4 inline-block text-sm text-brand hover:underline"
      >
        ← Back to uploads
      </Link>
    </div>
  )
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-6">
      <div className="flex items-center gap-2 text-red-300">
        <AlertCircle className="h-4 w-4" />
        <p className="text-sm font-medium">Failed to load session</p>
      </div>
      <p className="mt-2 text-xs text-red-300/80">{message}</p>
    </div>
  )
}

function ProcessingNotice() {
  return (
    <div className="flex items-center justify-center gap-3 rounded-xl border border-dashed border-white/10 bg-[#0f0f12] px-6 py-8 text-sm text-white/60">
      <Loader2 className="h-4 w-4 animate-spin text-brand" />
      <span>
        Extracting electrical sheets and embedding text — this updates every
        two seconds.
      </span>
    </div>
  )
}
