import { E2E_EXTRA_HOST, E2E_TOKEN } from "../fixtures/constants"
import { SEED } from "../fixtures/seed"
import { expect, test } from "../fixtures/test"
import { ADMIN_HEADERS, rawRequest } from "./_helpers"

// The proxy at /api/hapio/* is the panel's only way to Hapio. It has no login, so it
// guards itself against other websites (Host allow-list, custom header, Sec-Fetch-Site)
// and forwards everything else verbatim with the secret token added server-side.

const HOST_REJECTED = { message: "Host not allowed. Add it to ADMIN_ALLOWED_HOSTS." }
const HEADER_REJECTED = { message: "Missing X-Hapio-Admin header." }
const CROSS_SITE_REJECTED = { message: "Cross-site requests are not allowed." }
const INVALID_PATH = { message: "Invalid API path." }

test.describe("proxy: Host allow-list", () => {
  test("the app's own 127.0.0.1:<port> host passes", async ({ request }) => {
    const res = await request.get("/api/hapio/project", { headers: ADMIN_HEADERS })
    expect(res.status()).toBe(200)
    expect((await res.json()).name).toBe(SEED.project)
  })

  for (const host of ["localhost", "localhost:3456", "LOCALHOST", "127.0.0.1", "[::1]:8080", E2E_EXTRA_HOST, `${E2E_EXTRA_HOST.toUpperCase()}:443`]) {
    test(`Host: ${host} passes`, async ({ stack }) => {
      const res = await rawRequest(stack.appUrl, { path: "/api/hapio/project", headers: { ...ADMIN_HEADERS, Host: host } })
      expect(res.status).toBe(200)
      expect(res.json().name).toBe(SEED.project)
    })
  }

  for (const host of ["evil.example", "evil.example:80", "127.0.0.1.evil.example", "localhost.evil.example", "admin.e2e.test.evil.example", "[::2]"]) {
    test(`Host: ${host} is rejected with 403`, async ({ stack }) => {
      const res = await rawRequest(stack.appUrl, { path: "/api/hapio/project", headers: { ...ADMIN_HEADERS, Host: host } })
      expect(res.status).toBe(403)
      expect(res.json()).toEqual(HOST_REJECTED)
    })
  }

  test("a rejected host is checked before the header, and nothing reaches Hapio", async ({ stack, api }) => {
    const res = await rawRequest(stack.appUrl, {
      method: "POST",
      path: "/api/hapio/resources",
      headers: { Host: "evil.example" },
      body: JSON.stringify({ name: "Rebinding attack" }),
    })
    expect(res.status).toBe(403)
    expect(res.json()).toEqual(HOST_REJECTED)
    expect((await api.list<{ name: string }>("resources")).map((r) => r.name)).not.toContain("Rebinding attack")
  })
})

test.describe("proxy: X-Hapio-Admin header", () => {
  test("a missing header is rejected with 403", async ({ request }) => {
    const res = await request.get("/api/hapio/project", { headers: { Accept: "application/json" } })
    expect(res.status()).toBe(403)
    expect(await res.json()).toEqual(HEADER_REJECTED)
  })

  for (const value of ["0", "true", "yes", "11", ""]) {
    test(`X-Hapio-Admin: ${JSON.stringify(value)} is rejected with 403`, async ({ stack }) => {
      const res = await rawRequest(stack.appUrl, { path: "/api/hapio/project", headers: { "X-Hapio-Admin": value } })
      expect(res.status).toBe(403)
      expect(res.json()).toEqual(HEADER_REJECTED)
    })
  }

  test("mutations without the header never reach Hapio", async ({ request, api }) => {
    const res = await request.post("/api/hapio/resources", { data: { name: "No header" } })
    expect(res.status()).toBe(403)
    expect((await api.list<{ name: string }>("resources")).map((r) => r.name)).not.toContain("No header")
  })
})

test.describe("proxy: Sec-Fetch-Site", () => {
  for (const site of ["cross-site", "same-site"]) {
    test(`Sec-Fetch-Site: ${site} is rejected with 403`, async ({ request }) => {
      const res = await request.get("/api/hapio/project", { headers: { ...ADMIN_HEADERS, "Sec-Fetch-Site": site } })
      expect(res.status()).toBe(403)
      expect(await res.json()).toEqual(CROSS_SITE_REJECTED)
    })
  }

  for (const site of ["same-origin", "none"]) {
    test(`Sec-Fetch-Site: ${site} passes`, async ({ request }) => {
      const res = await request.get("/api/hapio/project", { headers: { ...ADMIN_HEADERS, "Sec-Fetch-Site": site } })
      expect(res.status()).toBe(200)
      expect((await res.json()).name).toBe(SEED.project)
    })
  }

  test("a CORS preflight from another origin is never approved", async ({ stack }) => {
    const res = await rawRequest(stack.appUrl, {
      method: "OPTIONS",
      path: "/api/hapio/project",
      headers: {
        Origin: "https://evil.example",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "x-hapio-admin",
      },
    })
    expect(res.headers["access-control-allow-origin"]).toBeUndefined()
    expect(res.headers["access-control-allow-headers"]).toBeUndefined()
  })

  test("a page on another origin can't call the proxy", async ({ page, stack, consoleGuard }) => {
    consoleGuard.allow(/CORS|Access-Control|Failed to fetch/i)
    // localhost passes the Host allow-list but is a different origin from 127.0.0.1.
    const otherOrigin = stack.appUrl.replace("127.0.0.1", "localhost")
    await page.goto(`${otherOrigin}/project`)
    await expect(page.getByRole("main").getByText(SEED.project).first()).toBeVisible()
    const outcome = await page.evaluate(async (target) => {
      try {
        const res = await fetch(target, { headers: { "X-Hapio-Admin": "1" } })
        return `status ${res.status}`
      } catch (error) {
        return `blocked: ${(error as Error).name}`
      }
    }, `${stack.appUrl}/api/hapio/project`)
    expect(outcome).toBe("blocked: TypeError")
  })
})

