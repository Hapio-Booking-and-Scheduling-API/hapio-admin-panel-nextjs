import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/hapio/rate-limit", () => ({ recordRateLimit: vi.fn() }))

import { hapio, hapioFetch, PROXY_BASE } from "@/lib/hapio/client"
import { HapioApiError } from "@/lib/hapio/errors"
import { recordRateLimit } from "@/lib/hapio/rate-limit"

type FetchMock = (input: string, init?: RequestInit) => Promise<Response>

function respond(
  status: number,
  body?: unknown,
  init: { headers?: Record<string, string>; statusText?: string } = {}
): Response {
  const text = body === undefined ? null : typeof body === "string" ? body : JSON.stringify(body)
  return new Response(status === 204 ? null : text, { status, ...init })
}

let fetchMock: ReturnType<typeof vi.fn<FetchMock>>

beforeEach(() => {
  fetchMock = vi.fn<FetchMock>(async () => respond(200, { ok: true }))
  vi.stubGlobal("fetch", fetchMock)
  vi.mocked(recordRateLimit).mockClear()
})

function lastCall() {
  const call = fetchMock.mock.calls.at(-1)
  if (!call) throw new Error("fetch was not called")
  const [url, init = {}] = call
  return { url, init, headers: init.headers as Record<string, string> }
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error("expected the promise to reject")
}

describe("hapioFetch: request", () => {
  it("prefixes the proxy base and strips leading slashes from the path", async () => {
    expect(PROXY_BASE).toBe("/api/hapio")
    await hapioFetch("GET", "///locations/abc")
    expect(lastCall().url).toBe("/api/hapio/locations/abc")
    await hapioFetch("GET", "project")
    expect(lastCall().url).toBe("/api/hapio/project")
  })

  it("appends the query string built by buildQuery", async () => {
    await hapioFetch("GET", "bookings", {
      query: { page: 2, from: "2026-10-21T00:00:00+02:00", starts_at: { gte: "x" }, canceled: "" },
    })
    expect(lastCall().url).toBe(
      "/api/hapio/bookings?page=2&from=2026-10-21T00%3A00%3A00%2B02%3A00&starts_at%5Bgte%5D=x"
    )
  })

  it("adds no '?' when the query is missing or empty", async () => {
    await hapioFetch("GET", "bookings", { query: {} })
    expect(lastCall().url).toBe("/api/hapio/bookings")
    await hapioFetch("GET", "bookings", { query: { a: undefined, b: null } })
    expect(lastCall().url).toBe("/api/hapio/bookings")
  })

  it("always sends Accept and X-Hapio-Admin, no Content-Type and no body without a body", async () => {
    const controller = new AbortController()
    await hapioFetch("GET", "locations", { signal: controller.signal })
    const { init, headers } = lastCall()
    expect(init.method).toBe("GET")
    expect(headers).toEqual({ Accept: "application/json", "X-Hapio-Admin": "1" })
    expect(init.body).toBeUndefined()
    expect(init.cache).toBe("no-store")
    expect(init.signal).toBe(controller.signal)
  })

  it("sends a JSON body with Content-Type when a body is given", async () => {
    await hapioFetch("POST", "locations", { body: { name: "Studio", n: 0 } })
    const { init, headers } = lastCall()
    expect(init.method).toBe("POST")
    expect(headers).toEqual({
      Accept: "application/json",
      "X-Hapio-Admin": "1",
      "Content-Type": "application/json",
    })
    expect(init.body).toBe('{"name":"Studio","n":0}')
  })

  it("serialises a null body as JSON null (only undefined means 'no body')", async () => {
    await hapioFetch("PATCH", "locations/x", { body: null })
    expect(lastCall().init.body).toBe("null")
    expect(lastCall().headers["Content-Type"]).toBe("application/json")
  })
})

