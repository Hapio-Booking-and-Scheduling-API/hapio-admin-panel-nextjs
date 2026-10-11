import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // End-to-end tests build into their own directory (see scripts/e2e-build.mjs)
  // so they never disturb the dev server's .next folder.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