test.describe("proxy: path validation", () => {
  for (const path of [
    "/api/hapio/abc_def",
    "/api/hapio/locations/abc.def",
    "/api/hapio/%2e%2e%2fproject",
    "/api/hapio/locations%2F..%2Fproject",
    "/api/hapio/locations/%2E%2E%2F%2E%2E%2Fadmin",
    "/api/hapio/a%20b",
    "/api/hapio/project%3Fx%3D1",
  ]) {
    test(`${path} → 400 Invalid API path`, async ({ stack }) => {
      const res = await rawRequest(stack.appUrl, { path, headers: ADMIN_HEADERS })
      expect(res.status).toBe(400)
      expect(res.json()).toEqual(INVALID_PATH)
    })
  }

  test("valid nested paths are forwarded", async ({ request, api }) => {
    const anna = await api.idOf("resources", SEED.resources.anna.name)
    const res = await request.get(`/api/hapio/resources/${anna}/services`, { headers: ADMIN_HEADERS })
    expect(res.status()).toBe(200)
    const serviceIds = ((await res.json()) as { service_id: string }[]).map((rs) => rs.service_id).sort()
    const expected = await Promise.all([SEED.services.haircut.name, SEED.services.studio.name].map((n) => api.idOf("services", n)))
    expect(serviceIds).toEqual(expected.sort())
  })

  test("unknown upstream paths pass Hapio's 404 through", async ({ request }) => {
    const res = await request.get("/api/hapio/no-such-collection", { headers: ADMIN_HEADERS })
    expect(res.status()).toBe(404)
    expect(await res.json()).toEqual({ message: "Not found." })
  })
})

