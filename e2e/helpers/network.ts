import type { Page, Request, Route } from "@playwright/test"

export interface HapioCall {
  method: string
  /** API path after /api/hapio/, without the query, e.g. "locations/123". */
  path: string
  /** Decoded query parameters. Brackets stay literal: "starts_at[gte]". */
  query: Record<string, string>
  body: unknown
  request: Request
}

type PathMatch = string | RegExp | ((path: string) => boolean)

function matches(match: PathMatch, path: string) {
  if (typeof match === "string") return path === match
  if (match instanceof RegExp) return match.test(path)
  return match(path)
}

export function parseHapioRequest(request: Request): HapioCall | null {
  const url = new URL(request.url())
  const marker = "/api/hapio/"
  const at = url.pathname.indexOf(marker)
  if (at < 0) return null
  const query: Record<string, string> = {}
  url.searchParams.forEach((value, key) => (query[key] = value))
  let body: unknown = undefined
  const raw = request.postData()
  if (raw) {
    try {
      body = JSON.parse(raw)
    } catch {
      body = raw
    }
  }
  return { method: request.method(), path: url.pathname.slice(at + marker.length), query, body, request }
}

export interface FaultOptions {
  method?: string
  status: number
  body?: unknown
  headers?: Record<string, string>
  /** How many matching requests to fail before letting the rest through (default: all). */
  times?: number
}

/**
 * Records every call the browser makes to the proxy, and lets tests inject
 * faults (status codes the mock can't produce), delays or edited responses.
 */
export class NetworkSpy {
  readonly calls: HapioCall[] = []

  constructor(private readonly page: Page) {
    page.on("request", (request) => {
      const call = parseHapioRequest(request)
      if (call) this.calls.push(call)
    })
  }

  /** Calls matching a method and path, in order. */
  find(method: string, path: PathMatch) {
    return this.calls.filter((c) => c.method === method && matches(path, c.path))
  }

  /** Mutating calls (POST, PUT, PATCH, DELETE). */
  mutations() {
    return this.calls.filter((c) => c.method !== "GET")
  }

  /** Waits for the next matching request. Start waiting before triggering it. */
  async waitFor(method: string, path: PathMatch, predicate?: (call: HapioCall) => boolean): Promise<HapioCall> {
    const request = await this.page.waitForRequest((req) => {
      const call = parseHapioRequest(req)
      return !!call && call.method === method && matches(path, call.path) && (!predicate || predicate(call))
    })
    return parseHapioRequest(request)!
  }

  private route(path: PathMatch, method: string | undefined, handler: (route: Route, call: HapioCall) => Promise<void>, times?: number) {
    let remaining = times ?? Infinity
    return this.page.route("**/api/hapio/**", async (route) => {
      const call = parseHapioRequest(route.request())
      if (!call || remaining <= 0 || (method && call.method !== method) || !matches(path, call.path)) {
        return route.fallback()
      }
      remaining--
      await handler(route, call)
    })
  }

  /** Answers matching requests with a crafted response. */
  fail(path: PathMatch, options: FaultOptions) {
    return this.route(
      path,
      options.method,
      (route) =>
        route.fulfill({
          status: options.status,
          contentType: "application/json",
          headers: options.headers,
          body: options.body === undefined ? "" : JSON.stringify(options.body),
        }),
      options.times
    )
  }

  /** Aborts matching requests (network failure). */
  abort(path: PathMatch, options: { method?: string; times?: number } = {}) {
    return this.route(path, options.method, (route) => route.abort("failed"), options.times)
  }

  /** Delays matching requests before passing them on. */
  delay(path: PathMatch, ms: number, options: { method?: string; times?: number } = {}) {
    return this.route(
      path,
      options.method,
      async (route) => {
        await new Promise((r) => setTimeout(r, ms))
        await route.fallback()
      },
      options.times
    )
  }

  /** Passes the request on, then edits the JSON response. */
  transform(path: PathMatch, edit: (json: unknown) => unknown, options: { method?: string; times?: number } = {}) {
    return this.route(
      path,
      options.method,
      async (route) => {
        const response = await route.fetch()
        const json = await response.json()
        await route.fulfill({ response, json: edit(json) })
      },
      options.times
    )
  }
}
