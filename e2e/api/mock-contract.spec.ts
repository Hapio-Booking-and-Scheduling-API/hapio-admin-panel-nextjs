import { SEED } from "../fixtures/seed"
import { expect, test } from "../fixtures/test"

// Guards the assumptions the rest of the suite relies on.
test.describe("mock contract", () => {
  test("resets are deterministic and follow the fixed now", async ({ api, mock }) => {
    const dump = async () =>
      JSON.stringify(await Promise.all(["locations", "resources", "services", "bookings", "booking-groups"].map((c) => api.list(c))))
    const first = await dump()
    await mock.reset({ now: "2026-10-21T08:00:00+02:00" })
    expect(await dump()).toBe(first)
    await mock.reset({ now: "2026-11-04T08:00:00+01:00" })
    expect(await dump()).not.toBe(first)
  })

  test("seed facts", async ({ api }) => {
    const bookings = await api.list<{ starts_at: string; metadata: { customer?: { name: string } } }>("bookings")
    const sorted = [...bookings].sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))
    expect(sorted.map((b) => [b.metadata.customer?.name, b.starts_at])).toEqual(
      SEED.bookings.map((b) => [b.customer, b.startsAt])
    )
    expect((await api.project()).name).toBe(SEED.project)
    expect((await api.list("locations")).length).toBe(2)
  })

  test("writes get increasing timestamps", async ({ api }) => {
    const a = await api.post<{ created_at: string }>("resources", { name: "Tick A" })
    const b = await api.post<{ created_at: string }>("resources", { name: "Tick B" })
    expect(Date.parse(b.created_at)).toBeGreaterThan(Date.parse(a.created_at))
  })

  test("groups without bookings are still listed (BUG-18)", async ({ api }) => {
    const [group] = await api.list<{ id: string; bookings: { id: string }[] }>("booking-groups")
    for (const booking of group.bookings) await api.delete(`bookings/${booking.id}`)
    const listed = await api.get<{ data: { id: string }[] }>("booking-groups", { temporary: "include", canceled: "include" })
    expect(listed.data.map((g) => g.id)).toContain(group.id)
  })

  test("unauthenticated requests get 401", async ({ stack }) => {
    const res = await fetch(`${stack.mockUrl}/v1/project`)
    expect(res.status).toBe(401)
  })
})
