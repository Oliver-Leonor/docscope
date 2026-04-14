"use client"

import {
  AlertCircle,
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
 * Session cover page — first thing shown after upload completes.
 */
export function CoverPage({
  pdfFileName,
  status,
  sheets,
  totalSheets,
  errorMessage,
}: CoverPageProps) {
  return (
    <section className="relative overflow-hidden rounded-xl border border-border bg-surface shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset]">
      <div className="absolute inset-y-0 left-0 w-[3px] bg-gradient-to-b from-brand via-brand/50 to-transparent" />

      <div className="p-6 sm:p-8">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand ring-1 ring-inset ring-brand/25">
            <FileText className="h-6 w-6" />
          </div>
          <div className="min-w-0 flex-1 pt-0.5">
            <h2 className="truncate font-heading text-[22px] font-semibold tracking-tight text-foreground sm:text-2xl">
              {pdfFileName}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              <span className="text-foreground">{totalSheets}</span>{" "}
              {totalSheets === 1 ? "page" : "pages"} processed
            </p>
          </div>
          <StatusPill status={status} />
        </div>

        {errorMessage && (
          <div className="mt-5 flex items-start gap-2.5 rounded-lg border border-red-500/30 bg-red-500/[0.04] px-4 py-3 text-sm text-red-300">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <p className="leading-relaxed">{errorMessage}</p>
          </div>
        )}

        <div className="mt-6">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-heading text-[11px] font-medium uppercase tracking-[0.14em] text-[#71717a]">
              Processed pages
            </h3>
            <Badge className="rounded-full border-border bg-surface-elevated px-2 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-surface-elevated">
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
                  className="ds-fade-in-up ds-lift flex items-center gap-3 rounded-lg border border-border bg-surface-elevated px-3 py-2.5 hover:border-[#3f3f46] hover:bg-surface-hover"
                  style={{
                    ["--ds-delay" as string]: `${Math.min(i * 30, 600)}ms`,
                  }}
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-brand/10 text-brand ring-1 ring-inset ring-brand/20">
                    {sheet.extractionMethod === "vision" ? (
                      <Eye className="h-4 w-4" />
                    ) : (
                      <ScanLine className="h-4 w-4" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-[13px] font-semibold tracking-tight text-foreground">
                      {sheet.sheetNumber}
                    </p>
                    <p className="text-[11px] text-[#71717a]">
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
              <div className="rounded-lg border border-dashed border-border bg-[#0f0f12] px-6 py-10 text-center text-sm text-muted-foreground">
                No pages could be read from this PDF.
              </div>
            )}
        </div>
      </div>
    </section>
  )
}

function StatusPill({ status }: { status: string }) {
  if (status === "ready") {
    return (
      <Badge className="shrink-0 gap-1.5 rounded-full border-[#22c55e]/25 bg-[#22c55e]/10 px-2.5 py-0.5 text-[11px] font-medium text-[#4ade80] hover:bg-[#22c55e]/15">
        <span className="h-1.5 w-1.5 rounded-full bg-[#22c55e]" />
        Ready
      </Badge>
    )
  }
  if (status === "error") {
    return (
      <Badge className="shrink-0 gap-1.5 rounded-full border-red-500/30 bg-red-500/10 px-2.5 py-0.5 text-[11px] font-medium text-red-300 hover:bg-red-500/15">
        <AlertCircle className="h-3 w-3" />
        Error
      </Badge>
    )
  }
  return (
    <Badge
      className={cn(
        "shrink-0 gap-1.5 rounded-full border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-medium text-amber-300 hover:bg-amber-500/15",
      )}
    >
      <span className="ds-soft-pulse h-1.5 w-1.5 rounded-full bg-amber-400" />
      Processing
    </Badge>
  )
}

function ExtractionBadge({ method }: { method: string }) {
  if (method === "vision") {
    return (
      <Badge className="shrink-0 rounded-md border-purple-500/25 bg-purple-500/10 px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wide text-purple-300 hover:bg-purple-500/15">
        vision
      </Badge>
    )
  }
  return (
    <Badge className="shrink-0 rounded-md border-brand/25 bg-brand/10 px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wide text-brand hover:bg-brand/15">
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
          className="h-[56px] animate-pulse rounded-lg border border-border bg-surface-elevated"
          style={{ animationDelay: `${i * 120}ms` }}
        />
      ))}
    </div>
  )
}
