# End-to-end tests

Playwright tests run the production build of the panel against the in-memory mock Hapio API
(`scripts/mock-hapio.mjs`). They never touch a real Hapio project.

```bash
npm run test:e2e                         # build .next-e2e, then run everything
npm run test:e2e:only -- e2e/locations   # rerun without rebuilding
E2E_WORKERS=2 npm run test:e2e:only      # fewer parallel stacks
npm run test:e2e:ui                      # Playwright UI mode
```

`npm run e2e:build` builds into `.next-e2e`, so the dev server's `.next` folder is left alone.
The global setup refuses to run against a stale build; set `E2E_ALLOW_STALE=1` to override.

## How it works

- **One stack per worker.** Each Playwright worker starts its own mock and `next start` on
  free ports (`e2e/fixtures/stack.ts`). The app always gets `HAPIO_BASE_URL` pointing at the
  mock and a dummy `HAPIO_API_TOKEN`, so values in `.env` never apply. Before any test runs,
  the stack checks the app is wired to its own mock, and it refuses port 3000.
- **Fixed time.** Before every test the mock is reset to the demo data at `E2E_NOW`
  (Wed 21 Oct 2026 08:00, Stockholm), and the browser clock starts at the same moment.
  - `test.use({ now: NOW_MIDDAY })` picks another moment.
  - `test.use({ seed: "empty" })` starts with no data.
  - `page.clock.fastForward()` moves time on.
- **Deterministic data.** With `MOCK_SEED=1`, ids and random choices repeat across runs.
  Still never hard-code ids: look them up with `api.byName()` or `api.bookingFor()`.
- **Seed facts** used across specs live in `e2e/fixtures/seed.ts`.

## Fixtures (`e2e/fixtures/test.ts`)

| Fixture | What it does |
| --- | --- |
| `api` | REST client straight to the mock. Use it to arrange data before `goto` and to check results: `get`, `post`, `patch`, `put`, `delete`, `list`, `byName`, `idOf`, `bookingFor`. |
| `net` | Records every `/api/hapio/*` call. `waitFor(method, path)` checks request bodies. `fail`, `abort`, `delay` and `transform` inject 401/403/404/429/500, network errors and edited responses. |
| `ui` | Helpers for the panel's patterns: `pick` (searchable combobox), `choose` (select), `row`, `rowAction`, `dialog`, `alertDialog`, `confirm`, `dismiss`, `tab`, `fillDateTime`, `expectRowCount`. |
| `consoleGuard` | Fails a test on page errors, hydration errors or unexpected `console.error`. `consoleGuard.allow(/pattern/)` permits expected errors. |
| `mock` | Resets the mock (done automatically before each test). |
| `stack` | This worker's URLs. `test.use({ stackOptions: { token: null } })` starts an unconfigured app. |

Helpers: `expectToast` (`e2e/helpers/toasts.ts`), `recordAppearances` (proves a state never
flashed, `e2e/helpers/flash.ts`) and `expectAccessible` (axe, `e2e/helpers/a11y.ts`).

## Rules for spec authors

- After `goto`, assert something that came from the API first. That proves the page hydrated
  before you click.
- Never use `waitForTimeout` or `networkidle`. Use web-first assertions (`await expect(...)`).
- Arrange data with `api` **before** `goto`. Data changed later won't show until a refetch
  (stale time is 30 s).
- Find elements by role and accessible name. Only the week view's `now-marker` has a test id.
- Assert request bodies with `net.waitFor(...)` (start waiting before the click). Assert the
  result with `api`.
- Close toasts after asserting them (`expectToast` does), because they can cover pagination.
- Tests for known bugs use `test.fail(true, "BUG-NN …")` and the tag `@bug-NN`. Once the bug
  is fixed, Playwright reports "expected to fail but passed", so remove the marker.

## Troubleshooting

- **Keep the computer awake (and the lid open) during a run.** If it sleeps, the
  per-worker servers can die. Tests then fail with "The test stack for this worker stopped
  responding…", and a stalled run stops at the 20-minute global timeout. Rerun the suite.
- **Run one `playwright test` at a time in this folder.** Every run starts by clearing
  `test-results/`. A second run deletes the first one's trace files, which shows up as
  `ENOENT … .playwright-artifacts-…/traces/…` errors in tests that otherwise passed.
- **The HTML report always shows the last run.** `npx playwright show-report` keeps serving
  `playwright-report/`; refresh it after a new run.
