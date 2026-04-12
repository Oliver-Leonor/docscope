// VISUAL UPDATE: skeleton uses semantic tokens, matches new session-page nav layout
import { Loader2 } from "lucide-react"

export default function Loading() {
  return (
    <div className="pz-fade-in flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div className="h-4 w-32 animate-pulse rounded bg-surface" />
        <div className="h-4 w-40 animate-pulse rounded bg-surface" />
      </div>
      <div className="flex flex-1 items-center justify-center gap-2 py-20 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin text-brand" />
        Loading session…
      </div>
    </div>
  )
}
