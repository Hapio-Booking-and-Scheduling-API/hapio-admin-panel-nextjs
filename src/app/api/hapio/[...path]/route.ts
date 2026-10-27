// Server-side proxy to the Hapio API. The browser calls /api/hapio/<path>; this
// handler forwards the request with the secret API token, so the token never
// reaches the client.
//
// Behind your own gateway, the token can be left out: the proxy then forwards
// the cookies named in HAPIO_FORWARD_COOKIES, and the gateway at HAPIO_BASE_URL
// adds the token.

import type { NextRequest } from "next/server"

const DEFAULT_BASE_URL = "https://eu-central-1.hapio.net/v1"
const SEGMENT_RE = /^[A-Za-z0-9-]+$/
const PASS_THROUGH_HEADERS = [
  "content-type",
  "x-ratelimit-limit",
  "x-ratelimit-remaining",
  "retry-after",
]
const DEFAULT_ALLOWED_HOSTS = ["localhost", "127.0.0.1", "[::1]"]

function json(status: number, message: string, code?: string) {
  return Response.json(code ? { message, code } : { message }, { status })
}

function forwardedCookieNames(): string[] {
  return (process.env.HAPIO_FORWARD_COOKIES ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean)
}

/** Cookies are only sent over HTTPS, or to this machine during development. */
function isSafeToForwardCookies(base: string): boolean {
  try {
    const url = new URL(base)
    return url.protocol === "https:" || DEFAULT_ALLOWED_HOSTS.includes(url.hostname)
  } catch {
    return false
  }
}

/** The Cookie header with only the listed cookies, or null when none are set. */
function forwardedCookies(req: NextRequest, names: string[]): string | null {
  const pairs = names.flatMap((name) => {
    const cookie = req.cookies.get(name)
    return cookie ? [`${name}=${cookie.value}`] : []
  })
  return pairs.length ? pairs.join("; ") : null
}

function allowedHosts(): string[] {
  const extra = (process.env.ADMIN_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
  return [...DEFAULT_ALLOWED_HOSTS, ...extra]
}

function hostname(host: string | null): string {
  if (!host) return ""
  const h = host.toLowerCase()
  if (h.startsWith("[")) return h.slice(0, h.indexOf("]") + 1)
  return h.split(":")[0]
}

/**
 * The panel has no login, so guard the proxy against other websites:
 * - Host must be allow-listed (defeats DNS rebinding).
 * - The custom X-Hapio-Admin header must be present (forces a CORS preflight,
 *   which this route never approves, so cross-site requests are blocked).
 * - Sec-Fetch-Site, when sent, must be same-origin.
 */
function rejectUntrusted(req: NextRequest): Response | null {
  if (!allowedHosts().includes(hostname(req.headers.get("host")))) {
    return json(403, "Host not allowed. Add it to ADMIN_ALLOWED_HOSTS.")
  }
  if (req.headers.get("x-hapio-admin") !== "1") {
    return json(403, "Missing X-Hapio-Admin header.")
  }
  const site = req.headers.get("sec-fetch-site")
  if (site && site !== "same-origin" && site !== "none") {
    return json(403, "Cross-site requests are not allowed.")
  }
  return null
}

async function proxy(req: NextRequest, ctx: RouteContext<"/api/hapio/[...path]">) {
  const rejected = rejectUntrusted(req)
  if (rejected) return rejected

  const token = process.env.HAPIO_API_TOKEN
  const cookieNames = forwardedCookieNames()
  if (!token && !cookieNames.length) {
    return json(
      500,
      "HAPIO_API_TOKEN is not set. Add it to .env.local and restart the server.",
      "HAPIO_NOT_CONFIGURED"
    )
  }

  const { path } = await ctx.params
  if (!path?.length || !path.every((segment) => SEGMENT_RE.test(segment))) {
    return json(400, "Invalid API path.")
  }

  const base = (process.env.HAPIO_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "")
  const url = `${base}/${path.join("/")}${req.nextUrl.search}`

  const headers: Record<string, string> = { Accept: "application/json" }
  if (token) headers.Authorization = `Bearer ${token}`
  if (cookieNames.length) {
    if (!isSafeToForwardCookies(base)) {
      return json(500, "HAPIO_FORWARD_COOKIES needs an HTTPS HAPIO_BASE_URL.", "HAPIO_NOT_CONFIGURED")
    }
    const cookie = forwardedCookies(req, cookieNames)
    if (cookie) headers.Cookie = cookie
  }
  let body: string | undefined
  if (req.method !== "GET" && req.method !== "DELETE") {
    const text = await req.text()
    if (text) {
      body = text
      headers["Content-Type"] = "application/json"
    }
  }

  let upstream: Response
  try {
    upstream = await fetch(url, { method: req.method, headers, body, cache: "no-store" })
  } catch {
    return json(502, "Could not reach the Hapio API.")
  }

  const responseHeaders = new Headers({ "cache-control": "no-store" })
  for (const name of PASS_THROUGH_HEADERS) {
    const value = upstream.headers.get(name)
    if (value) responseHeaders.set(name, value)
  }

  const payload = upstream.status === 204 ? null : await upstream.arrayBuffer()
  return new Response(payload, { status: upstream.status, headers: responseHeaders })
}

export const GET = proxy
export const POST = proxy
export const PUT = proxy
export const PATCH = proxy
export const DELETE = proxy
