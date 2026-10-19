# Hapio Admin

An admin panel for the [Hapio](https://hapio.io) booking API. It covers every operation in
the [Hapio API v1](https://docs.hapio.io/hapio-api-definition/Hapio-API.v1.yaml): locations,
resources, services, schedules, bookable slots, bookings and booking groups.

Built with Next.js (App Router), TypeScript, Tailwind CSS and shadcn/ui.

## Getting started

You need Node.js 22.12 or later (`nvm use` picks the version in `.nvmrc`).

```bash
npm install
cp .env.example .env.local   # then set HAPIO_API_TOKEN
npm run dev                  # http://127.0.0.1:3000
```

Create the API token in the [Hapio portal](https://hapio.app) and give it the abilities admins
should have (for example `booking:create`, `booking:ignore_schedule`,
`location:protected_metadata`). If the token lacks an ability, the request fails with 403
and the panel shows the error.

### Trying it without a Hapio project

`npm run mock` starts an in-memory mock of the Hapio API with demo data on port 4010.
To use it, point the panel at the mock in `.env.local`:

```bash
HAPIO_API_TOKEN=dev
HAPIO_BASE_URL=http://127.0.0.1:4010/v1
```

### Demo data in your own project (optional)

A new Hapio project is empty, and you need locations, resources, schedules and services
before anything can be booked. `npm run seed` fills your project with the same demo data
the mock uses, so you can try every page:

- 2 locations (Stockholm, New York) in different time zones.
- 3 resources (Anna, Ben, Room A) with Mon–Fri 09–17 schedules and some blocked hours next week.
- 3 services, one of each type (fixed, flexible and day), linked to the resources.
- About a dozen bookings: past, upcoming, temporary and canceled, plus a booking group.

```bash
npm run seed                 # shows the target project and asks before writing anything
npm run seed -- --dry-run    # list what would be created, write nothing
npm run seed -- --clean      # delete everything the seeder created
```

It uses `HAPIO_API_TOKEN` and `HAPIO_BASE_URL` from `.env.local` or `.env`. Every record it
creates has `metadata.seed = "hapio-admin-demo"`. That tag is how `--clean` finds the records,
and you can filter on it in the panel. The token needs create and delete abilities for the
entities. Past bookings also need `booking:ignore_booking_window`. Without it, the seeder skips
those bookings and creates everything else. Add `--yes` to skip the confirmation prompt.

## How it works

- **The token stays on the server.** The browser calls `/api/hapio/*`. The proxy route
  (`src/app/api/hapio/[...path]/route.ts`) adds `Authorization: Bearer $HAPIO_API_TOKEN` and
  forwards the request to Hapio. It also passes the rate-limit headers back to the browser.
- **There is no login.** The panel is meant to run locally or behind your own VPN/SSO. The
  `dev` and `start` scripts only listen on `127.0.0.1`. The proxy also protects itself:
  - It rejects unknown `Host` headers, which blocks DNS rebinding.
  - It requires a custom `X-Hapio-Admin` header, which blocks cross-site requests.
  - To serve the panel under another hostname, list it in `ADMIN_ALLOWED_HOSTS`. Put real
    authentication in front of it before you expose it.
- **The SDK is typed.** `src/lib/hapio/client.ts` exposes all 60 operations as `hapio.*`. The
  types in `src/lib/hapio/types.ts` are written by hand from the spec. `buildQuery` serialises
  Hapio's filter syntax: `key[op]=v`, `metadata[a->b][op]=v` and `sort=a.asc,b.desc`.
- **Edits only send what changed.** Edit forms use PATCH with the fields you touched, so
  Hapio doesn't recalculate prices or buffers you didn't change. Every detail page also has a
  **JSON** tab that shows the raw response and can do a full replace (PUT).
- **Times use the location's time zone.** Hapio interprets dates and times in the location's
  time zone, and timestamps carry offsets. Date/time inputs edit wall time in that zone.
- **Filters live in the URL**, so filtered views can be bookmarked and shared.
- **The calendar is [Hapio Calendar](https://github.com/Hapio-Booking-and-Scheduling-API/hapio-calendar)**,
  Hapio's own MIT-licensed calendar for React 19 and shadcn/ui: the `hapio-calendar` registry
  block copied into `src/components/hapio-calendar/` (its theme lives in `src/app/globals.css`)
  on the `@hapio/calendar-core` and `@hapio/calendar-react` packages, with the Temporal
  polyfill loaded from `src/instrumentation-client.ts` and `src/instrumentation.ts`. Week, day,
  month and list views; a **Resources** layout (one row per resource) comes back with Hapio
  Calendar 1.3's resource timeline. The packages come from npm. To update the block, run
  `npx shadcn add @hapio/hapio-calendar` (`components.json` maps the `@hapio` registry to
  `calendar.hapio.io`) and answer "n" when it asks to overwrite your own `button`, `popover`
  and `scroll-area`.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Dev server on 127.0.0.1:3000 |
| `npm run build` / `npm start` | Production build / server (127.0.0.1) |
| `npm run typecheck` | Route types + `tsc` for the app and the e2e specs |
| `npm run lint` | ESLint |
| `npm test` | Vitest unit tests |
| `npm run test:e2e` | Build `.next-e2e`, then run the Playwright suite against the mock |
| `npm run test:e2e:only` | Rerun Playwright without rebuilding (e.g. `-- e2e/bookings`) |
| `npm run test:all` | Typecheck, lint, unit tests and e2e, in that order |
| `npm run mock` | In-memory mock Hapio API on 127.0.0.1:4010 |
| `npm run seed` | Optional: add demo data to your Hapio project (`--clean` removes it) |

## Tests

There are two layers of tests. Neither one touches a real Hapio project.

- **Unit tests (Vitest).** These cover the pure logic: the typed client (all 60 operations),
  the proxy route handler, query and filter serialisation, error mapping, retry policy,
  durations, prices, time zones and DST, and the form models. The form models are the parts
  of each form that build request bodies and map validation errors back to fields.
- **End-to-end tests (Playwright).** Each worker starts its own mock Hapio API and a
  production build of the panel. The tests then go through every page, filter, form, dialog
  and action in Chrome, plus the error states and the proxy's guards. They also check
  accessibility with axe and run a pass at phone width.
  - Data is reset before every test.
  - The clock is fixed at Wed 21 Oct 2026, so 7- and 30-day ranges cross daylight-saving
    changes.
  - Every request body is checked.
  - See [e2e/README.md](e2e/README.md) for fixtures and conventions.

The mock is deterministic when it's started with `MOCK_NOW` and `MOCK_SEED`. Set `MOCK_LOG=0`
to silence its request log. The test helpers `POST /__reset?now=…&empty=1` and `GET /__health`
live outside `/v1`.

## Managed in the Hapio portal, not here

The Hapio API has no endpoints for the following, so the panel can't manage them:

- API tokens.
- Webhooks.
- Creating, updating or deleting projects. `GET /project` is read-only.

The **Project** page lists the webhook events and explains how to verify their signatures.
