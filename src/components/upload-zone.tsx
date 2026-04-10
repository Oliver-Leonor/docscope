"use client"

import { FileText, Loader2, Upload, X } from "lucide-react"
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
          "group relative flex cursor-pointer flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed px-8 py-14 transition",
          "border-white/10 bg-[#111113] hover:border-brand/60 hover:bg-[#13131a]",
          isDragging && "border-brand bg-[#14142b]",
          isUploading && "cursor-wait opacity-80",
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
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand/10 text-brand ring-1 ring-brand/30">
              <Upload className="h-6 w-6" />
            </div>
            <div className="text-center">
              <p className="text-base font-medium text-white">
                Drop a PDF drawing set here
              </p>
              <p className="mt-1 text-sm text-white/50">
                or click to browse — up to a few hundred pages
              </p>
            </div>
          </>
        )}

        {hasFile && activeFile && (
          <div className="flex w-full max-w-md items-center gap-3 rounded-lg border border-white/10 bg-[#1a1a1e] px-4 py-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-brand/10 text-brand">
              {isUploading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <FileText className="h-5 w-5" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-white">
                {activeFile.name}
              </p>
              <p className="text-xs text-white/50">
                {isUploading
                  ? "Processing… extracting sheets and embedding text"
                  : formatBytes(activeFile.size)}
              </p>
            </div>
            {!isUploading && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  clearFile()
                }}
                className="rounded p-1 text-white/40 hover:bg-white/5 hover:text-white"
                aria-label="Remove file"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        )}
      </div>

      {state.kind === "error" && (
        <p className="mt-3 text-sm text-red-400">{state.message}</p>
      )}

      <div className="mt-4 flex items-center justify-end gap-3">
        {state.kind === "selected" && (
          <Button
            type="button"
            onClick={startUpload}
            className="bg-brand text-white hover:bg-brand-dark"
          >
            <Upload className="mr-2 h-4 w-4" />
            Process drawing set
          </Button>
        )}
        {state.kind === "uploading" && (
          <Button type="button" disabled className="bg-brand/60 text-white">
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
