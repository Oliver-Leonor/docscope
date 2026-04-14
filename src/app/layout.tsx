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

const siteName = "DocScope — AI Document Intelligence"
const siteDescription =
  "Upload any PDF. Ask questions. Get answers with page-level citations."

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  ),
  title: {
    default: siteName,
    template: "%s · DocScope",
  },
  description: siteDescription,
  applicationName: "DocScope",
  keywords: [
    "document intelligence",
    "pdf question answering",
    "RAG",
    "pgvector",
    "OpenAI",
    "docscope",
  ],
  authors: [{ name: "DocScope" }],
  openGraph: {
    type: "website",
    title: siteName,
    description: siteDescription,
    siteName: "DocScope",
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
