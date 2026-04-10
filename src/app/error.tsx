"use client"

import { AlertTriangle, RotateCcw } from "lucide-react"
import { useEffect } from "react"

import { Button } from "@/components/ui/button"

/**
 * Root route error boundary. Next.js renders this when a server
 * component in any top-level route throws during render. Keeps the
 * app chrome visible, surfaces the error message, and offers a
 * retry that calls Next's `reset()` to re-run the failing render.
 */
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
    <main className="flex min-h-[60vh] flex-col items-center justify-center gap-5 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-red-500/10 text-red-300 ring-1 ring-red-500/30">
        <AlertTriangle className="h-6 w-6" />
      </div>
      <div className="max-w-md">
        <h1 className="font-heading text-2xl font-semibold text-white">
          Something went wrong
        </h1>
        <p className="mt-2 text-sm text-white/60">
          {error.message || "An unexpected error occurred while rendering this page."}
        </p>
        {error.digest && (
          <p className="mt-1 font-mono text-[10px] text-white/30">
            digest: {error.digest}
          </p>
        )}
      </div>
      <Button
        type="button"
        onClick={reset}
        className="bg-brand text-white hover:bg-brand-dark"
      >
        <RotateCcw className="mr-2 h-4 w-4" />
        Try again
      </Button>
    </main>
  )
}
