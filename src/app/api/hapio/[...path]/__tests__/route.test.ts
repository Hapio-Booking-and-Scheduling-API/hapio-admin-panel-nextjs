import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { DELETE, GET, PATCH, POST, PUT } from "../route"

type Ctx = Parameters<typeof GET>[1]
type FetchMock = (input: string, init?: RequestInit) => Promise<Response>

const HANDLERS = { GET, POST, PUT, PATCH, DELETE }
type Method = keyof typeof HANDLERS

const TRUSTED = { host: "localhost:3000", "x-hapio-admin": "1", "sec-fetch-site": "same-origin" }

function request(
  method: Method,
  url = "http://localhost:3000/api/hapio/locations",
  headers: Record<string, string | undefined> = TRUSTED,
  body?: string
) {
  const clean = Object.fromEntries(Object.entries(headers).filter(([, v]) => v !== undefined)) as Record<string, string>
  return new NextRequest(url, { method, headers: clean, body })
}

const ctx = (path: string[] | undefined): Ctx => ({ params: Promise.resolve({ path }) }) as unknown as Ctx

async function call(
  method: Method,
  options: { path?: string[]; url?: string; headers?: Record<string, string | undefined>; body?: string } = {}
) {
  const path = "path" in options ? options.path : ["locations"]
  return HANDLERS[method](request(method, options.url, options.headers ?? TRUSTED, options.body), ctx(path))
}

let fetchMock: ReturnType<typeof vi.fn<FetchMock>>

beforeEach(() => {
  vi.stubEnv("HAPIO_API_TOKEN", "test-token")
  vi.stubEnv("HAPIO_BASE_URL", "http://mock.test/v1")
  vi.stubEnv("ADMIN_ALLOWED_HOSTS", "")
  fetchMock = vi.fn<FetchMock>(async () =>
    Response.json({ data: [] }, { status: 200, headers: { "x-ratelimit-limit": "200", "x-ratelimit-remaining": "199" } })
  )
  vi.stubGlobal("fetch", fetchMock)
})

function upstream() {
  const call = fetchMock.mock.calls.at(-1)
  if (!call) throw new Error("upstream fetch was not called")
  const [url, init = {}] = call
  return { url, init, headers: init.headers as Record<string, string> }
}

async function expectRejected(response: Response, status: number, message: string) {
  expect(response.status).toBe(status)
  expect(await response.json()).toEqual({ message })
  expect(fetchMock).not.toHaveBeenCalled()
}

describe("guards: host allow-list", () => {
  it.each(["localhost:3000", "localhost", "127.0.0.1:3000", "127.0.0.1", "[::1]:3000", "[::1]", "LOCALHOST:3000"])(
    "allows %s",
    async (host) => {
      const response = await call("GET", { headers: { ...TRUSTED, host } })
      expect(response.status).toBe(200)
    }
  )

  it.each(["evil.com", "evil.com:3000", "localhost.evil.com", "127.0.0.2", "[::2]:3000", "0.0.0.0:3000"])(
    "rejects %s",
    async (host) => {
      await expectRejected(
        await call("GET", { headers: { ...TRUSTED, host } }),
        403,
        "Host not allowed. Add it to ADMIN_ALLOWED_HOSTS."
      )
    }
  )

  it("rejects a request without a Host header", async () => {
    await expectRejected(
      await call("GET", { headers: { ...TRUSTED, host: undefined } }),
      403,
      "Host not allowed. Add it to ADMIN_ALLOWED_HOSTS."
    )
  })

  it("allows extra hosts from ADMIN_ALLOWED_HOSTS (comma-separated, trimmed, case-insensitive)", async () => {
    vi.stubEnv("ADMIN_ALLOWED_HOSTS", " Admin.Example.com , ,panel.lan")
    expect((await call("GET", { headers: { ...TRUSTED, host: "admin.example.com" } })).status).toBe(200)
    expect((await call("GET", { headers: { ...TRUSTED, host: "ADMIN.EXAMPLE.COM:8443" } })).status).toBe(200)
    expect((await call("GET", { headers: { ...TRUSTED, host: "panel.lan:3000" } })).status).toBe(200)
    expect((await call("GET", { headers: { ...TRUSTED, host: "other.lan" } })).status).toBe(403)
  })

  it("keeps the defaults when ADMIN_ALLOWED_HOSTS is unset", async () => {
    vi.stubEnv("ADMIN_ALLOWED_HOSTS", undefined)
    expect((await call("GET", { headers: { ...TRUSTED, host: "[::1]:3000" } })).status).toBe(200)
    expect((await call("GET", { headers: { ...TRUSTED, host: "example.com" } })).status).toBe(403)
  })
})

