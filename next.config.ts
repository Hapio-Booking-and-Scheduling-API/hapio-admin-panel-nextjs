import type { NextConfig } from "next";

// Only this panel itself may frame its pages, unless other origins are listed
// in ADMIN_FRAME_ANCESTORS (comma-separated, e.g. https://intranet.example.com).
// It has no login, so being framed by any site would invite clickjacking.
const frameAncestors = (process.env.ADMIN_FRAME_ANCESTORS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

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
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: `frame-ancestors ${["'self'", ...frameAncestors].join(" ")}`,
          },
          // For browsers without frame-ancestors; it can't list other origins
          ...(frameAncestors.length ? [] : [{ key: "X-Frame-Options", value: "SAMEORIGIN" }]),
        ],
      },
    ];
  },
};

export default nextConfig;
