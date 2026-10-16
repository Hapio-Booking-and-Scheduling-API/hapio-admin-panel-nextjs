// Packs Hapio Calendar from a local checkout into vendor/hapio-calendar and points package.json
// at the tarballs. Hapio Calendar (https://github.com/Hapio-Booking-and-Scheduling-API/hapio-calendar)
// is not on npm yet; once it is, replace the file: dependencies and the overrides with the
// published version and delete this script and the vendor folder.
//
//   npm run hapio-calendar:pack                # build the checkout, pack core + react, npm install
//   npm run hapio-calendar:pack -- --no-build  # the checkout is already built
//   npm run hapio-calendar:pack -- --registry  # also build the shadcn registry from the checkout
//                                              # and reinstall src/components/hapio-calendar from it
//
// The checkout is ../hapio-fullcalendar, or HAPIO_CALENDAR_DIR. Tarball names carry a content
// hash because npm caches file: tarballs by name; the checkout's registry stamper accepts that
// pattern too. With --registry, the compat and recurrence packages are packed as well, since the
// stamper wants every workspace package, but only core and react stay in vendor/.
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const VENDOR = path.join(ROOT, "vendor/hapio-calendar")
const BLOCK_DIR = path.join(ROOT, "src/components/hapio-calendar")
const PUBLIC_REGISTRY = "https://calendar.hapio.io/r/{style}/{name}.json"
/** The packages the app depends on: react depends on core. */
const APP_PACKAGES = ["@hapio/calendar-core", "@hapio/calendar-react"]
const REGISTRY_ONLY_PACKAGES = ["@hapio/calendar-compat", "@hapio/calendar-recurrence"]

const build = !process.argv.includes("--no-build")
const registry = process.argv.includes("--registry")
const checkout = path.resolve(process.env.HAPIO_CALENDAR_DIR ?? path.join(ROOT, "../hapio-fullcalendar"))
if (!existsSync(path.join(checkout, "pnpm-workspace.yaml"))) {
  console.error(`No Hapio Calendar checkout at ${checkout} (set HAPIO_CALENDAR_DIR).`)
  process.exit(2)
}
const localPnpm = path.join(checkout, ".tools/node_modules/.bin/pnpm")
const pnpm = existsSync(localPnpm) ? localPnpm : "pnpm"

function run(command, args, cwd, options = {}) {
  console.log(`$ ${path.basename(command)} ${args.join(" ")}   (in ${path.relative(ROOT, cwd) || "."})`)
  const result = spawnSync(command, args, { cwd, stdio: "inherit", ...options })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"))
}

function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
}

/** Points package.json at the vendored tarballs (shadcn add may have rewritten the specs). */
function pointManifestAtVendor(tarballs) {
  const manifestFile = path.join(ROOT, "package.json")
  const manifest = readJson(manifestFile)
  manifest.overrides ??= {}
  for (const name of APP_PACKAGES) {
    manifest.dependencies[name] = `file:vendor/hapio-calendar/${tarballs.get(name)}`
    // The react tarball depends on the published @hapio/calendar-core version, which doesn't exist.
    manifest.overrides[name] = `$${name}`
  }
  manifest.dependencies = Object.fromEntries(
    Object.entries(manifest.dependencies).sort(([a], [b]) => a.localeCompare(b))
  )
  writeJson(manifestFile, manifest)
}

/**
 * The calendar-theme item merges its CSS into globals.css; on a reinstall the shadcn CLI appends
 * the theme's `@property` rules again instead of recognising them. Keep the first of each.
 */
function dedupeThemeProperties() {
  const cssFile = path.join(ROOT, "src/app/globals.css")
  const seen = new Set()
  const css = readFileSync(cssFile, "utf8").replace(/@property\s+(--[\w-]+)\s*\{[^}]*\}\n?/g, (rule, name) => {
    if (seen.has(name)) return ""
    seen.add(name)
    return rule
  })
  writeFileSync(cssFile, css)
}

