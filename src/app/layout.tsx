// VISUAL UPDATE: removed hard-coded body colors, added gradient backdrop + subtle radial accent, max-width 1200px container
import type { Metadata } from "next"
import { DM_Sans, JetBrains_Mono } from "next/font/google"
import "./globals.css"

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  display: "swap",
})

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "swap",
})

const siteName = "PunchZero — Electrical PDF QA"
const siteDescription =
  "Upload construction drawing sets, automatically identify the electrical sheets, and query their contents with citations back to the source."

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  ),
  title: {
    default: siteName,
    template: "%s · PunchZero",
  },
  description: siteDescription,
  applicationName: "PunchZero",
  keywords: [
    "electrical drawings",
    "construction documents",
    "PDF QA",
    "RAG",
    "pgvector",
    "punchzero",
  ],
  authors: [{ name: "PunchZero" }],
  openGraph: {
    type: "website",
    title: siteName,
    description: siteDescription,
    siteName: "PunchZero",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: siteName,
    description: siteDescription,
  },
  robots: {
    index: false,
    follow: false,
  },
  icons: {
    icon: "/favicon.ico",
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      className={`dark ${dmSans.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="relative min-h-full bg-background text-foreground font-sans">
        {/* Subtle top-of-page radial glow — construction tool feel
            without crossing into consumer-y territory. */}
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-x-0 top-0 -z-10 h-[420px] bg-[radial-gradient(ellipse_70%_60%_at_50%_0%,rgba(59,130,246,0.08),transparent_70%)]"
        />
        <div className="mx-auto w-full max-w-[1200px] px-6 py-8 sm:px-8 sm:py-10">
          {children}
        </div>
      </body>
    </html>
  )
}
