import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdf-parse", "pdfjs-dist"],
  // pdf-parse's Node text-extraction path lazily requires @napi-rs/canvas
  // (a native binary), which Next's build-time file tracer can miss since
  // it's loaded via a dynamically constructed platform-specific package
  // name. Without this, the extract-pdf route works locally (dev doesn't
  // trace) but crashes at runtime on Vercel with a 500 that never reaches
  // our own error handling.
  outputFileTracingIncludes: {
    "/*": [
      "./node_modules/@napi-rs/**/*",
      "./node_modules/pdfjs-dist/legacy/build/**/*",
    ],
  },
};

export default nextConfig;
