import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = Array.isArray(config.externals) ? config.externals : [config.externals || {}];
      config.externals.push("pdf-parse", "pdfjs-dist");
    }
    return config;
  },
};

export default nextConfig;