if (build) run(pnpm, ["build"], checkout)

// Pack into a staging folder, then into vendor/ under hashed names.
const staging = mkdtempSync(path.join(tmpdir(), "hapio-calendar-"))
const tarballs = new Map()
for (const name of registry ? [...APP_PACKAGES, ...REGISTRY_ONLY_PACKAGES] : APP_PACKAGES) {
  const dir = path.join(checkout, "packages", name.replace("@hapio/calendar-", ""))
  if (!existsSync(path.join(dir, "dist"))) {
    console.error(`${name} has no dist/ in ${dir}: run without --no-build.`)
    process.exit(2)
  }
  const { version } = readJson(path.join(dir, "package.json"))
  run(pnpm, ["pack", "--pack-destination", staging], dir)
  const base = `${name.replace(/^@/, "").replace("/", "-")}-${version}`
  const packed = path.join(staging, `${base}.tgz`)
  const hash = createHash("sha256").update(readFileSync(packed)).digest("hex").slice(0, 12)
  tarballs.set(name, `${base}-${hash}.tgz`)
  renameSync(packed, path.join(staging, `${base}-${hash}.tgz`))
}
mkdirSync(VENDOR, { recursive: true })
for (const file of readdirSync(VENDOR)) if (file.endsWith(".tgz")) rmSync(path.join(VENDOR, file))
for (const file of tarballs.values()) renameSync(path.join(staging, file), path.join(VENDOR, file))
rmSync(staging, { recursive: true, force: true })
pointManifestAtVendor(tarballs)

if (registry) {
  // Build the registry inside the checkout (its stamper insists), in the gitignored smoke folder.
  const work = path.join(checkout, "tests/registry-smoke/.apps/.work/hapio-dp")
  rmSync(work, { recursive: true, force: true })
  run(
    process.execPath,
    [path.join(checkout, "scripts/registry-inject-versions.ts"), "--local-tarballs", VENDOR, "--out-dir", path.join(work, "registry-build")],
    checkout
  )
  run(path.join(checkout, "node_modules/.bin/shadcn"), ["build", path.join(work, "registry-build/registry.json"), "-o", path.join(work, "r")], checkout)
  for (const name of REGISTRY_ONLY_PACKAGES) rmSync(path.join(VENDOR, tarballs.get(name)))

  // Reinstall the block from the local registry: the `@hapio` namespace resolves the item's
  // registry dependencies, and "n" answers the prompts to overwrite the app's own shadcn
  // components (button, popover, scroll-area).
  const componentsFile = path.join(ROOT, "components.json")
  const components = readJson(componentsFile)
  const registries = components.registries
  writeJson(componentsFile, { ...components, registries: { ...registries, "@hapio": path.join(work, "r/{name}.json") } })
  try {
    rmSync(BLOCK_DIR, { recursive: true, force: true })
    run(path.join(ROOT, "node_modules/.bin/shadcn"), ["add", path.join(work, "r/hapio-calendar.json"), "--yes"], ROOT, {
      stdio: ["pipe", "inherit", "inherit"],
      input: "n\n".repeat(50),
    })
  } finally {
    writeJson(componentsFile, { ...components, registries: { ...registries, "@hapio": PUBLIC_REGISTRY } })
  }
  // shadcn add installs the tarball by its absolute path and may bump other dependencies.
  pointManifestAtVendor(tarballs)
  dedupeThemeProperties()
}

run("npm", ["install"], ROOT)

console.log(`
Packed ${APP_PACKAGES.map((name) => tarballs.get(name)).join(", ")} into vendor/hapio-calendar.${
  registry
    ? `\nReinstalled src/components/hapio-calendar from the checkout's registry; review the diff.`
    : `\nThe registry files in src/components/hapio-calendar are a copy of the same version: run with --registry to refresh them too.`
}`)
