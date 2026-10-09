// Tiny external store for the latest X-RateLimit-* headers seen by the client.

export interface RateLimitState {
  limit: number | null
  remaining: number | null
  updatedAt: number | null
}

let state: RateLimitState = { limit: null, remaining: null, updatedAt: null }
const listeners = new Set<() => void>()

export function recordRateLimit(headers: Headers) {
  const limit = headers.get("x-ratelimit-limit")
  const remaining = headers.get("x-ratelimit-remaining")
  if (limit === null && remaining === null) return
  state = {
    limit: limit === null ? state.limit : Number(limit),
    remaining: remaining === null ? state.remaining : Number(remaining),
    updatedAt: Date.now(),
  }
  listeners.forEach((listener) => listener())
}

export function subscribeRateLimit(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getRateLimit() {
  return state
}

const serverState: RateLimitState = { limit: null, remaining: null, updatedAt: null }
export function getServerRateLimit() {
  return serverState
}
