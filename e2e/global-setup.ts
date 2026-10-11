import { existsSync, readdirSync, statSync } from "node:fs"
import path from "node:path"

import { E2E_DIST_DIR } from "./fixtures/constants"

const ROOT = path.resolve(__dirname, "..")

function newestMtime(dir: string): number {
  let newest = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) newest = Math.max(newest, newestMtime(full))
    else newest = Math.max(newest, statSync(full).mtimeMs)
  }
  return newest
}

/** Checks that the e2e build exists and is newer than the source. Never builds. */
export default function globalSetup() {
  const buildId = path.join(ROOT, E2E_DIST_DIR, "BUILD_ID")
  if (!existsSync(buildId)) {
    throw new Error(`No e2e build found. Run \`npm run e2e:build\` (or \`npm run test:e2e\`) first.`)
  }
  const built = statSync(buildId).mtimeMs
  const changed = Math.max(newestMtime(path.join(ROOT, "src")), statSync(path.join(ROOT, "next.config.ts")).mtimeMs)
  if (changed > built) {
    const message = "The e2e build is older than the source. Run `npm run e2e:build`."
    if (process.env.E2E_ALLOW_STALE === "1") console.warn(`⚠ ${message}`)
    else throw new Error(`${message} (Set E2E_ALLOW_STALE=1 to run anyway.)`)
  }
}
