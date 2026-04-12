// VISUAL UPDATE: tighter header with eyebrow tag, section headers with thin divider rules, pz-fade-in on page mount
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
    <main className="pz-fade-in flex flex-col gap-12">
      <header className="flex flex-col gap-4">
        <div className="inline-flex items-center gap-1.5 self-start rounded-md border border-border bg-surface px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-brand">
          <Zap className="h-3 w-3" />
          PunchZero
        </div>
        <h1 className="font-heading text-[44px] font-semibold leading-[1.05] tracking-tight text-foreground sm:text-[56px]">
          Electrical PDF QA
        </h1>
        <p className="max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-[17px]">
          Upload construction drawing sets. We&apos;ll identify the electrical
          sheets, index their contents, and let you ask questions about the
          electrical scope with citations back to the source sheets.
        </p>
      </header>

      <section className="flex flex-col gap-4">
        <SectionHeader label="Upload" />
        <UploadZone />
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeader label="Past sessions" />
        <Suspense fallback={<SessionListSkeleton />}>
          <SessionList />
        </Suspense>
      </section>
    </main>
  )
}

function SectionHeader({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3">
      <h2 className="font-heading text-[11px] font-medium uppercase tracking-[0.14em] text-[#71717a]">
        {label}
      </h2>
      <div className="h-px flex-1 bg-border" />
    </div>
  )
}
