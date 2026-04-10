"use client"

import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Eye,
  FileText,
  ScanLine,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

export interface CoverPageSheet {
  sheetNumber: string
  pageIndex: number
  extractionMethod: string
}

export interface CoverPageProps {
  pdfFileName: string
  status: string
  sheets: CoverPageSheet[]
  totalSheets: number
  errorMessage?: string | null
  totalPages?: number | null
}

/**
 * Session cover page — the first thing shown after upload completes.
 *
 * Displays the PDF file name, current processing status (ready /
 * processing / error) and the full list of identified electrical sheets
 * with their extraction method (text-only vs vision-fallback).
 *
 * Pure presentation: all data comes in through props. Polling lives
 * in the parent session page, which refetches `/api/session/[id]/status`
 * every 2s while the status is `processing` and passes updated props
 * down — so the sheets list animates in progressively on re-render.
 */
export function CoverPage({
  pdfFileName,
  status,
  sheets,
  totalSheets,
  errorMessage,
  totalPages,
}: CoverPageProps) {
  return (
    <section className="rounded-xl border border-white/10 bg-[#111113] p-6 shadow-sm">
      {/* Header row */}
      <div className="flex items-center gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand ring-1 ring-brand/30">
          <FileText className="h-6 w-6" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-heading text-xl font-semibold text-white">
            {pdfFileName}
          </h2>
          <p className="text-xs text-white/50">
            {totalSheets} electrical{" "}
            {totalSheets === 1 ? "sheet" : "sheets"} identified
            {typeof totalPages === "number" && totalPages > 0
              ? ` out of ${totalPages} total ${
                  totalPages === 1 ? "page" : "pages"
                }`
              : ""}
          </p>
        </div>
        <StatusPill status={status} />
      </div>

      {errorMessage && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-300">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="leading-relaxed">{errorMessage}</p>
        </div>
      )}

      {/* Sheet list */}
      <div className="mt-6">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-heading text-xs font-medium uppercase tracking-wider text-white/50">
            Identified electrical sheets
          </h3>
          <Badge className="border-brand/30 bg-brand/10 text-brand hover:bg-brand/20">
            {totalSheets}
          </Badge>
        </div>

        {status === "processing" && sheets.length === 0 && (
          <ProcessingSkeleton />
        )}

        {sheets.length > 0 && (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {sheets.map((sheet, i) => (
              <li
                key={`${sheet.sheetNumber}-${sheet.pageIndex}`}
                className="flex items-center gap-3 rounded-lg border border-white/10 bg-[#1a1a1e] px-3 py-2.5 transition-all duration-200 hover:border-brand/40 hover:bg-[#1f1f25] animate-in fade-in slide-in-from-bottom-2"
                style={{
                  animationDelay: `${Math.min(i * 30, 600)}ms`,
                  animationFillMode: "both",
                }}
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-brand/10 text-brand">
                  {sheet.extractionMethod === "vision" ? (
                    <Eye className="h-4 w-4" />
                  ) : (
                    <ScanLine className="h-4 w-4" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-sm font-medium text-white">
                    {sheet.sheetNumber}
                  </p>
                  <p className="text-xs text-white/40">
                    Page {sheet.pageIndex + 1}
                  </p>
                </div>
                <ExtractionBadge method={sheet.extractionMethod} />
              </li>
            ))}
          </ul>
        )}

        {status !== "processing" &&
          sheets.length === 0 &&
          !errorMessage && (
            <div className="rounded-lg border border-dashed border-white/10 bg-[#0f0f12] px-6 py-8 text-center text-sm text-white/50">
              No electrical sheets were found in this PDF.
            </div>
          )}
      </div>
    </section>
  )
}

function StatusPill({ status }: { status: string }) {
  if (status === "ready") {
    return (
      <Badge className="shrink-0 gap-1 border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20">
        <CheckCircle2 className="h-3 w-3" />
        Ready
      </Badge>
    )
  }
  if (status === "error") {
    return (
      <Badge className="shrink-0 gap-1 border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/20">
        <AlertCircle className="h-3 w-3" />
        Error
      </Badge>
    )
  }
  return (
    <Badge
      className={cn(
        "shrink-0 gap-1 border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20",
      )}
    >
      <Clock className="h-3 w-3 animate-pulse" />
      Processing
    </Badge>
  )
}

function ExtractionBadge({ method }: { method: string }) {
  if (method === "vision") {
    return (
      <Badge className="shrink-0 border-purple-500/30 bg-purple-500/10 text-purple-300 hover:bg-purple-500/20">
        vision
      </Badge>
    )
  }
  return (
    <Badge className="shrink-0 border-brand/30 bg-brand/10 text-brand hover:bg-brand/20">
      text
    </Badge>
  )
}

function ProcessingSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="h-[52px] animate-pulse rounded-lg border border-white/10 bg-[#1a1a1e]"
          style={{ animationDelay: `${i * 120}ms` }}
        />
      ))}
    </div>
  )
}
