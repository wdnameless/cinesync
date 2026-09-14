# Interfaces — multi-service-sync

Ownership zones and public signatures. Seeded from the spec BEFORE any Wave 3 spawn.
Rule: exactly **one owner per file**. Paths are handed to subagents by path, never pasted.

## Delivered status

| Zone | Files | Owner | State |
|---|---|---|---|
| A — Abstraction | `ext/src/services/port.ts`, `http.ts`, `credentials.ts` | Agent-A | **DELIVERED** — verified by direct read + isolated `tsc --noEmit` (0 errors) |
| B — Adapters (API) | `ext/src/services/tmdbPort.ts`, `traktPort.ts`, `simklPort.ts` | Agent-B | **DELIVERED** — verified: delegates to `TMDBClient`, uses shared `jsonRequest`, carries `AuthExpiredError` |
| C — Adapters (CSV) | `ext/src/services/csvPorts.ts` | Agent-C | **DELIVERED** — verified: zero DOM references, line-boundary `TextEncoder` split |
| D — Contract & Orchestrator | `ext/src/types.ts`, `ext/src/background.ts` | Agent-D | pending |
| E — UI | `ext/popup.html`, `ext/src/popup.ts`, `ext/manifest.json` | Agent-E | pending |

Whole services layer (7 files, 2046 lines) type-checks cleanly under `--strict`:
`npx tsc --noEmit --skipLibCheck --types chrome --lib DOM,ESNext --target ESNext --module ESNext --moduleResolution bundler --strict src/services/*.ts` → 0 errors.

`MovieItem` is canonically exported from `port.ts` (it was previously imported from `types.ts` without existing there). `types.ts` re-exports it rather than redefining it — one definition only.

## Zone A — frozen public signatures (`ext/src/services/port.ts`)

```ts
export type ServiceId = 'tmdb' | 'trakt' | 'simkl' | 'letterboxd' | 'imdb' | 'movielens';

export type WriteMode = 'api' | 'csv';

export interface ServiceCapabilities {
  canRate: boolean;
  canWatchlist: boolean;
  requiresAuth: boolean;
  writeMode: WriteMode;
  /** true when the service documents no import path at all — UI must say so plainly */
  exportOnly?: boolean;
  /** documented per-file byte ceiling for CSV services, when one exists */
  maxFileBytes?: number;
}

/** A resolved id in the target service's own namespace */
export interface ServiceRef {
  service: ServiceId;
  id: string;
  mediaType: 'movie' | 'tv';
  label?: string;
}

/** Canonical movie/series item across sources and ports */
export interface MovieItem {
  id?: string;
  kpId?: string;
  imdbId?: string;
  tmdbId?: number;
  title: string;
  originalTitle?: string;
  year?: number;
  rating?: number;
  voteDate?: string;
  category?: 'ratings' | 'watchlist';
  type?: 'film' | 'series' | 'movie' | 'tv';
  url?: string;
}

/** Return shape for CSV adapters so one export can yield several files (e.g. Letterboxd 1 MB limit) */
export interface CsvBundle {
  filename: string;
  content: string;
}

export interface MediaServicePort {
  readonly id: ServiceId;
  readonly label: string;
  readonly capabilities: ServiceCapabilities;

  ping(): Promise<boolean>;
  resolve(item: MovieItem): Promise<ServiceRef | null>;
  pushRating(ref: ServiceRef, rating: number): Promise<void>;
  pushWatchlist(ref: ServiceRef): Promise<void>;
  fetchExistingRatings(): Promise<Map<string, number>>;
  fetchExistingWatchlist(): Promise<Set<string>>;
  exportCsv(items: MovieItem[]): CsvBundle[];
}
```

A CSV-mode port MUST throw `new Error('<id>: pushRating is not supported (writeMode=csv)')` rather than silently resolving. Silent no-ops are prohibited.


## Zone A — `http.ts` (shared transport)

```ts
export interface HttpOptions {
  headers?: Record<string, string>;
  /* minimum ms between requests for this client instance */
  minIntervalMs?: number;
}

export async function jsonRequest<T>(
  url: string,
  init: RequestInit,
  opts?: HttpOptions
): Promise<T>;
```

Contract: throttles to `minIntervalMs`, retries once on HTTP 429 honouring `Retry-After`, throws with status + body text on other non-2xx. Adapters MUST NOT roll their own retry loop.

## Zone A — `credentials.ts`

```ts
export interface ServiceCredentials {
  clientId?: string;
  clientSecret?: string;
  accessToken?: string;
  apiKey?: string;
  sessionId?: string;
  accountId?: string;
  username?: string;
  userId?: string;
}

/** Fixed per-service storage keys. Missing fields stay `undefined` — never a placeholder. */
export const STORAGE_KEYS: Record<ServiceId, string> = {
  tmdb: 'tmdbAuth',          // { apiKey, sessionId, accountId, username } — unchanged
  trakt: 'traktAuth',        // { clientId, clientSecret, accessToken }
  simkl: 'simklAuth',        // { clientId, accessToken }
  letterboxd: 'letterboxdAuth', // { userId }
  imdb: 'imdbAuth',          // { userId }
  movielens: 'movielensAuth',   // { userId }
};

export function storageKeyFor(service: ServiceId): string;
export function loadCredentials(service: ServiceId): Promise<ServiceCredentials>;
export function saveCredentials(service: ServiceId, creds: ServiceCredentials): Promise<void>;
```

