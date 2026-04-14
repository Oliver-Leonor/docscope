import { Loader2 } from "lucide-react"

export default function Loading() {
  return (
    <div className="ds-fade-in flex flex-col gap-12">
      <header className="flex flex-col gap-4">
        <div className="h-5 w-28 animate-pulse rounded-md bg-surface" />
        <div className="h-12 w-80 animate-pulse rounded-lg bg-surface sm:h-14" />
        <div className="h-4 w-full max-w-xl animate-pulse rounded bg-surface" />
      </header>
      <div className="h-56 animate-pulse rounded-xl border border-border bg-surface" />
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin text-brand" />
        Loading…
      </div>
    </div>
  )
}
