# Changelog

## Visual Polish Pass — 2026-04-12

A comprehensive visual audit and polish of every page and component in the Electrical PDF QA app. Logic, API routes, data fetching, and state management are untouched — this pass is pure CSS / Tailwind / className refinement.

### Design system foundations

- **`src/app/globals.css`** — Overhauled the dark-theme token system. Added named surface (`bg-surface`, `bg-surface-elevated`, `bg-surface-hover`, `bg-surface-sunken`), border (`border-border-subtle`, `border-border-strong`), brand (`bg-brand`, `bg-brand-hover`, `text-brand`), and success (`text-success`, `bg-success-muted`) tokens via Tailwind v4's `@theme inline`. Updated `.dark` with exact spec hex values (`#09090b` / `#111113` / `#1a1a1e` / `#27272a` / `#3b82f6` / `#22c55e` / `#fafafa` / `#a1a1aa` / `#71717a`). Added `.pz-fade-in`, `.pz-fade-in-up`, `.pz-lift`, `.pz-soft-pulse`, `.pz-cursor`, and `.pz-scroll` utility classes plus `font-variant-numeric: tabular-nums` on `.font-mono` so circuit numbers line up.

- **`src/app/layout.tsx`** — Replaced hard-coded `bg-[#0a0a0b]` body colors with semantic `bg-background text-foreground`. Added a fixed, pointer-disabled radial-gradient backdrop in the brand color (8% opacity) so the top of every page has a subtle construction-tool glow. Bumped the max-width container from 1152px (`max-w-6xl`) to **1200px** per the responsive spec, with `sm:px-8 sm:py-10` padding.

### Home surface

- **`src/app/page.tsx`** — Tightened the header: smaller eyebrow tag, larger hero heading (`44px → 56px`), refined subtitle type. Added a reusable `SectionHeader` that pairs an uppercase label with a thin divider rule (consistent with the Chat section header). Wraps in `pz-fade-in` so the page drifts up on mount.

- **`src/app/loading.tsx`** — Skeleton rebuilt with semantic surface tokens, matches the new home-page rhythm and uses the brand-colored spinner.

- **`src/app/error.tsx`** — Pz-fade-in on mount, semantic tokens, tightened type hierarchy on the error card.

### Upload zone

- **`src/components/upload-zone.tsx`** — Bumped padding to `p-12` for a more generous drop target. Upload icon now muted (`#71717a`) and brightens to brand on hover/drag-over. Added a **progress bar** inside the file card during processing (animated brand gradient). File-selected state shows a green **check icon** instead of a generic file icon. Error state gets a red-bordered callout (not just red text). Drag-over now adds a 1% scale transform and a brand-colored ring. Button uses `bg-brand-hover` instead of the old too-dark `#1e40af`.

### Session list

- **`src/components/session-list.tsx`** — Each row uses the new `pz-lift` hover (translate-up 1px + subtle shadow) and `pz-fade-in-up` with staggered `--pz-delay` on mount. Border hover goes to `#3f3f46` per spec. Icon tile gets a subtle ring. Status pill rewritten: green with a solid dot for Ready (`#22c55e`), amber soft-pulse dot for Processing, red for Error. Added a **relative time formatter** (`formatRelative`) that shows "just now / N minutes ago / N hours ago / N days ago" with a short absolute date fallback past a week.

- **`src/components/delete-session-button.tsx`** — Trigger button now opacity-0 by default and fades in on `group-hover` so the row stays clean when idle. Dialog uses semantic tokens throughout; cancel button uses `hover:bg-surface-elevated`.

### Cover page (the evaluator's first impression)

- **`src/components/cover-page.tsx`** — Added a **brand-colored accent rule** on the left edge of the card (gradient from brand → transparent) as a visual anchor. File name bumped to `22px/24px`, heavier tracking. Refined the Ready badge to a small pill with a green dot. Sheet cards use `pz-lift` + `pz-fade-in-up` with staggered delays, `ring-1 ring-inset` on the icon tile. Extraction-method badges are now rounded-md uppercase mono pills (`text` in brand tint, `vision` in purple tint) — small and subtle per spec.

### Chat surface

