# Hapio Admin

An admin panel for the [Hapio](https://hapio.io) booking API. It covers every operation in
the [Hapio API v1](https://docs.hapio.io/hapio-api-definition/Hapio-API.v1.yaml): locations,
resources, services, schedules, bookable slots, bookings and booking groups.

Built with Next.js (App Router), TypeScript, Tailwind CSS and shadcn/ui.

## Getting started

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

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Dev server on 127.0.0.1:3000 |
| `npm run build` / `npm start` | Production build / server (127.0.0.1) |
| `npm run typecheck` | Generates route types and runs `tsc` |
| `npm run lint` | ESLint |
| `npm test` | Vitest unit tests for the helpers (query builder, durations, prices, time zones) |
| `npm run mock` | In-memory mock Hapio API on 127.0.0.1:4010 |

## Managed in the Hapio portal, not here

The Hapio API has no endpoints for the following, so the panel can't manage them:

- API tokens.
- Webhooks.
- Creating, updating or deleting projects. `GET /project` is read-only.

The **Project** page lists the webhook events and explains how to verify their signatures.
