/**
 * The fixed "now" every test runs at, unless it opts into another one with
 * `test.use({ now: ... })`. Wednesday 21 October 2026, before opening hours.
 * EU daylight saving time ends on Sunday 25 October and US DST on 1 November,
 * so 7- and 30-day ranges cross both transitions.
 */
export const E2E_NOW = "2026-10-21T08:00:00+02:00"
/** Same day after lunch: earlier slots today have passed; the week view shows the now marker. */
export const NOW_MIDDAY = "2026-10-21T12:30:00+02:00"
/** A Saturday: no opening hours today. */
export const NOW_SATURDAY = "2026-10-24T12:00:00+02:00"
/** The night the clocks go back in Europe. */
export const NOW_DST_DAY = "2026-10-25T01:30:00+02:00"

export const TIME_ZONE = "Europe/Stockholm"
export const E2E_TOKEN = "e2e-dummy-token"
/** Extra host allowed by the proxy in test stacks (ADMIN_ALLOWED_HOSTS). */
export const E2E_EXTRA_HOST = "admin.e2e.test"
/** Where the e2e build lives (see scripts/e2e-build.mjs). E2E_DIST_DIR selects another one. */
export const E2E_DIST_DIR = process.env.E2E_DIST_DIR || ".next-e2e"
