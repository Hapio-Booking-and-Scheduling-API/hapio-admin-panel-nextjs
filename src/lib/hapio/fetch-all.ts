import type { Paginated } from "./types"

// "All" lists for pickers. The API has no "contains" filter, so pickers load
// every item (including disabled ones) and filter client-side.

export const MAX_PAGES = 20

export async function fetchAll<T>(
  load: (page: number, signal?: AbortSignal) => Promise<Paginated<T>>,
  signal?: AbortSignal
): Promise<T[]> {
  const first = await load(1, signal)
  const items = [...first.data]
  const last = Math.min(first.meta.last_page, MAX_PAGES)
  for (let page = 2; page <= last; page++) {
    const next = await load(page, signal)
    items.push(...next.data)
  }
  return items
}
