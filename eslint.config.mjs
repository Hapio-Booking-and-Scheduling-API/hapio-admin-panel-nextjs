import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Test output and the end-to-end build.
    ".next-e2e*/**",
    "playwright-report/**",
    "test-results*/**",
    "blob-report/**",
    // Claude Code worktrees (gitignored) hold their own builds.
    ".claude/worktrees/**",
  ]),
  {
    // Hapio Calendar's registry files, copied verbatim by `npm run hapio-calendar:pack -- --registry`.
    files: ["src/components/hapio-calendar/**"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-empty-object-type": "off",
    },
  },
  {
    // Playwright fixtures aren't React hooks.
    files: ["e2e/**"],
    rules: { "react-hooks/rules-of-hooks": "off" },
  },
]);

export default eslintConfig;
