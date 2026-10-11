import { E2E_TOKEN } from "./constants"

type Query = Record<string, string | number | boolean | undefined>
export type Json = Record<string, unknown>

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown
  ) {
    super(`mock API ${status}: ${JSON.stringify(body)}`)
  }
}

/**
 * Talks to the mock Hapio API directly (not through the panel), to arrange data
 * before a test and to check what the panel changed afterwards.
 */
export class HapioApi {
  constructor(readonly mockUrl: string) {}

  async request<T = Json>(method: string, path: string, options: { query?: Query; body?: unknown } = {}): Promise<T> {
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(options.query ?? {})) if (v !== undefined) qs.set(k, String(v))
    const url = `${this.mockUrl}/v1/${path.replace(/^\/+/, "")}${qs.size ? `?${qs}` : ""}`
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${E2E_TOKEN}`,
        Accept: "application/json",
        ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })
    const text = await res.text()
    const data = text ? JSON.parse(text) : undefined
    if (!res.ok) throw new ApiError(res.status, data)
    return data as T
  }

  get<T = Json>(path: string, query?: Query) {
    return this.request<T>("GET", path, { query })
  }
  post<T = Json>(path: string, body: unknown) {
    return this.request<T>("POST", path, { body })
  }
  put<T = Json>(path: string, body?: unknown) {
    return this.request<T>("PUT", path, { body })
  }
  patch<T = Json>(path: string, body: unknown) {
    return this.request<T>("PATCH", path, { body })
  }
  delete(path: string) {
    return this.request<void>("DELETE", path)
  }

  /** Every item of a collection, including disabled, temporary and canceled ones. */
  async list<T = Json>(collection: string, query: Query = {}): Promise<T[]> {
    const inclusive: Query =
      collection === "bookings" || collection === "booking-groups"
        ? { temporary: "include", canceled: "include" }
        : /^(locations|resources|services)$/.test(collection)
          ? { disabled: "include" }
          : {}
    const items: T[] = []
    for (let page = 1; ; page++) {
      const res = await this.get<{ data: T[]; meta: { last_page: number } }>(collection, {
        ...inclusive,
        per_page: 100,
        page,
        ...query,
      })
      items.push(...res.data)
      if (page >= res.meta.last_page) return items
    }
  }

  /** Finds a location, resource or service by its exact name. */
  async byName<T extends { id: string; name: string } = { id: string; name: string } & Json>(
    collection: "locations" | "resources" | "services",
    name: string
  ): Promise<T> {
    const match = (await this.list<T>(collection)).find((item) => item.name === name)
    if (!match) throw new Error(`No ${collection.slice(0, -1)} named ${name}`)
    return match
  }

  async idOf(collection: "locations" | "resources" | "services", name: string) {
    return (await this.byName(collection, name)).id
  }

  /** Finds a booking by its seed customer name (metadata.customer.name). */
  async bookingFor(customer: string) {
    const bookings = await this.list<Json & { id: string; metadata: Json | null }>("bookings")
    const match = bookings.find(
      (b) => ((b.metadata?.customer as Json | undefined)?.name as string | undefined) === customer
    )
    if (!match) throw new Error(`No booking for ${customer}`)
    return match
  }

  async project() {
    return this.get<{ id: string; name: string }>("project")
  }
}
