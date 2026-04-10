import { Loader2 } from "lucide-react"

/**
 * Loading skeleton for the session detail route. Shown briefly by
 * Next.js while the client component bundle resolves on first visit.
 * Once the client component mounts it takes over with its own
 * `LoadingState` tied to the status poll.
 */
export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div className="h-4 w-32 animate-pulse rounded bg-white/5" />
        <div className="h-4 w-40 animate-pulse rounded bg-white/5" />
      </div>
      <div className="flex items-center justify-center gap-2 py-20 text-sm text-white/50">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading session…
      </div>
    </div>
  )
}
