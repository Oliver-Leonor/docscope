// VISUAL UPDATE: generous p-12 drop zone, muted upload icon that brightens, progress bar during processing, check icon on file selected, red border in error state
"use client"

import {
  CheckCircle2,
  FileText,
  Loader2,
  Upload,
  UploadCloud,
  X,
} from "lucide-react"
import { useRouter } from "next/navigation"
import * as React from "react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type UploadState =
  | { kind: "idle" }
  | { kind: "selected"; file: File }
  | { kind: "uploading"; file: File }
  | { kind: "error"; file?: File; message: string }

export function UploadZone() {
  const router = useRouter()
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [state, setState] = React.useState<UploadState>({ kind: "idle" })
  const [isDragging, setIsDragging] = React.useState(false)

  const handleFile = React.useCallback((file: File | null | undefined) => {
    if (!file) return
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setState({ kind: "error", message: "Only .pdf files are supported." })
      return
    }
    setState({ kind: "selected", file })
  }, [])

  const onDrop = React.useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      setIsDragging(false)
      const file = e.dataTransfer.files?.[0]
      handleFile(file)
    },
    [handleFile],
  )

  const onDragOver = React.useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      setIsDragging(true)
    },
    [],
  )

  const onDragLeave = React.useCallback(() => {
    setIsDragging(false)
  }, [])

  const clearFile = React.useCallback(() => {
    setState({ kind: "idle" })
    if (inputRef.current) inputRef.current.value = ""
  }, [])

  const startUpload = React.useCallback(async () => {
    if (state.kind !== "selected") return
    const file = state.file
    setState({ kind: "uploading", file })

    try {
      const formData = new FormData()
      formData.append("pdf", file)

      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      })

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string
        }
        throw new Error(data.error || `Upload failed (HTTP ${res.status})`)
      }

      const data = (await res.json()) as { sessionId: string }
      router.push(`/session/${data.sessionId}`)
    } catch (err) {
      setState({
        kind: "error",
        file,
        message: err instanceof Error ? err.message : "Upload failed",
      })
    }
  }, [router, state])

  const isUploading = state.kind === "uploading"
  const isError = state.kind === "error"
  const hasFile = state.kind === "selected" || state.kind === "uploading"
  const activeFile =
    state.kind === "selected" || state.kind === "uploading"
      ? state.file
      : state.kind === "error"
      ? state.file
      : undefined

  return (
    <div className="w-full">
      <div
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onClick={() => !isUploading && inputRef.current?.click()}
        className={cn(
          "group relative flex cursor-pointer flex-col items-center justify-center gap-5 overflow-hidden rounded-xl border-2 border-dashed px-8 py-12 transition-all duration-200",
          "border-border bg-surface hover:border-brand/70 hover:bg-[#131318]",
          isDragging &&
            "scale-[1.01] border-brand bg-[#141425] shadow-[0_0_0_1px_rgba(59,130,246,0.3)]",
          isUploading && "cursor-wait opacity-90",
          isError && "border-red-500/50 bg-red-500/[0.04]",
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(e) => handleFile(e.target.files?.[0])}
          disabled={isUploading}
        />

        {!hasFile && (
          <>
            <div
              className={cn(
                "flex h-16 w-16 items-center justify-center rounded-2xl border transition-all duration-200",
                isError
                  ? "border-red-500/30 bg-red-500/10 text-red-300"
                  : "border-border bg-surface-elevated text-[#71717a] group-hover:border-brand/30 group-hover:bg-brand/10 group-hover:text-brand",
                isDragging && "border-brand bg-brand/15 text-brand",
              )}
            >
              <UploadCloud className="h-7 w-7" />
            </div>
            <div className="text-center">
              <p className="text-[15px] font-medium text-foreground">
                {isDragging ? "Drop to upload" : "Drop a PDF drawing set here"}
              </p>
              <p className="mt-1.5 text-sm text-muted-foreground">
                or{" "}
                <span className="text-brand underline-offset-4 group-hover:underline">
                  click to browse
                </span>
                {" "}— up to a few hundred pages
              </p>
            </div>
          </>
        )}

        {hasFile && activeFile && (
          <div className="flex w-full max-w-lg items-center gap-3 rounded-lg border border-border bg-surface-elevated px-4 py-3">
            <div
              className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
                isUploading
                  ? "bg-brand/10 text-brand"
                  : "bg-[#22c55e]/10 text-[#22c55e]",
              )}
            >
              {isUploading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <CheckCircle2 className="h-5 w-5" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 truncate text-sm font-medium text-foreground">
                <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{activeFile.name}</span>
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {isUploading
                  ? "Processing · extracting sheets and embedding content"
                  : formatBytes(activeFile.size)}
              </p>
              {isUploading && (
                <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-surface-hover">
                  <div className="h-full w-1/2 animate-pulse rounded-full bg-gradient-to-r from-brand/60 via-brand to-brand/60" />
                </div>
              )}
            </div>
            {!isUploading && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  clearFile()
                }}
                className="shrink-0 rounded-md p-1.5 text-[#71717a] transition-colors hover:bg-surface-hover hover:text-foreground"
                aria-label="Remove file"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        )}
      </div>

      {state.kind === "error" && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/[0.04] px-3 py-2.5 text-sm text-red-300">
          <div className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-red-400" />
          <p className="leading-relaxed">{state.message}</p>
        </div>
      )}

      <div className="mt-4 flex items-center justify-end gap-3">
        {state.kind === "selected" && (
          <Button
            type="button"
            onClick={startUpload}
            className="h-10 bg-brand px-4 text-foreground shadow-[0_1px_0_0_rgba(255,255,255,0.1)_inset] transition-colors hover:bg-brand-hover"
          >
            <Upload className="mr-2 h-4 w-4" />
            Process drawing set
          </Button>
        )}
        {state.kind === "uploading" && (
          <Button
            type="button"
            disabled
            className="h-10 bg-brand/60 px-4 text-foreground"
          >
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Processing…
          </Button>
        )}
      </div>
    </div>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
