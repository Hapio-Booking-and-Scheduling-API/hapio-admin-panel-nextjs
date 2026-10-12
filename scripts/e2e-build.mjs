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
    // Always build the calendar's resource views, whatever .env says, so the specs can rely on them.
    // FullCalendar renders them with a placeholder key and only adds an "invalid license" notice.
    NEXT_PUBLIC_FULLCALENDAR_LICENSE_KEY: "e2e-placeholder-key",
    NEXT_TELEMETRY_DISABLED: "1",
  },
})
process.exit(result.status ?? 1)
