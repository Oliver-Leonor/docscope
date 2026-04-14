"use client"

import { AlertTriangle, RotateCcw } from "lucide-react"
import { useEffect } from "react"

import { Button } from "@/components/ui/button"

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("[root error boundary]", error)
  }, [error])

  return (
    <main className="ds-fade-in flex min-h-[60vh] flex-col items-center justify-center gap-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-red-500/10 text-red-300 ring-1 ring-red-500/30">
        <AlertTriangle className="h-6 w-6" />
      </div>
      <div className="max-w-md">
        <h1 className="font-heading text-2xl font-semibold tracking-tight text-foreground">
          Something went wrong
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {error.message ||
            "An unexpected error occurred while rendering this page."}
        </p>
        {error.digest && (
          <p className="mt-2 font-mono text-[10px] text-[#71717a]">
            digest: {error.digest}
          </p>
        )}
      </div>
      <Button
        type="button"
        onClick={reset}
        className="h-10 bg-brand px-4 text-foreground transition-colors hover:bg-brand-hover"
      >
        <RotateCcw className="mr-2 h-4 w-4" />
        Try again
      </Button>
    </main>
  )
}