describe("guards: X-Hapio-Admin and Sec-Fetch-Site", () => {
  it("rejects a missing or wrong X-Hapio-Admin header", async () => {
    await expectRejected(
      await call("GET", { headers: { ...TRUSTED, "x-hapio-admin": undefined } }),
      403,
      "Missing X-Hapio-Admin header."
    )
    await expectRejected(
      await call("POST", { headers: { ...TRUSTED, "x-hapio-admin": "true" }, body: "{}" }),
      403,
      "Missing X-Hapio-Admin header."
    )
  })

  it.each(["cross-site", "same-site"])("rejects Sec-Fetch-Site: %s", async (site) => {
    await expectRejected(
      await call("DELETE", { headers: { ...TRUSTED, "sec-fetch-site": site } }),
      403,
      "Cross-site requests are not allowed."
    )
  })

  it.each(["same-origin", "none", undefined])("allows Sec-Fetch-Site: %s", async (site) => {
    expect((await call("GET", { headers: { ...TRUSTED, "sec-fetch-site": site } })).status).toBe(200)
  })

  it("checks the host before the header", async () => {
    await expectRejected(
      await call("GET", { headers: { host: "evil.com", "sec-fetch-site": "cross-site" } }),
      403,
      "Host not allowed. Add it to ADMIN_ALLOWED_HOSTS."
    )
  })
})

describe("configuration", () => {
  it("answers 500 HAPIO_NOT_CONFIGURED without a token", async () => {
    vi.stubEnv("HAPIO_API_TOKEN", "")
    const response = await call("GET")
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      message: "HAPIO_API_TOKEN is not set. Add it to .env.local and restart the server.",
      code: "HAPIO_NOT_CONFIGURED",
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("runs the guards before the token check (no configuration leak to other sites)", async () => {
    vi.stubEnv("HAPIO_API_TOKEN", undefined)
    await expectRejected(
      await call("GET", { headers: { ...TRUSTED, "x-hapio-admin": undefined } }),
      403,
      "Missing X-Hapio-Admin header."
    )
  })

  it("defaults the base URL to Hapio's EU endpoint", async () => {
    vi.stubEnv("HAPIO_BASE_URL", "")
    await call("GET", { path: ["project"] })
    expect(upstream().url).toBe("https://eu-central-1.hapio.net/v1/project")
  })

  it("trims trailing slashes from the base URL", async () => {
    vi.stubEnv("HAPIO_BASE_URL", "http://mock.test/v1///")
    await call("GET", { path: ["project"] })
    expect(upstream().url).toBe("http://mock.test/v1/project")
  })
})

describe("path validation", () => {
  it.each([
    ["no path", undefined],
    ["an empty path", []],
    ["a dot segment", ["..", "project"]],
    ["a segment with a dot", ["locations", "a.b"]],
    ["an encoded slash", ["locations%2Fx"]],
    ["a query character", ["locations?x=1"]],
    ["an empty segment", ["locations", ""]],
    ["an underscore", ["fully_booked"]],
  ])("rejects %s", async (_label, path) => {
    await expectRejected(await call("GET", { path }), 400, "Invalid API path.")
  })

  it("accepts letters, digits and dashes in every segment", async () => {
    const path = ["resources", "9b2f6c1e-1d2a-4c55-9a0b-7f3e2d1c0b9a", "recurring-schedules"]
    expect((await call("GET", { path })).status).toBe(200)
    expect(upstream().url).toBe(`http://mock.test/v1/${path.join("/")}`)
  })
})

describe("forwarding", () => {
  it("forwards the path and query string unchanged", async () => {
    await call("GET", {
      path: ["bookings"],
      url: "http://localhost:3000/api/hapio/bookings?from=2026-10-21T00%3A00%3A00%2B02%3A00&metadata%5Bfloor%5D%5Beq%5D=2",
    })
    expect(upstream().url).toBe(
      "http://mock.test/v1/bookings?from=2026-10-21T00%3A00%3A00%2B02%3A00&metadata%5Bfloor%5D%5Beq%5D=2"
    )
  })

  it("sends the bearer token and Accept header, and doesn't cache", async () => {
    await call("GET")
    const { init, headers } = upstream()
    expect(init.method).toBe("GET")
    expect(init.cache).toBe("no-store")
    expect(headers).toEqual({ Authorization: "Bearer test-token", Accept: "application/json" })
  })

  it("doesn't forward browser headers (cookies, X-Hapio-Admin) upstream", async () => {
    await call("GET", { headers: { ...TRUSTED, cookie: "session=1", authorization: "Bearer stolen" } })
    expect(Object.keys(upstream().headers).sort()).toEqual(["Accept", "Authorization"])
    expect(upstream().headers.Authorization).toBe("Bearer test-token")
  })

  it.each(["POST", "PUT", "PATCH"] as const)("forwards the body of %s with a JSON Content-Type", async (method) => {
    const body = JSON.stringify({ name: "Studio", metadata: { floor: 2 } })
    await call(method, { body, headers: { ...TRUSTED, "content-type": "text/plain" } })
    const { init, headers } = upstream()
    expect(init.method).toBe(method)
    expect(init.body).toBe(body)
    expect(headers["Content-Type"]).toBe("application/json")
  })

  it.each(["POST", "PUT", "PATCH"] as const)("sends no body and no Content-Type for an empty %s", async (method) => {
    await call(method, { path: ["resources", "r1", "services", "s1"] })
    const { init, headers } = upstream()
    expect(init.method).toBe(method)
    expect(init.body).toBeUndefined()
    expect(headers["Content-Type"]).toBeUndefined()
  })

  it("never reads or forwards a body for DELETE", async () => {
    await call("DELETE", { path: ["locations", "l1"], body: '{"ignored":true}' })
    const { init, headers } = upstream()
    expect(init.method).toBe("DELETE")
    expect(init.body).toBeUndefined()
    expect(headers["Content-Type"]).toBeUndefined()
  })

  it("never forwards a body for GET", async () => {
    await call("GET")
    expect(upstream().init.body).toBeUndefined()
  })

  it("answers 502 when the Hapio API can't be reached", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"))
    const response = await call("GET")
    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ message: "Could not reach the Hapio API." })
  })
})

