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

/** How many requests views fire at once when they load several pages or resources. */
export const CONCURRENCY = 4

/** Runs `run` over `items`, `size` at a time, and returns the results in order. */
export async function inBatches<T, R>(items: T[], size: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = []
  for (let i = 0; i < items.length; i += size) {
    results.push(...(await Promise.all(items.slice(i, i + size).map(run))))
  }
  return results
}

export interface FetchedPages<T> {
  items: T[]
  /** How many items the API reports in total: more than `items.length` when `truncated`. */
  total: number
  /** Pages after `maxPages` were not loaded. */
  truncated: boolean
}

/**
 * Like fetchAll, but loads the pages after the first a few at a time and reports when it
 * stopped at `maxPages`, so a view can say that items are missing instead of hiding them.
 */
export async function fetchPages<T>(
  load: (page: number, signal?: AbortSignal) => Promise<Paginated<T>>,
  options: { signal?: AbortSignal; maxPages?: number } = {}
): Promise<FetchedPages<T>> {
  const { signal, maxPages = MAX_PAGES } = options
  const first = await load(1, signal)
  const last = Math.min(first.meta.last_page, maxPages)
  const rest = Array.from({ length: Math.max(last - 1, 0) }, (_, i) => i + 2)
  const pages = await inBatches(rest, CONCURRENCY, (page) => load(page, signal))
  const items = [first, ...pages].flatMap((page) => page.data)
  return {
    items,
    total: Math.max(first.meta.total, items.length),
    truncated: first.meta.last_page > last,
  }
}
