# Proposal: Multi-Service Sync Matrix (Kinopoisk → TMDB / Trakt / Simkl / Letterboxd / IMDb / MovieLens)

## Problem

The extension today is hard-wired to a **single destination**: TMDB.

1. `background.ts` instantiates exactly one client (`tmdbClient: TMDBClient | null`) and the sync loop calls TMDB methods directly inline.
2. There is no abstraction for "a service that can accept media ratings/watchlist" — adding a second destination today means editing the sync loop itself.
3. The user asked for **"двойную синхронизацию везде"** — synchronization across the services they already use in parallel: TMDB, IMDb, Letterboxd, MovieLens, Trakt, Simkl.
4. Three of those services (IMDb, Letterboxd, MovieLens) have **no public write API**. Any design that pretends otherwise will produce a silently broken feature.
5. Kinopoisk also has **no write API** — it can only ever be a source, which the current UI does not make explicit.

## Solution

Introduce a **service-port abstraction** and drive the existing sync loop through it.

### 1. `MediaServicePort` interface (`ext/src/services/port.ts`)

One interface every destination implements:

- `id`, `label`, `capabilities` (`canRate`, `canWatchlist`, `requiresAuth`, `writeMode: 'api' | 'csv'`)
- `ping(): Promise<boolean>` — credential validity probe
- `resolve(item: MovieItem): Promise<ServiceRef | null>` — map a Kinopoisk item to this service's own id
- `pushRating(ref, rating)`, `pushWatchlist(ref)`
- `fetchExistingRatings()`, `fetchExistingWatchlist()` — for per-target dedupe (generalizes the TMDB preload already shipped)
- `exportCsv(items)` — for `writeMode: 'csv'` services

### 2. Adapters

| Service | writeMode | Auth | Notes |
|---|---|---|---|
| TMDB | api | OAuth session (existing) | move current logic behind the port unchanged |
| Trakt | api | device-code OAuth | ratings + watchlist |
| Simkl | api | PIN flow | ratings + plan-to-watch |
| Letterboxd | csv | none | exact-format CSV + in-UI import instructions |
| IMDb | csv | none | exact-format CSV export |
| MovieLens | csv | none | exact-format `ratings.csv` export |
| Kinopoisk | source only | none | scrape only; no write path exists |

### 3. Orchestrator drives a set of enabled ports

`runMigration` becomes `runSync(targetIds: string[], category, delayMs)`: for each enabled target port, resolve → dedupe → push, with independent counters. The existing abort/pause flags gate every loop.

### 4. UI: one tab per service

Tabs become: **Перенос** · **Экспорт CSV** · **Ключи** · **Инструкция** · one tab per service (TMDB, Trakt, Simkl, Letterboxd, IMDb, MovieLens). Each service tab holds its credential fields, a live ping badge, its own connection status, and its own enable toggle that feeds the sync matrix.

### 5. Honest delivery for no-API services

Letterboxd/IMDb/MovieLens tabs do not fake an API. They generate the exact CSV the service expects and link the user to that service's import screen, with the required column order documented on the guide tab.

## Why this shape

- The existing TMDB code already contains every primitive the port needs (rate-limited `request()`, `pingKey()`, rated/watchlist preload, dedupe). Generalizing an interface over proven code is cheaper and safer than a rewrite.
- CSV-first for the three write-less services means zero browser automation, zero ToS risk, and zero breakage when those services change their DOM.
- A port interface lets each new service land as one adapter file plus one tab — no edits to the sync loop.

## Non-goals (this release)

- Incremental diff-sync / persistent run history — explicitly cut by the user.
- Scheduled or background auto-sync.
- Reverse import **into** Kinopoisk — impossible without a write API.
- Any change to the Python CLI/TUI layer.
