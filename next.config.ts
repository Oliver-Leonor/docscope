import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  // Native + pdfjs-heavy packages must run un-bundled on the server so their
  // dynamic requires (wasm, node-canvas bindings, sharp's libvips) resolve.
  serverExternalPackages: [
    "pdf-parse",
    "pdfjs-dist",
    "@napi-rs/canvas",
    "canvas",
    "sharp",
    "pdf-lib",
  ],
}

export default nextConfig