test.describe("proxy: forwarding", () => {
  test("query parameters pass through (per_page)", async ({ request }) => {
    const res = await request.get("/api/hapio/locations?per_page=1", { headers: ADMIN_HEADERS })
    expect(res.status()).toBe(200)
    const body = (await res.json()) as { data: unknown[]; meta: { per_page: number; total: number; last_page: number } }
    expect(body.meta.per_page).toBe(1)
    expect(body.data).toHaveLength(1)
    expect(body.meta.total).toBe(2)
    expect(body.meta.last_page).toBe(2)
  })

  test("operator filters pass through verbatim, including a %2B offset", async ({ stack }) => {
    const query = "starts_at%5Bgte%5D=2026-10-27T00:00:00%2B01:00&temporary=include&canceled=include&sort=starts_at.asc"
    const res = await rawRequest(stack.appUrl, { path: `/api/hapio/bookings?${query}`, headers: ADMIN_HEADERS })
    expect(res.status).toBe(200)
    const body = res.json<{ data: { starts_at: string }[]; meta: { total: number }; links: { first: string } }>()
    const expected = SEED.bookings.filter((b) => b.startsAt >= "2026-10-27").map((b) => b.startsAt)
    expect(body.data.map((b) => b.starts_at)).toEqual(expected)
    expect(body.meta.total).toBe(5)
    // The mock echoes the raw query in its pagination links: the "+" arrived still encoded
    // (Next normalises ":" to %3A, which is equivalent), never as a literal "+" or a space.
    expect(body.links.first).toMatch(/starts_at%5Bgte%5D=2026-10-27T00(:|%3A)00(:|%3A)00%2B01(:|%3A)00&/)
  })

  test("metadata filters with -> and brackets pass through", async ({ request }) => {
    const res = await request.get(
      `/api/hapio/bookings?${new URLSearchParams({ "metadata[customer->name][seq]": "Erik Lund" })}`,
      { headers: ADMIN_HEADERS }
    )
    expect(res.status()).toBe(200)
    const body = (await res.json()) as { data: { metadata: { customer: { name: string } } }[] }
    expect(body.data.map((b) => b.metadata.customer.name)).toEqual(["Erik Lund"])
  })

  test("POST creates and returns Hapio's response", async ({ request, api }) => {
    const res = await request.post("/api/hapio/resources", {
      headers: ADMIN_HEADERS,
      data: { name: "Via proxy", max_simultaneous_bookings: 3, metadata: { a: 1 } },
    })
    expect(res.status()).toBe(201)
    const created = (await res.json()) as { id: string; name: string; max_simultaneous_bookings: number }
    expect(created).toMatchObject({ name: "Via proxy", max_simultaneous_bookings: 3 })
    expect(await api.get(`resources/${created.id}`)).toMatchObject({ name: "Via proxy", metadata: { a: 1 } })
  })

  test("PATCH updates", async ({ request, api }) => {
    const ben = await api.idOf("resources", SEED.resources.ben.name)
    const res = await request.patch(`/api/hapio/resources/${ben}`, { headers: ADMIN_HEADERS, data: { name: "Benjamin" } })
    expect(res.status()).toBe(200)
    expect((await res.json()).name).toBe("Benjamin")
    expect((await api.get(`resources/${ben}`)).name).toBe("Benjamin")
  })

  test("PUT replaces", async ({ request, api }) => {
    const ben = await api.idOf("resources", SEED.resources.ben.name)
    const res = await request.put(`/api/hapio/resources/${ben}`, {
      headers: ADMIN_HEADERS,
      data: { name: "Ben (replaced)", max_simultaneous_bookings: 4 },
    })
    expect(res.status()).toBe(200)
    expect(await api.get(`resources/${ben}`)).toMatchObject({ name: "Ben (replaced)", max_simultaneous_bookings: 4, metadata: null })
  })

  test("DELETE passes a 204 through with an empty body", async ({ request, api }) => {
    const created = await api.post<{ id: string }>("resources", { name: "Short-lived" })
    const res = await request.delete(`/api/hapio/resources/${created.id}`, { headers: ADMIN_HEADERS })
    expect(res.status()).toBe(204)
    expect(await res.body()).toHaveLength(0)
    await expect(api.get(`resources/${created.id}`)).rejects.toMatchObject({ status: 404 })
  })

  test("a 422 body passes through unchanged", async ({ request, stack }) => {
    const viaProxy = await request.post("/api/hapio/resources", { headers: ADMIN_HEADERS, data: { max_simultaneous_bookings: -1 } })
    const direct = await fetch(`${stack.mockUrl}/v1/resources`, {
      method: "POST",
      headers: { Authorization: `Bearer ${E2E_TOKEN}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ max_simultaneous_bookings: -1 }),
    })
    expect(viaProxy.status()).toBe(422)
    const body = await viaProxy.json()
    expect(body).toEqual(await direct.json())
    expect(body.errors).toHaveProperty("name")
  })

  test("the raw request body is forwarded, even when it isn't valid JSON", async ({ stack }) => {
    const res = await rawRequest(stack.appUrl, {
      method: "POST",
      path: "/api/hapio/resources",
      headers: ADMIN_HEADERS,
      body: "{not json",
    })
    expect(res.status).toBe(400)
    expect(res.json()).toEqual({ message: "The request body is not valid JSON." })
  })

  test("404s pass through", async ({ request }) => {
    const res = await request.get("/api/hapio/locations/00000000-0000-4000-8000-000000000000", { headers: ADMIN_HEADERS })
    expect(res.status()).toBe(404)
    expect(await res.json()).toEqual({ message: "Not found." })
  })
})

test.describe("proxy: response headers", () => {
  test("rate-limit headers and content type pass through; caching is disabled", async ({ request }) => {
    const res = await request.get("/api/hapio/project", { headers: ADMIN_HEADERS })
    const headers = res.headers()
    expect(headers["x-ratelimit-limit"]).toBe("1000000")
    expect(Number(headers["x-ratelimit-remaining"])).toBeGreaterThan(999_000)
    expect(Number(headers["x-ratelimit-remaining"])).toBeLessThan(1_000_000)
    expect(headers["content-type"]).toContain("application/json")
    expect(headers["cache-control"]).toBe("no-store")
  })

  test("error responses carry rate-limit headers and no-store too", async ({ request }) => {
    const res = await request.get("/api/hapio/locations/00000000-0000-4000-8000-000000000000", { headers: ADMIN_HEADERS })
    expect(res.status()).toBe(404)
    expect(res.headers()["x-ratelimit-limit"]).toBe("1000000")
    expect(res.headers()["cache-control"]).toBe("no-store")
  })

  test("the API token never leaks into responses", async ({ request }) => {
    for (const path of ["project", "locations", "bookings?per_page=5", "no-such-collection"]) {
      const res = await request.get(`/api/hapio/${path}`, { headers: ADMIN_HEADERS })
      const headers = res.headers()
      expect(headers.authorization).toBeUndefined()
      expect(Object.values(headers).join("\n")).not.toContain(E2E_TOKEN)
      expect(await res.text()).not.toContain(E2E_TOKEN)
    }
  })
})
