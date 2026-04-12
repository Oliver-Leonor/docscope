// VISUAL UPDATE: dialog uses semantic tokens, subtler trigger button, tightened type
"use client"

import { Loader2, Trash2 } from "lucide-react"
import { useRouter } from "next/navigation"
import * as React from "react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"

interface DeleteSessionButtonProps {
  sessionId: string
  pdfFileName: string
}

export function DeleteSessionButton({
  sessionId,
  pdfFileName,
}: DeleteSessionButtonProps) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [isDeleting, setIsDeleting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const onConfirm = React.useCallback(async () => {
    setIsDeleting(true)
    setError(null)
    try {
      const res = await fetch(`/api/session/${sessionId}`, {
        method: "DELETE",
      })
      if (!res.ok && res.status !== 204) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string
        }
        throw new Error(data.error || `Delete failed (HTTP ${res.status})`)
      }
      setOpen(false)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed")
    } finally {
      setIsDeleting(false)
    }
  }, [router, sessionId])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setOpen(true)
        }}
        aria-label={`Delete session ${pdfFileName}`}
        className="shrink-0 rounded-md p-2 text-[#71717a] opacity-0 transition-all duration-200 hover:bg-red-500/10 hover:text-red-300 focus-visible:opacity-100 group-hover:opacity-100"
      >
        <Trash2 className="h-4 w-4" />
      </DialogTrigger>
      <DialogContent className="border-border bg-surface text-foreground sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-[17px] font-semibold tracking-tight">
            Delete session?
          </DialogTitle>
          <DialogDescription className="text-sm leading-relaxed text-muted-foreground">
            This will permanently remove{" "}
            <span className="font-mono text-foreground">{pdfFileName}</span>{" "}
            and all of its extracted sheets, embeddings, and chat history.
            This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p className="rounded-md border border-red-500/30 bg-red-500/[0.06] px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        )}
        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={isDeleting}
            className="h-9 border-border bg-transparent text-foreground transition-colors hover:bg-surface-elevated hover:text-foreground"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            disabled={isDeleting}
            className="h-9 bg-red-500 text-foreground transition-colors hover:bg-red-600 disabled:bg-red-500/50"
          >
            {isDeleting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Deleting…
              </>
            ) : (
              <>
                <Trash2 className="mr-2 h-4 w-4" />
                Delete session
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
