"use client"

import { AlertTriangle, ArrowLeft, RotateCcw } from "lucide-react"
import Link from "next/link"
import { useEffect } from "react"

import { Button } from "@/components/ui/button"

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
    <main className="ds-fade-in flex flex-col gap-6">
      <nav>
        <Link
          href="/"
          className="group inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
          Back to documents
        </Link>
      </nav>
      <div className="rounded-xl border border-red-500/30 bg-red-500/[0.04] p-10 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-500/10 text-red-300 ring-1 ring-red-500/30">
          <AlertTriangle className="h-6 w-6" />
        </div>
        <h2 className="mt-5 font-heading text-xl font-semibold tracking-tight text-foreground">
          Couldn&apos;t load this session
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {error.message ||
            "Something went wrong while rendering the session."}
        </p>
        {error.digest && (
          <p className="mt-2 font-mono text-[10px] text-[#71717a]">
            digest: {error.digest}
          </p>
        )}
        <Button
          type="button"
          onClick={reset}
          className="mt-6 h-10 bg-brand px-4 text-foreground transition-colors hover:bg-brand-hover"
        >
          <RotateCcw className="mr-2 h-4 w-4" />
          Try again
        </Button>
      </div>
    </main>
  )
}
