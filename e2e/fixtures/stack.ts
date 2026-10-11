import { spawn, type ChildProcess } from "node:child_process"
import { createWriteStream, mkdirSync } from "node:fs"
import net from "node:net"
import path from "node:path"

import { E2E_DIST_DIR, E2E_EXTRA_HOST, E2E_NOW, E2E_TOKEN } from "./constants"

const ROOT = path.resolve(__dirname, "../..")
const NEXT_BIN = path.join(ROOT, "node_modules/next/dist/bin/next")
const MOCK_SCRIPT = path.join(ROOT, "scripts/mock-hapio.mjs")
/** The user's own dev server (wired to their real Hapio project) lives here. Never touch it. */
const FORBIDDEN_PORTS = new Set([3000])

export interface StackOptions {
  /** API token given to the app. `null` leaves it unset (HAPIO_NOT_CONFIGURED). */
  token?: string | null
  /** Upstream base URL. Defaults to this stack's mock. */
  baseUrl?: string
}

export interface Stack {
  appUrl: string
  mockUrl: string
  appPort: number
  mockPort: number
  logFile: string
  stop(): Promise<void>
}

async function freePort(): Promise<number> {
  for (;;) {
    const port = await new Promise<number>((resolve, reject) => {
      const server = net.createServer()
      server.unref()
      server.on("error", reject)
      server.listen(0, "127.0.0.1", () => {
        const { port } = server.address() as net.AddressInfo
        server.close(() => resolve(port))
      })
    })
    if (!FORBIDDEN_PORTS.has(port)) return port
  }
}

async function waitFor(url: string, child: ChildProcess, name: string, timeoutMs = 60_000) {
  const started = Date.now()
  let lastError: unknown
  while (Date.now() - started < timeoutMs) {
    if (child.exitCode !== null) throw new Error(`${name} exited early with code ${child.exitCode}`)
    try {
      const res = await fetch(url, { headers: { "X-Hapio-Admin": "1" } })
      if (res.status < 500 || res.headers.get("content-type")?.includes("json")) return
    } catch (error) {
      lastError = error
    }
    await new Promise((r) => setTimeout(r, 150))
  }
  throw new Error(`${name} did not become ready at ${url}: ${String(lastError)}`)
}

function stopChild(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve()
    const timer = setTimeout(() => child.kill("SIGKILL"), 5_000)
    child.once("exit", () => {
      clearTimeout(timer)
      resolve()
    })
    child.kill("SIGTERM")
  })
}

/**
 * Starts an isolated test stack: a mock Hapio API and the production build of the
 * panel wired to it. Each Playwright worker gets its own stack on free ports.
 */
export async function startStack(options: StackOptions, index: number, outputDir: string): Promise<Stack> {
  const [mockPort, appPort] = [await freePort(), await freePort()]
  mkdirSync(outputDir, { recursive: true })
  const logFile = path.join(outputDir, `stack-${index}-${appPort}.log`)
  const log = createWriteStream(logFile, { flags: "a" })

  const mock = spawn(process.execPath, [MOCK_SCRIPT], {
    cwd: ROOT,
    env: {
      ...process.env,
      MOCK_PORT: String(mockPort),
      MOCK_NOW: E2E_NOW,
      MOCK_SEED: "1",
      MOCK_RATE_LIMIT: "1000000",
      MOCK_LOG: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  })
  mock.stdout?.pipe(log, { end: false })
  mock.stderr?.pipe(log, { end: false })
  const mockUrl = `http://127.0.0.1:${mockPort}`
  await waitFor(`${mockUrl}/__health`, mock, "mock")

  const token = options.token === undefined ? E2E_TOKEN : options.token
  const app = spawn(process.execPath, [NEXT_BIN, "start", "-H", "127.0.0.1", "-p", String(appPort)], {
    cwd: ROOT,
    env: {
      ...process.env,
      NEXT_DIST_DIR: E2E_DIST_DIR,
      // Always set both explicitly: values from .env (the user's real project) must never apply.
      HAPIO_BASE_URL: options.baseUrl ?? `${mockUrl}/v1`,
      HAPIO_API_TOKEN: token ?? "",
      ADMIN_ALLOWED_HOSTS: E2E_EXTRA_HOST,
      NEXT_TELEMETRY_DISABLED: "1",
      NODE_ENV: "production",
    },
    stdio: ["ignore", "pipe", "pipe"],
  })
  app.stdout?.pipe(log, { end: false })
  app.stderr?.pipe(log, { end: false })
  const appUrl = `http://127.0.0.1:${appPort}`

  const stop = async () => {
    await Promise.all([stopChild(app), stopChild(mock)])
    log.end()
  }

  try {
    await waitFor(`${appUrl}/api/hapio/project`, app, "app")
    await verifyWiring({ appUrl, mockUrl, options })
  } catch (error) {
    await stop()
    throw error
  }

  return { appUrl, mockUrl, appPort, mockPort, logFile, stop }
}

/**
 * Throws a clear error when this worker's mock or app no longer answers, e.g. after the
 * computer slept mid-run and the servers died. Without it, every later test on the worker
 * fails with a vague UI timeout.
 */
export async function ensureStackAlive(stack: Pick<Stack, "appUrl" | "mockUrl">) {
  const responds = async (url: string, init?: RequestInit) => {
    try {
      await fetch(url, { ...init, signal: AbortSignal.timeout(5_000) })
      return true
    } catch {
      return false
    }
  }
  const [mockUp, appUp] = await Promise.all([
    responds(`${stack.mockUrl}/__health`),
    responds(`${stack.appUrl}/api/hapio/project`, { headers: { "X-Hapio-Admin": "1" } }),
  ])
  if (!mockUp || !appUp) {
    const down = [!mockUp && `mock (${stack.mockUrl})`, !appUp && `app (${stack.appUrl})`].filter(Boolean).join(" and ")
    throw new Error(
      `The test stack for this worker stopped responding: ${down}. Did the computer sleep during the run? Rerun the suite.`
    )
  }
}

/** Refuses to run unless the app really talks to this stack's mock (or the requested upstream). */
async function verifyWiring({ appUrl, mockUrl, options }: { appUrl: string; mockUrl: string; options: StackOptions }) {
  if (FORBIDDEN_PORTS.has(Number(new URL(appUrl).port))) throw new Error("SAFETY: refusing to use port 3000")
  const viaApp = await fetch(`${appUrl}/api/hapio/project`, { headers: { "X-Hapio-Admin": "1" } })
  if (options.token === null) {
    const body = (await viaApp.json()) as { code?: string }
    if (body.code !== "HAPIO_NOT_CONFIGURED") throw new Error("SAFETY: expected an unconfigured app")
    return
  }
  if (options.baseUrl) {
    if (viaApp.ok) throw new Error(`SAFETY: app reached an upstream at ${options.baseUrl}; expected it to be unreachable`)
    return
  }
  const direct = await fetch(`${mockUrl}/v1/project`, { headers: { Authorization: `Bearer ${E2E_TOKEN}` } })
  const [a, b] = [(await viaApp.json()) as { id?: string }, (await direct.json()) as { id?: string }]
  if (!a.id || a.id !== b.id) throw new Error("SAFETY: the app is not wired to the e2e mock")
}