- **`src/components/chat.tsx`** — Panel now uses `min-h-0 flex-1` so it grows to fill the viewport inside the session page's flex column. Added the Chat section header that matches the Upload / Past sessions rule. Scroll area uses the new `.pz-scroll` thin-scrollbar utility. Input textarea also uses `.pz-scroll` and has a 2px focus ring. Send button uses `bg-brand-hover` and goes to a proper disabled gray. Empty state gets a glowing Sparkles icon (with `box-shadow: 0 0 40px -10px brand`), larger gap rhythm, and hover-fills on suggested question chips. Footer switched from plain text to a `<kbd>`-styled keyboard shortcut row. Passes a new `streaming` prop to `MessageBubble` so the assistant bubble shows a live cursor.

- **`src/components/message-bubble.tsx`** — User messages are `rounded-2xl rounded-br-sm` (sharp tail on bottom-right) on brand blue, assistant messages `rounded-2xl rounded-bl-sm` on `bg-surface-elevated` with the full border. Inline citation badges are now `rounded-md` with a brand ring. Sources footer uses a mono all-caps label. Added optional `streaming` prop that renders a blinking `.pz-cursor` after the last token. Every bubble animates in with `pz-fade-in`.

### Session detail page

- **`src/app/session/[id]/page.tsx`** — Changed the root layout to `flex min-h-[calc(100vh-5rem)] flex-col gap-6` so the Chat panel can flex-grow to fill the remaining viewport height (addresses "chat section: flex-grow to fill remaining viewport" in the spec). Back link gets a subtle arrow translate on hover. Session ID tag is right-aligned in mono muted text and hides the "PunchZero ·" prefix below the `sm` breakpoint to make room on narrow screens. All state containers use semantic tokens and pz-fade-in.

- **`src/app/session/[id]/loading.tsx`** — Matches the new session nav layout, brand-colored spinner.

- **`src/app/session/[id]/error.tsx`** — Matches the new layout, semantic tokens, pz-fade-in.

## Files modified (14)

| # | File | One-line summary |
| --- | --- | --- |
| 1 | `src/app/globals.css` | New dark-theme token system + animation utilities (`pz-fade-in`, `pz-lift`, `pz-soft-pulse`, `pz-cursor`, `pz-scroll`) |
| 2 | `src/app/layout.tsx` | Semantic body bg/text, 1200px container, subtle brand radial backdrop |
| 3 | `src/app/page.tsx` | Sharper hero, reusable `SectionHeader` with divider rule, pz-fade-in |
| 4 | `src/app/loading.tsx` | Skeleton on semantic tokens with brand spinner |
| 5 | `src/app/error.tsx` | Semantic tokens, tightened type, pz-fade-in |
| 6 | `src/app/session/[id]/page.tsx` | Flex-grow chat layout, compact nav, pz-fade-in |
| 7 | `src/app/session/[id]/loading.tsx` | Matches new session nav layout |
| 8 | `src/app/session/[id]/error.tsx` | Matches new layout, pz-fade-in |
| 9 | `src/components/upload-zone.tsx` | p-12 drop zone, muted→brand icon, progress bar, check-icon file state, red error callout |
| 10 | `src/components/session-list.tsx` | pz-lift hover, relative-time formatter, sharper status pills, refined skeleton |
| 11 | `src/components/delete-session-button.tsx` | Group-hover trigger fade, semantic tokens in dialog |
| 12 | `src/components/cover-page.tsx` | Brand accent left-rule, mono sheet numbers, sharper extraction pills, staggered pz-fade-in-up |
| 13 | `src/components/chat.tsx` | Flex-grow panel, pz-scroll, kbd shortcut footer, hover-fill chips, streaming cursor |
| 14 | `src/components/message-bubble.tsx` | Rounded-br-sm user tail, ring-inset citation pills, streaming cursor, sources footer |

## Scope verification

- **No files modified in `src/lib/`** ✅
- **No files modified in `src/app/api/`** ✅
- **No npm packages added** ✅
- **No existing functionality removed** ✅

Every modified file has a `// VISUAL UPDATE: …` comment on the first line summarizing what changed.

## Build verification

```
$ npm run build
▲ Next.js 16.2.3 (Turbopack)
✓ Compiled successfully in 2.1s
  Running TypeScript ...
  Finished TypeScript in 2.1s
✓ Generating static pages using 7 workers (3/3) in 85ms

Route (app)
┌ ƒ /
├ ○ /_not-found
├ ƒ /api/session/[id]
├ ƒ /api/session/[id]/chat
├ ƒ /api/session/[id]/messages
├ ƒ /api/session/[id]/status
├ ƒ /api/upload
└ ƒ /session/[id]
```

Zero errors, zero warnings.