describe("hapioFetch: responses", () => {
  it("returns parsed JSON on success", async () => {
    fetchMock.mockResolvedValueOnce(respond(200, { id: "a", name: "Studio" }))
    await expect(hapioFetch("GET", "locations/a")).resolves.toEqual({ id: "a", name: "Studio" })
  })

  it("returns undefined for 204 No Content", async () => {
    fetchMock.mockResolvedValueOnce(respond(204))
    await expect(hapioFetch("DELETE", "locations/a")).resolves.toBeUndefined()
  })

  it("returns undefined for an empty 200 body", async () => {
    fetchMock.mockResolvedValueOnce(respond(200, ""))
    await expect(hapioFetch("GET", "project")).resolves.toBeUndefined()
  })

  it("wraps a non-JSON success body as { message } (truncated to 300 chars)", async () => {
    fetchMock.mockResolvedValueOnce(respond(200, "y".repeat(400)))
    await expect(hapioFetch("GET", "project")).resolves.toEqual({ message: "y".repeat(300) })
  })

  it("records rate-limit headers on success, on 204 and on errors", async () => {
    const headers = { "x-ratelimit-limit": "200", "x-ratelimit-remaining": "199" }
    fetchMock.mockResolvedValueOnce(respond(200, {}, { headers }))
    await hapioFetch("GET", "project")
    fetchMock.mockResolvedValueOnce(respond(204, undefined, { headers }))
    await hapioFetch("DELETE", "locations/a")
    fetchMock.mockResolvedValueOnce(respond(500, { message: "Boom" }, { headers }))
    await caught(hapioFetch("GET", "project"))

    const calls = vi.mocked(recordRateLimit).mock.calls
    expect(calls).toHaveLength(3)
    for (const [recorded] of calls) {
      expect(recorded).toBeInstanceOf(Headers)
      expect(recorded.get("x-ratelimit-remaining")).toBe("199")
    }
  })
})

