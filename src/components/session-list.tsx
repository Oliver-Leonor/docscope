import { AlertCircle, CheckCircle2, Clock, FileText } from "lucide-react"
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

/**
 * Server component: lists every session for this project, most recent
 * first, with a compact status badge and sheet-count summary. Clicking
 * a row navigates to `/session/[id]`.
 *
 * Prisma may fail if DATABASE_URL isn't set (dev setup, missing .env,
 * Neon DB unreachable). In that case we degrade gracefully to a helpful
 * empty state instead of crashing the whole home page render.
 */
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
      {rows.map((row) => (
        <li
          key={row.id}
          className="group flex items-center gap-2 rounded-lg border border-white/10 bg-[#111113] pr-2 transition-all duration-200 hover:border-brand/50 hover:bg-[#14141a]"
        >
          <Link
            href={`/session/${row.id}`}
            className="flex min-w-0 flex-1 items-center gap-4 px-4 py-3"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-brand/10 text-brand">
              <FileText className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-white">
                {row.pdfFileName}
              </p>
              <p className="text-xs text-white/50">
                {formatDate(row.createdAt)} · {row.sheetCount}{" "}
                {row.sheetCount === 1 ? "sheet" : "sheets"}
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
 * Suspense fallback skeleton for the session list. Rendered while the
 * async server component awaits its Prisma query on SSR.
 */
export function SessionListSkeleton() {
  return (
    <ul className="flex flex-col gap-2" aria-busy="true" aria-live="polite">
      {Array.from({ length: 3 }).map((_, i) => (
        <li
          key={i}
          className="flex items-center gap-4 rounded-lg border border-white/10 bg-[#111113] px-4 py-3"
          style={{ animationDelay: `${i * 80}ms` }}
        >
          <div className="h-10 w-10 shrink-0 animate-pulse rounded bg-white/5" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="h-3 w-2/3 animate-pulse rounded bg-white/5" />
            <div className="h-2.5 w-1/3 animate-pulse rounded bg-white/5" />
          </div>
          <div className="h-5 w-16 animate-pulse rounded bg-white/5" />
        </li>
      ))}
    </ul>
  )
}

function StatusBadge({ status }: { status: string }) {
  if (status === "ready") {
    return (
      <Badge className="gap-1 border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20">
        <CheckCircle2 className="h-3 w-3" />
        Ready
      </Badge>
    )
  }
  if (status === "error") {
    return (
      <Badge className="gap-1 border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/20">
        <AlertCircle className="h-3 w-3" />
        Error
      </Badge>
    )
  }
  return (
    <Badge className="gap-1 border-brand/30 bg-brand/10 text-brand hover:bg-brand/20">
      <Clock className="h-3 w-3" />
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
        "rounded-lg border border-dashed px-6 py-10 text-center",
        tone === "error"
          ? "border-red-500/30 bg-red-500/5"
          : "border-white/10 bg-[#111113]",
      )}
    >
      <p className="text-sm font-medium text-white">{title}</p>
      <p className="mt-1 text-xs text-white/50">{description}</p>
    </div>
  )
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date)
}
