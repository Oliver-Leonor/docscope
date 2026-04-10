import { Loader2 } from "lucide-react"

/**
 * Route-level loading UI shown by Next.js while the home route's
 * server components are streaming. Matches the dark theme and stays
 * compact — the per-section `SessionListSkeleton` handles the more
 * granular loading state inside the page itself.
 */
export default function Loading() {
  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-col gap-3">
        <div className="h-5 w-24 animate-pulse rounded bg-white/5" />
        <div className="h-10 w-72 animate-pulse rounded bg-white/5 sm:h-12" />
        <div className="h-4 w-full max-w-xl animate-pulse rounded bg-white/5" />
      </header>
      <div className="h-56 animate-pulse rounded-xl border border-white/10 bg-[#111113]" />
      <div className="flex items-center gap-2 text-sm text-white/50">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading…
      </div>
    </div>
  )
}
