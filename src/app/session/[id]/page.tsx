"use client"

import { AlertCircle, ArrowLeft, FileSearch, Loader2 } from "lucide-react"
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
    <main className="ds-fade-in flex min-h-[calc(100vh-5rem)] flex-col gap-6">
      <nav className="flex items-center justify-between gap-4">
        <Link
          href="/"
          className="group inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
          Back to documents
        </Link>
        <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-[#71717a]">
          <FileSearch className="h-3 w-3 text-brand" />
          <span className="hidden sm:inline">DocScope ·</span>
          <span>Session {id.slice(0, 8)}</span>
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

          {state.session.status === "processing" && <ProcessingNotice />}

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
    <div className="flex flex-1 items-center justify-center gap-2 py-20 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin text-brand" />
      Loading session…
    </div>
  )
}

function NotFoundState() {
  return (
    <div className="rounded-xl border border-border bg-surface p-10 text-center">
      <p className="font-heading text-base font-medium text-foreground">
        Session not found
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        The session you&apos;re looking for doesn&apos;t exist or was removed.
      </p>
      <Link
        href="/"
        className="mt-5 inline-block text-sm text-brand transition-colors hover:text-brand-hover hover:underline"
      >
        ← Back to uploads
      </Link>
    </div>
  )
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-red-500/30 bg-red-500/[0.04] p-6">
      <div className="flex items-center gap-2 text-red-300">
        <AlertCircle className="h-4 w-4" />
        <p className="text-sm font-medium">Failed to load session</p>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-red-300/80">{message}</p>
    </div>
  )
}

function ProcessingNotice() {
  return (
    <div className="flex items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-[#0f0f12] px-6 py-10 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin text-brand" />
      <span>
        Extracting pages and embedding text — this updates every two seconds.
      </span>
    </div>
  )
}
