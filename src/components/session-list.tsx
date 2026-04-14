import { AlertCircle, FileText } from "lucide-react"
import Link from "next/link"

import { DeleteSessionButton } from "@/components/delete-session-button"
import { Badge } from "@/components/ui/badge"
import { prisma } from "@/lib/db"
import { cn } from "@/lib/utils"

interface SessionRow {
  id: string
  pdfFileName: string
  status: string
  errorMessage: string | null
  createdAt: Date
  sheetCount: number
}

export async function SessionList() {
  let rows: SessionRow[] = []
  let dbError: string | null = null

  try {
    const sessions = await prisma.session.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        pdfFileName: true,
        status: true,
        errorMessage: true,
        createdAt: true,
        _count: { select: { sheets: true } },
      },
    })
    rows = sessions.map((s) => ({
      id: s.id,
      pdfFileName: s.pdfFileName,
      status: s.status,
      errorMessage: s.errorMessage,
      createdAt: s.createdAt,
      sheetCount: s._count.sheets,
    }))
  } catch (err) {
    dbError = err instanceof Error ? err.message : "Database unavailable"
  }

  if (dbError) {
    return (
      <EmptyState
        title="Can't reach the database"
        description={dbError}
        tone="error"
      />
    )
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        title="No sessions yet"
        description="Upload a PDF above to get started."
      />
    )
  }

  return (
    <ul className="flex flex-col gap-2">
      {rows.map((row, i) => (
        <li
          key={row.id}
          className="ds-fade-in-up ds-lift group flex items-center gap-2 rounded-lg border border-border bg-surface pr-2 hover:border-[#3f3f46] hover:bg-surface-elevated"
          style={{ ["--ds-delay" as string]: `${i * 40}ms` }}
        >
          <Link
            href={`/session/${row.id}`}
            className="flex min-w-0 flex-1 items-center gap-4 px-4 py-3.5"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand ring-1 ring-inset ring-brand/20">
              <FileText className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">
                {row.pdfFileName}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                <span>{formatRelative(row.createdAt)}</span>
                <span className="mx-1.5 text-[#52525b]">·</span>
                <span>
                  {row.sheetCount}{" "}
                  {row.sheetCount === 1 ? "page" : "pages"}
                </span>
              </p>
            </div>
            <StatusBadge status={row.status} />
          </Link>
          <DeleteSessionButton
            sessionId={row.id}
            pdfFileName={row.pdfFileName}
          />
        </li>
      ))}
    </ul>
  )
}

/**
 * Suspense fallback skeleton for the session list.
 */
export function SessionListSkeleton() {
  return (
    <ul className="flex flex-col gap-2" aria-busy="true" aria-live="polite">
      {Array.from({ length: 3 }).map((_, i) => (
        <li
          key={i}
          className="flex items-center gap-4 rounded-lg border border-border bg-surface px-4 py-3.5"
        >
          <div className="h-10 w-10 shrink-0 animate-pulse rounded-lg bg-surface-elevated" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="h-3 w-2/3 animate-pulse rounded bg-surface-elevated" />
            <div className="h-2.5 w-1/3 animate-pulse rounded bg-surface-elevated" />
          </div>
          <div className="h-5 w-16 animate-pulse rounded-full bg-surface-elevated" />
        </li>
      ))}
    </ul>
  )
}

function StatusBadge({ status }: { status: string }) {
  if (status === "ready") {
    return (
      <Badge className="shrink-0 gap-1.5 rounded-full border-[#22c55e]/25 bg-[#22c55e]/10 px-2 py-0.5 text-[11px] font-medium text-[#4ade80] hover:bg-[#22c55e]/15">
        <span className="h-1.5 w-1.5 rounded-full bg-[#22c55e]" />
        Ready
      </Badge>
    )
  }
  if (status === "error") {
    return (
      <Badge className="shrink-0 gap-1.5 rounded-full border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[11px] font-medium text-red-300 hover:bg-red-500/15">
        <AlertCircle className="h-3 w-3" />
        Error
      </Badge>
    )
  }
  return (
    <Badge className="shrink-0 gap-1.5 rounded-full border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-300 hover:bg-amber-500/15">
      <span className="ds-soft-pulse h-1.5 w-1.5 rounded-full bg-amber-400" />
      Processing
    </Badge>
  )
}

function EmptyState({
  title,
  description,
  tone = "muted",
}: {
  title: string
  description: string
  tone?: "muted" | "error"
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-dashed px-6 py-12 text-center",
        tone === "error"
          ? "border-red-500/30 bg-red-500/[0.04]"
          : "border-border bg-surface",
      )}
    >
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="mt-1.5 text-xs text-muted-foreground">{description}</p>
    </div>
  )
}

/**
 * "2 hours ago" style relative formatter. Falls back to a short
 * absolute date for anything older than a week so the user still
 * gets a definite reference point.
 */
function formatRelative(date: Date): string {
  const now = Date.now()
  const diffMs = now - date.getTime()
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  const week = 7 * day

  if (diffMs < minute) return "just now"
  if (diffMs < hour) {
    const n = Math.round(diffMs / minute)
    return `${n} minute${n === 1 ? "" : "s"} ago`
  }
  if (diffMs < day) {
    const n = Math.round(diffMs / hour)
    return `${n} hour${n === 1 ? "" : "s"} ago`
  }
  if (diffMs < week) {
    const n = Math.round(diffMs / day)
    return `${n} day${n === 1 ? "" : "s"} ago`
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date)
}