describe("hapioFetch: errors", () => {
  it("maps status, message, code, errors, messages and Retry-After", async () => {
    fetchMock.mockResolvedValueOnce(
      respond(
        422,
        {
          message: "The given data was invalid.",
          code: "SOME_CODE",
          errors: { starts_at: ["Required.", "Must be a date."] },
          messages: { "bookings.0": "Not available." },
        },
        { headers: { "retry-after": "7" } }
      )
    )
    const error = await caught(hapioFetch("POST", "bookings", { body: {} }))
    expect(error).toBeInstanceOf(HapioApiError)
    const e = error as HapioApiError
    expect(e.status).toBe(422)
    expect(e.message).toBe("The given data was invalid.")
    expect(e.code).toBe("SOME_CODE")
    expect(e.errors).toEqual({ starts_at: ["Required.", "Must be a date."] })
    expect(e.messages).toEqual({ "bookings.0": "Not available." })
    expect(e.retryAfter).toBe(7)
  })

  it("leaves optional fields undefined when the body lacks them", async () => {
    fetchMock.mockResolvedValueOnce(respond(404, { message: "Not found." }))
    const e = (await caught(hapioFetch("GET", "locations/x"))) as HapioApiError
    expect(e.status).toBe(404)
    expect(e.message).toBe("Not found.")
    expect(e.code).toBeUndefined()
    expect(e.errors).toBeUndefined()
    expect(e.messages).toBeUndefined()
    expect(e.retryAfter).toBeUndefined()
  })

  it("falls back to the status text when the body has no message or is empty", async () => {
    fetchMock.mockResolvedValueOnce(respond(404, {}, { statusText: "Not Found" }))
    expect(((await caught(hapioFetch("GET", "x"))) as HapioApiError).message).toBe("Not Found")

    fetchMock.mockResolvedValueOnce(respond(503, "", { statusText: "Service Unavailable" }))
    const e = (await caught(hapioFetch("GET", "x"))) as HapioApiError
    expect(e.status).toBe(503)
    expect(e.message).toBe("Service Unavailable")
  })

  it("uses a non-JSON error body as the message, truncated to 300 characters", async () => {
    const html = `<html>${"x".repeat(1000)}</html>`
    fetchMock.mockResolvedValueOnce(respond(502, html, { statusText: "Bad Gateway" }))
    const e = (await caught(hapioFetch("GET", "x"))) as HapioApiError
    expect(e.status).toBe(502)
    expect(e.message).toBe(html.slice(0, 300))
    expect(e.message).toHaveLength(300)
  })

  it("falls back to the status text for JSON error bodies that aren't objects", async () => {
    fetchMock.mockResolvedValueOnce(respond(500, "null", { statusText: "Internal Server Error" }))
    expect(((await caught(hapioFetch("GET", "x"))) as HapioApiError).message).toBe("Internal Server Error")
    fetchMock.mockResolvedValueOnce(respond(500, '"Server Error"', { statusText: "Internal Server Error" }))
    expect(((await caught(hapioFetch("GET", "x"))) as HapioApiError).message).toBe("Internal Server Error")
  })

  it("keeps a Retry-After of 0", async () => {
    fetchMock.mockResolvedValueOnce(respond(429, {}, { headers: { "retry-after": "0" } }))
    expect(((await caught(hapioFetch("GET", "x"))) as HapioApiError).retryAfter).toBe(0)
  })

  it("passes Retry-After through Number() (an HTTP-date becomes NaN)", async () => {
    fetchMock.mockResolvedValueOnce(
      respond(429, { message: "Too Many Attempts." }, { headers: { "retry-after": "Wed, 21 Oct 2026 07:28:00 GMT" } })
    )
    const e = (await caught(hapioFetch("GET", "x"))) as HapioApiError
    expect(e.status).toBe(429)
    expect(e.retryAfter).toBeNaN()
  })

  it("turns a network failure into a status 0 HapioApiError without recording rate limits", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"))
    const e = (await caught(hapioFetch("GET", "x"))) as HapioApiError
    expect(e).toBeInstanceOf(HapioApiError)
    expect(e.status).toBe(0)
    expect(e.message).toBe("Network error: could not reach the admin server.")
    expect(recordRateLimit).not.toHaveBeenCalled()
  })

  it("rethrows an AbortError unchanged", async () => {
    const abort = new DOMException("The operation was aborted.", "AbortError")
    fetchMock.mockRejectedValueOnce(abort)
    const error = await caught(hapioFetch("GET", "x"))
    expect(error).toBe(abort)
    expect(error).not.toBeInstanceOf(HapioApiError)
  })

  it("maps other DOMExceptions (not AbortError) to a network error", async () => {
    fetchMock.mockRejectedValueOnce(new DOMException("nope", "NetworkError"))
    const e = (await caught(hapioFetch("GET", "x"))) as HapioApiError
    expect(e).toBeInstanceOf(HapioApiError)
    expect(e.status).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Every API operation: method, path, query and body.

interface Op {
  /** Path in the `hapio` object; factories are written `name()`. */
  name: string
  call: (signal: AbortSignal) => Promise<unknown>
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
  /** Expected URL, decoded for readability. */
  url: string
  body?: unknown
  /** The operation forwards an AbortSignal. */
  signal?: boolean
}

const FROM = "2026-10-21T00:00:00+02:00"
const TO = "2026-10-28T00:00:00+01:00"
const BODY = { name: "Body", metadata: { a: 1 } }
// Bodies are opaque to the client; the cast keeps the table free of entity typing.
const body = BODY as never

function crudOps(
  name: string,
  base: string,
  api: {
    list: (params?: never, signal?: AbortSignal) => Promise<unknown>
    get: (id: string, signal?: AbortSignal) => Promise<unknown>
    create: (body: never) => Promise<unknown>
    replace: (id: string, body: never) => Promise<unknown>
    patch: (id: string, body: never) => Promise<unknown>
    delete: (id: string) => Promise<unknown>
  },
  listParams: Record<string, unknown>,
  listQuery: string
): Op[] {
  return [
    {
      name: `${name}.list`,
      call: (s) => api.list(listParams as never, s),
      method: "GET",
      url: `/api/hapio/${base}${listQuery}`,
      signal: true,
    },
    { name: `${name}.get`, call: (s) => api.get("ID1", s), method: "GET", url: `/api/hapio/${base}/ID1`, signal: true },
    { name: `${name}.create`, call: () => api.create(body), method: "POST", url: `/api/hapio/${base}`, body: BODY },
    { name: `${name}.replace`, call: () => api.replace("ID1", body), method: "PUT", url: `/api/hapio/${base}/ID1`, body: BODY },
    { name: `${name}.patch`, call: () => api.patch("ID1", body), method: "PATCH", url: `/api/hapio/${base}/ID1`, body: BODY },
    { name: `${name}.delete`, call: () => api.delete("ID1"), method: "DELETE", url: `/api/hapio/${base}/ID1` },
  ]
}

const OPS: Op[] = [
  { name: "project.get", call: (s) => hapio.project.get(s), method: "GET", url: "/api/hapio/project", signal: true },

  ...crudOps(
    "locations",
    "locations",
    hapio.locations,
    { page: 2, per_page: 10, name: { eq: "Studio" }, disabled: "include", timezone: "Europe/Stockholm" },
    "?page=2&per_page=10&name[eq]=Studio&disabled=include&timezone=Europe/Stockholm"
  ),

  ...crudOps(
    "resources",
    "resources",
    hapio.resources,
    { max_simultaneous_bookings: { gte: 2 }, metadata: [{ property: "role", operator: "seq", value: "room" }] },
    "?max_simultaneous_bookings[gte]=2&metadata[role][seq]=room"
  ),
  {
    name: "resources.schedule",
    call: (s) => hapio.resources.schedule("R1", { from: FROM, to: TO, location: "L1", fully_booked: "include" }, s),
    method: "GET",
    url: `/api/hapio/resources/R1/schedule?from=${FROM}&to=${TO}&location=L1&fully_booked=include`,
    signal: true,
  },
  {
    name: "resources.fullyBooked",
    call: (s) => hapio.resources.fullyBooked("R1", { from: FROM, to: TO, page: 3 }, s),
    method: "GET",
    url: `/api/hapio/resources/R1/fully-booked?from=${FROM}&to=${TO}&page=3`,
    signal: true,
  },
  {
    name: "resources.services.list",
    call: (s) => hapio.resources.services.list("R1", s),
    method: "GET",
    url: "/api/hapio/resources/R1/services",
    signal: true,
  },
  {
    name: "resources.services.get",
    call: () => hapio.resources.services.get("R1", "S1"),
    method: "GET",
    url: "/api/hapio/resources/R1/services/S1",
  },
  {
    name: "resources.services.associate",
    call: () => hapio.resources.services.associate("R1", "S1"),
    method: "PUT",
    url: "/api/hapio/resources/R1/services/S1",
  },
  {
    name: "resources.services.dissociate",
    call: () => hapio.resources.services.dissociate("R1", "S1"),
    method: "DELETE",
    url: "/api/hapio/resources/R1/services/S1",
  },

  ...crudOps(
    "scheduleBlocks()",
    "resources/R1/schedule-blocks",
    hapio.scheduleBlocks("R1"),
    { from: FROM, to: TO, location: "L1" },
    `?from=${FROM}&to=${TO}&location=L1`
  ),

  ...crudOps(
    "recurringSchedules()",
    "resources/R1/recurring-schedules",
    hapio.recurringSchedules("R1"),
    { from: "2026-10-01", to: "2026-12-31", location: "L1", start_date: { lte: "2026-10-21" } },
    "?from=2026-10-01&to=2026-12-31&location=L1&start_date[lte]=2026-10-21"
  ),

  ...crudOps(
    "recurringScheduleBlocks()",
    "resources/R1/recurring-schedules/RS1/schedule-blocks",
    hapio.recurringScheduleBlocks("R1", "RS1"),
    { weekday: "monday", start_time: { gte: "09:00:00" } },
    "?weekday=monday&start_time[gte]=09:00:00"
  ),

  ...crudOps(
    "services",
    "services",
    hapio.services,
    { type: "fixed", price: { lt: "500.000" }, disabled: "only" },
    "?type=fixed&price[lt]=500.000&disabled=only"
  ),
  {
    name: "services.bookableSlots",
    call: (s) =>
      hapio.services.bookableSlots(
        "S1",
        {
          from: FROM,
          to: TO,
          location: "L1",
          resource: "R1",
          ignore_booking_window: "true",
          duration: "PT1H",
          num_resources: 2,
        },
        s
      ),
    method: "GET",
    url: `/api/hapio/services/S1/bookable-slots?from=${FROM}&to=${TO}&location=L1&resource=R1&ignore_booking_window=true&duration=PT1H&num_resources=2`,
    signal: true,
  },
  {
    name: "services.resources.list",
    call: (s) => hapio.services.resources.list("S1", s),
    method: "GET",
    url: "/api/hapio/services/S1/resources",
    signal: true,
  },
  {
    name: "services.resources.get",
    call: () => hapio.services.resources.get("S1", "R1"),
    method: "GET",
    url: "/api/hapio/services/S1/resources/R1",
  },
  {
    name: "services.resources.associate",
    call: () => hapio.services.resources.associate("S1", "R1"),
    method: "PUT",
    url: "/api/hapio/services/S1/resources/R1",
  },
  {
    name: "services.resources.dissociate",
    call: () => hapio.services.resources.dissociate("S1", "R1"),
    method: "DELETE",
    url: "/api/hapio/services/S1/resources/R1",
  },

  ...crudOps(
    "bookings",
    "bookings",
    hapio.bookings,
    { from: FROM, to: TO, canceled: "exclude", temporary: "include", sort: "starts_at.desc" },
    `?from=${FROM}&to=${TO}&canceled=exclude&temporary=include&sort=starts_at.desc`
  ),

  ...crudOps(
    "bookingGroups",
    "booking-groups",
    hapio.bookingGroups,
    {
      group_metadata: [{ property: "customer->name", operator: "seq", value: "Lindqvist" }],
      group_created_at: { gte: FROM },
    },
    `?group_metadata[customer->name][seq]=Lindqvist&group_created_at[gte]=${FROM}`
  ),
]

describe("hapio operations", () => {
  it("lists 60 uniquely named operations", () => {
    expect(OPS).toHaveLength(60)
    expect(new Set(OPS.map((op) => op.name)).size).toBe(60)
  })

  it.each(OPS.map((op) => [op.name, op] as const))("%s", async (_name, op) => {
    const controller = new AbortController()
    await expect(op.call(controller.signal)).resolves.toEqual({ ok: true })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const { url, init, headers } = lastCall()
    expect(init.method).toBe(op.method)
    expect(decodeURIComponent(url)).toBe(op.url)
    if (op.body === undefined) {
      expect(init.body).toBeUndefined()
      expect(headers["Content-Type"]).toBeUndefined()
    } else {
      expect(JSON.parse(init.body as string)).toEqual(op.body)
      expect(headers["Content-Type"]).toBe("application/json")
    }
    expect(init.signal).toBe(op.signal ? controller.signal : undefined)
  })

  it("covers every callable in the hapio object (including factory functions)", async () => {
    const found: string[] = []
    async function walk(node: Record<string, unknown>, prefix: string) {
      for (const [key, value] of Object.entries(node)) {
        if (typeof value === "function") {
          const result: unknown = (value as (...args: unknown[]) => unknown)("ID-A", "ID-B")
          if (result instanceof Promise) {
            found.push(`${prefix}${key}`)
            await result
          } else {
            await walk(result as Record<string, unknown>, `${prefix}${key}().`)
          }
        } else if (value && typeof value === "object") {
          await walk(value as Record<string, unknown>, `${prefix}${key}.`)
        }
      }
    }
    await walk(hapio as unknown as Record<string, unknown>, "")

    expect([...found].sort()).toEqual(OPS.map((op) => op.name).sort())
    expect(found).toHaveLength(60)
  })

  it("factories build paths from their arguments", async () => {
    await hapio.recurringScheduleBlocks("res-9", "sched-7").get("blk-3")
    expect(lastCall().url).toBe("/api/hapio/resources/res-9/recurring-schedules/sched-7/schedule-blocks/blk-3")
  })
})
