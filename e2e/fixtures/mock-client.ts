/** Controls the mock Hapio server (reset, clock, seed). */
export class MockClient {
  constructor(readonly url: string) {}

  /** Re-seeds the mock. `now` freezes its clock; `empty` starts with no data. */
  async reset(options: { now?: string; empty?: boolean; seed?: number } = {}) {
    const params = new URLSearchParams()
    if (options.now) params.set("now", options.now)
    if (options.empty) params.set("empty", "1")
    if (options.seed !== undefined) params.set("seed", String(options.seed))
    const res = await fetch(`${this.url}/__reset?${params}`, { method: "POST" })
    if (!res.ok) throw new Error(`mock reset failed: ${res.status} ${await res.text()}`)
    return (await res.json()) as { now: string | null; seed: number | null }
  }
}
