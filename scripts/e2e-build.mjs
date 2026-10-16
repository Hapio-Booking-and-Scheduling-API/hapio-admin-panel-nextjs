// Builds the app for end-to-end tests into .next-e2e, with a dummy token and an
// unreachable base URL baked into nothing: runtime env is supplied per test stack.
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const nextBin = require.resolve("next/dist/bin/next")

const result = spawnSync(process.execPath, [nextBin, "build"], {
  stdio: "inherit",
  env: {
    ...process.env,
    NEXT_DIST_DIR: process.env.E2E_DIST_DIR || ".next-e2e",
    HAPIO_API_TOKEN: "e2e-dummy-token",
    HAPIO_BASE_URL: "http://127.0.0.1:9/v1",
    NEXT_TELEMETRY_DISABLED: "1",
  },
})
process.exit(result.status ?? 1)
