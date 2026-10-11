import { test as base, expect } from "@playwright/test"
import { readFileSync } from "node:fs"

import { NetworkSpy } from "../helpers/network"
import { Ui } from "../helpers/ui"
import { E2E_NOW } from "./constants"
import { HapioApi } from "./hapio-api"
import { MockClient } from "./mock-client"
import { ensureStackAlive, startStack, type Stack, type StackOptions } from "./stack"

export interface ConsoleGuard {
  /** Tolerate console errors matching this pattern in the current test. */
  allow(pattern: RegExp): void
  errors(): string[]
}

interface TestFixtures {
  /** The fixed "now" for the mock and the browser clock. */
  now: string
  /** Seed data for the mock: the demo data set, or nothing. */
  seed: "demo" | "empty"
  mock: MockClient
  api: HapioApi
  net: NetworkSpy
  ui: Ui
  consoleGuard: ConsoleGuard
}

interface WorkerFixtures {
  stackOptions: StackOptions
  stack: Stack
}

const ALWAYS_ALLOWED = [
  // Chrome logs every 4xx/5xx response; tests that provoke them assert the UI instead.
  /Failed to load resource/,
]

export const test = base.extend<TestFixtures, WorkerFixtures>({
  stackOptions: [{}, { option: true, scope: "worker" }],

  stack: [
    async ({ stackOptions }, provide, workerInfo) => {
      const stack = await startStack(stackOptions, workerInfo.parallelIndex, workerInfo.project.outputDir)
      await provide(stack)
      await stack.stop()
    },
    { scope: "worker", timeout: 120_000 },
  ],

  baseURL: async ({ stack }, provide) => provide(stack.appUrl),

  now: [E2E_NOW, { option: true }],
  seed: ["demo", { option: true }],

  mock: [
    async ({ stack, now, seed }, provide, testInfo) => {
      await ensureStackAlive(stack)
      const mock = new MockClient(stack.mockUrl)
      await mock.reset({ now, empty: seed === "empty" })
      const logStart = safeSize(stack.logFile)
      await provide(mock)
      if (testInfo.status !== testInfo.expectedStatus) {
        const log = safeRead(stack.logFile).slice(logStart)
        if (log.trim()) await testInfo.attach("stack.log", { body: log, contentType: "text/plain" })
      }
    },
    { auto: true },
  ],

  page: async ({ page, now }, provide) => {
    await page.clock.install({ time: new Date(now) })
    await provide(page)
  },

  api: async ({ stack }, provide) => provide(new HapioApi(stack.mockUrl)),
  net: async ({ page }, provide) => provide(new NetworkSpy(page)),
  ui: async ({ page }, provide) => provide(new Ui(page)),

  consoleGuard: [
    async ({ page }, provide, testInfo) => {
      const errors: string[] = []
      const allowed = [...ALWAYS_ALLOWED]
      page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`))
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(`console.error: ${message.text()}`)
      })
      const unexpected = () => errors.filter((e) => !allowed.some((re) => re.test(e)))
      await provide({ allow: (re) => allowed.push(re), errors: unexpected })
      // Only report when the test itself passed, so the real failure isn't masked.
      if (testInfo.status === testInfo.expectedStatus) {
        expect(unexpected(), "unexpected browser errors").toEqual([])
      }
    },
    { auto: true },
  ],
})

export { expect }

function safeSize(file: string) {
  try {
    return readFileSync(file, "utf8").length
  } catch {
    return 0
  }
}
function safeRead(file: string) {
  try {
    return readFileSync(file, "utf8")
  } catch {
    return ""
  }
}
