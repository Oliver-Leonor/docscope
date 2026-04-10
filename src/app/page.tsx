import { Zap } from "lucide-react"
import { Suspense } from "react"

import {
  SessionList,
  SessionListSkeleton,
} from "@/components/session-list"
import { UploadZone } from "@/components/upload-zone"

export const dynamic = "force-dynamic"

export default function Home() {
  return (
    <main className="flex flex-col gap-10">
      <header className="flex flex-col gap-3">
        <div className="inline-flex items-center gap-2 self-start rounded-md border border-white/10 bg-[#111113] px-3 py-1 font-mono text-[11px] uppercase tracking-wider text-brand">
          <Zap className="h-3 w-3" />
          PunchZero
        </div>
        <h1 className="font-heading text-4xl font-semibold tracking-tight text-white sm:text-5xl">
          Electrical PDF QA
        </h1>
        <p className="max-w-2xl text-base text-white/60">
          Upload construction drawing sets. We&apos;ll identify the electrical
          sheets, index their contents, and let you ask questions about the
          electrical scope with citations back to the source sheets.
        </p>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="font-heading text-sm font-medium uppercase tracking-wider text-white/50">
          Upload
        </h2>
        <UploadZone />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-heading text-sm font-medium uppercase tracking-wider text-white/50">
          Past sessions
        </h2>
        <Suspense fallback={<SessionListSkeleton />}>
          <SessionList />
        </Suspense>
      </section>
    </main>
  )
}