describe("response", () => {
  it("passes status and body through", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ message: "Invalid.", errors: { name: ["Required."] } }, { status: 422 })
    )
    const response = await call("POST", { body: "{}" })
    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({ message: "Invalid.", errors: { name: ["Required."] } })
  })

  it.each([200, 201, 401, 403, 404, 429, 500, 503])("passes status %i through", async (status) => {
    fetchMock.mockResolvedValueOnce(Response.json({ message: "m" }, { status }))
    expect((await call("GET")).status).toBe(status)
  })

  it("returns 204 with a null body", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    const response = await call("DELETE", { path: ["locations", "l1"] })
    expect(response.status).toBe(204)
    expect(response.body).toBeNull()
  })

  it("passes binary-safe bodies through byte for byte", async () => {
    const text = '{"name":"Café ☕","emoji":"🚀"}'
    fetchMock.mockResolvedValueOnce(new Response(text, { status: 200, headers: { "content-type": "application/json" } }))
    expect(await (await call("GET")).text()).toBe(text)
  })

  it("passes only whitelisted headers and adds cache-control: no-store", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("{}", {
        status: 429,
        headers: {
          "content-type": "application/json",
          "x-ratelimit-limit": "200",
          "x-ratelimit-remaining": "0",
          "retry-after": "30",
          "set-cookie": "upstream=1",
          "x-powered-by": "PHP",
          "cache-control": "public, max-age=600",
          server: "nginx",
        },
      })
    )
    const response = await call("GET")
    expect(Object.fromEntries(response.headers)).toEqual({
      "content-type": "application/json",
      "x-ratelimit-limit": "200",
      "x-ratelimit-remaining": "0",
      "retry-after": "30",
      "cache-control": "no-store",
    })
  })

  it("omits whitelisted headers the upstream didn't send", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 200, headers: { "content-type": "application/json" } }))
    const response = await call("GET")
    expect(response.headers.get("retry-after")).toBeNull()
    expect(response.headers.get("x-ratelimit-limit")).toBeNull()
    expect(response.headers.get("cache-control")).toBe("no-store")
  })

  it("leaves cache-control off its own guard responses (current behaviour)", async () => {
    const response = await call("GET", { headers: { ...TRUSTED, host: "evil.com" } })
    expect(response.headers.get("cache-control")).toBeNull()
  })
})

describe("exports", () => {
  it("uses one handler for every method", () => {
    expect(new Set([GET, POST, PUT, PATCH, DELETE]).size).toBe(1)
  })
})
