# Tasks: Multi-Service Sync Matrix

Requirements coverage: R01–R09, R11i–R16i (see `manifest.md`). R10 and the deferred items are excluded by design.

## Phase A — Abstraction

- [ ] A1. Define `MediaServicePort`, `ServiceCapabilities`, `ServiceRef`, `ServiceId`, `CsvBundle` in `ext/src/services/port.ts`. <!-- id: A1, req: R06 -->
- [ ] A2. Extract the shared rate-limited request helper into `ext/src/services/http.ts` so adapters stop duplicating throttle/retry logic. <!-- id: A2, req: R12i -->
- [ ] A3. Add per-service storage key constants and credential read/write helpers in `ext/src/services/credentials.ts`; `storageKeyFor('tmdb')` must keep returning the existing `tmdbAuth` key. <!-- id: A3, req: R08, R14i, R16i -->
- [ ] A4. Extend `ext/src/types.ts`: new `RuntimeMessage` actions for per-service credentials/ping/target-toggle/multi-target sync/CSV export; add `TargetProgress[]` to state while keeping legacy aggregate counters. <!-- id: A4, req: R06, R12i, R16i -->
- [ ] A5. Remove the dead message types `STOP_SCANNING` / `STOP_MIGRATION` and wire `PAUSE_MIGRATION` to the pause control so no dead or unreachable handler survives. <!-- id: A5, req: R20i -->
- [ ] A6. Add a real `typecheck` script (`tsc --noEmit` over `src/` only, excluding vite's own declarations) and make `build` depend on it, so type errors fail the build instead of passing silently. <!-- id: A6, req: R21i -->

## Phase B — Adapters


- [ ] B1. `ext/src/services/tmdbPort.ts` — wrap existing `TMDBClient` behind `MediaServicePort` with no behaviour change. <!-- id: B1, req: R16i -->
- [ ] B2. `ext/src/services/traktPort.ts` — device-code OAuth (user-supplied client_id + client_secret, since the token exchange requires the secret), resolve via imdb→tmdb→search, read+write ratings and watchlist with 1 req/s write throttle. <!-- id: B2, req: R05, R13i -->
- [ ] B3. `ext/src/services/simklPort.ts` — PIN flow with interval polling, resolve via imdb/tmdb, bulk read+write ratings and plan-to-watch. <!-- id: B3, req: R05 -->
- [ ] B4. `ext/src/services/csvPorts.ts` — Letterboxd (full documented header set, `Rating10`, 1 MB split with repeated header), IMDb (exact 13-column export header, export-only), MovieLens (`userId,movieId,rating,timestamp`, export-only), all UTF-8 with BOM. <!-- id: B4, req: R07, R17i, R18i, R19i -->


## Phase C — Orchestrator

- [ ] C1. Replace the TMDB-only sync loop in `ext/src/background.ts` with a multi-target orchestrator over enabled ports, preserving abort/pause semantics and the decoupled scrape worker. <!-- id: C1, req: R01, R06, R12i -->
- [ ] C2. Wire per-target dedupe preload for every API port and surface skipped counts per target. <!-- id: C2, req: R12i -->
- [ ] C3. Add message handlers: per-service credential save, per-service ping, enable/disable target, multi-target sync start. <!-- id: C3, req: R08, R15i -->

## Phase D — UI

- [ ] D1. Restructure `ext/popup.html` tab bar: Перенос, Экспорт CSV, Ключи, Инструкция + one tab per service, each with credential inputs, ping badge, status, enable toggle. <!-- id: D1, req: R03, R09 -->
- [ ] D2. Update `ext/src/popup.ts`: tab switching, per-service ping wiring, enable-toggle state, per-target progress rendering, log scroll behaviour preserved. <!-- id: D2, req: R03, R09, R12i -->
- [ ] D3. Extend the `translations` dictionaries with every new RU/EN string. <!-- id: D3, req: R15i -->
- [ ] D4. Extend the guide tab with per-service sections: where to get credentials, capabilities, and the exact CSV import path for CSV-only services (links open in a new tab). <!-- id: D4, req: R07, R15i -->
- [ ] D5. State plainly in the UI that Kinopoisk is source-only and cannot be a write target. <!-- id: D5, req: R11i -->

## Phase E — Verification

- [ ] E1. `cd ext && npm run build` — zero TypeScript errors. <!-- id: E1, req: R16i -->
- [ ] E2. Smoke test in the Antidetect `test` profile via CDP: every tab renders, ping badges resolve, multi-target sync starts, stop halts mid-run. <!-- id: E2, req: R16i -->
- [ ] E3. Verify no regression in Kinopoisk scraping, TMDB push, and CSV export. <!-- id: E3, req: R16i -->
