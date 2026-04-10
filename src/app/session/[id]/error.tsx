"use client"

import { AlertTriangle, ArrowLeft, RotateCcw } from "lucide-react"
import Link from "next/link"
import { useEffect } from "react"

import { Button } from "@/components/ui/button"

/**
 * Route-segment error boundary scoped to the session detail page.
 * Unlike the root boundary, this keeps the "Back to sessions" link
 * visible so a user who trips an error on a specific session can get
 * back to the home route without a manual URL edit.
 */
export default function SessionError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("[session error boundary]", error)
  }, [error])

  return (
    <main className="flex flex-col gap-6">
      <nav>
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm text-white/50 transition-all duration-200 hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to sessions
        </Link>
      </nav>
      <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-8 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-500/10 text-red-300 ring-1 ring-red-500/30">
          <AlertTriangle className="h-6 w-6" />
        </div>
        <h2 className="mt-4 font-heading text-xl font-semibold text-white">
          Couldn&apos;t load this session
        </h2>
        <p className="mt-2 text-sm text-white/60">
          {error.message || "Something went wrong while rendering the session."}
        </p>
        {error.digest && (
          <p className="mt-1 font-mono text-[10px] text-white/30">
            digest: {error.digest}
          </p>
        )}
        <Button
          type="button"
          onClick={reset}
          className="mt-5 bg-brand text-white hover:bg-brand-dark"
        >
          <RotateCcw className="mr-2 h-4 w-4" />
          Try again
        </Button>
      </div>
    </main>
  )
}
