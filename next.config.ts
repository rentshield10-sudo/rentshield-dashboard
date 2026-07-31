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
      // The lead-paint disclosure pamphlet is read via fs at PDF-generation
      // time (not imported), so Next's tracer needs to be told about it
      // explicitly or it's silently missing from the Vercel deployment.
      "./lib/assets/**/*",
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
