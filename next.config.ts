import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  // pdf-lib is pure JS but ships large CJS bundles that webpack will
  // happily try to inline; keeping it external makes the function
  // bundle smaller and avoids accidental tree-shake breakage when
  // pdf-lib internals reach for things at runtime.
  serverExternalPackages: ["pdf-lib"],
}

export default nextConfig
