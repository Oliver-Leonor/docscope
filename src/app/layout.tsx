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
    index: false, // private tool by default — flip when going public
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
      <body className="min-h-full bg-[#0a0a0b] text-[#ededed] font-sans">
        <div className="mx-auto w-full max-w-6xl px-6 py-8">{children}</div>
      </body>
    </html>
  )
}