`storageKeyFor('tmdb')` MUST return `'tmdbAuth'` exactly, so existing user data keeps working (R16i). `accountId` MUST survive the round-trip: TMDB's watchlist endpoint is account-scoped.

No service may ship a bundled `client_secret`. Trakt's device-token exchange requires one, and Simkl requires an app-scoped `client_id`; for those two the user registers their own application and supplies both fields in the UI.

## Zone D — message contract additions (frozen names AND frozen payloads)

New `RuntimeMessage` variants. **Both the request shape and the response shape are frozen here** — Agent-D (background) and Agent-E (popup) must not invent divergent payloads.

```ts
// Request variants
| { action: 'SAVE_SERVICE_CREDENTIALS'; service: ServiceId; credentials: ServiceCredentials }
| { action: 'PING_SERVICE'; service: ServiceId }
| { action: 'TOGGLE_TARGET'; service: ServiceId; enabled: boolean }
| { action: 'START_SYNC'; targets: ServiceId[]; category: MediaCategory; delayMs?: number }
| { action: 'EXPORT_SERVICE_CSV'; service: ServiceId }

// Frozen response payloads (what sendResponse receives)
interface ServiceResult { success: boolean; error?: string }
// SAVE_SERVICE_CREDENTIALS → ServiceResult
// TOGGLE_TARGET           → ServiceResult
// PING_SERVICE            → { success: boolean; valid: boolean; error?: string }
// START_SYNC              → ServiceResult            (starts the run; progress arrives via GET_STATE)
// EXPORT_SERVICE_CSV      → { success: boolean; files: CsvBundle[]; error?: string }
```

`EXPORT_SERVICE_CSV` returning `files: CsvBundle[]` is what lets the popup own the DOM download while the service worker owns string generation — the two halves of the MV3 CSV boundary.

Removed (R20i): `STOP_SCANNING`, `STOP_MIGRATION`. `PAUSE_MIGRATION` is wired to the pause control instead of being orphaned.

`START_SYNC` **supersedes** `START_MIGRATION`: the latter MUST be removed from the union, and every caller in `popup.ts` MUST be migrated. Leaving both would create exactly the dead-action class this refactor removes.

Per-target state on `MigrationState` — the shape below is authoritative and MUST match the spec exactly:

```ts
export type TargetStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface TargetProgress {
  service: ServiceId;
  synced: number;
  skipped: number;
  failed: number;
  total: number;
  status: TargetStatus;
  error?: string;
}
// MigrationState gains: targets?: TargetProgress[];
```

`'partial'` is a **top-level** `MigrationStatus` value, not a per-target one — a single target either completes, fails, or is skipped; "partial" only makes sense across the set.

`MigrationStatus` MUST be widened to include `'partial'`, because the spec requires a run where at least one target failed while at least one completed to resolve to that terminal status rather than `'completed'` or `'error'`:

```ts
export type MigrationStatus =
  | 'idle' | 'detecting' | 'scraping' | 'paused_captcha'
  | 'migrating' | 'completed' | 'partial' | 'error';
```

Legacy `syncedCount` / `skippedCount` / `failedCount` MUST remain as the aggregate so existing UI wiring keeps rendering. Aggregate definition, stated once so no ambiguity survives: each aggregate is the **sum of the corresponding per-target counter across all targets**, recomputed after every per-target update. A target that failed mid-run contributes the counters it had reached; items never attempted are not counted as failed.


## Zone E — DOM id contract (Agent-E owns both sides)

New ids, one set per service tab (substitute `<svc>` ∈ tmdb|trakt|simkl|letterboxd|imdb|movielens):

- Tab button: `tab<svc>Btn` · Tab pane: `tab<svc>`
- Ping badge: `<svc>PingBadge` · Ping text: `<svc>PingText`
- Credential inputs: `<svc>ClientId`, `<svc>ClientSecret` / `<svc>ApiKey` as applicable
- Save button: `<svc>SaveBtn` · Connect button: `<svc>LoginBtn`
- Enable toggle: `<svc>EnableToggle`
- CSV export button: `<svc>ExportBtn`

`switchTab()` signature must widen to accept the new tab ids. Element ids referenced from TS MUST exist in `popup.html` — the recon found three lookups with no matching element (`progressFill`, `progressPctText`, `activeTitle`) that survived only because of `||` fallbacks; these MUST be reconciled to single canonical ids.

`manifest.json` `host_permissions` MUST gain: `*://*.trakt.tv/*`, `*://*.simkl.com/*`, `*://*.letterboxd.com/*`, `*://*.imdb.com/*`, `*://*.movielens.org/*`. No permission may be added that no code path uses.

## Build gate (R21i)

`ext/package.json` MUST expose a `typecheck` script running `tsc --noEmit` over `src/` only (vite's own `.d.ts` files must not be type-checked), and `build` MUST run it first so a type error fails the build.
