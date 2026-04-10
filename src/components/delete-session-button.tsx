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

/**
 * Trash-can button rendered inside each session-list row.
 *
 * Opens a confirmation dialog (shadcn `Dialog`) before hitting
 * `DELETE /api/session/[id]`. On success, calls `router.refresh()`
 * so the server-component `SessionList` re-fetches from Prisma
 * without a full page reload.
 *
 * `stopPropagation` on the trigger click prevents the parent row's
 * Link from navigating when a user reaches for the trash icon.
 */
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
        className="shrink-0 rounded-md p-2 text-white/40 transition-all duration-200 hover:bg-red-500/10 hover:text-red-300"
      >
        <Trash2 className="h-4 w-4" />
      </DialogTrigger>
      <DialogContent className="border-white/10 bg-[#111113] text-white sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete session?</DialogTitle>
          <DialogDescription className="text-white/60">
            This will permanently remove{" "}
            <span className="font-mono text-white">{pdfFileName}</span> and all
            of its extracted sheets, embeddings, and chat history. This action
            cannot be undone.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p className="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        )}
        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={isDeleting}
            className="border-white/10 bg-transparent text-white hover:bg-white/5 hover:text-white"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            disabled={isDeleting}
            className="bg-red-500 text-white hover:bg-red-600 disabled:bg-red-500/50"
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
