# Specification Delta: Multi-Service Sync Matrix

## ADDED Requirements

### Requirement: Uniform destination interface
The system MUST define a `MediaServicePort` interface implemented by every synchronizable service.

The interface MUST expose: `id`, `label`, `capabilities`, `ping()`, `resolve(item)`, `pushRating(ref, rating)`, `pushWatchlist(ref)`, `fetchExistingRatings()`, `fetchExistingWatchlist()`, `exportCsv(items)`.

`ServiceCapabilities` MUST declare `{ canRate, canWatchlist, requiresAuth, writeMode: 'api' | 'csv' }`.

A `writeMode: 'csv'` port MUST throw an explicit error from `pushRating`/`pushWatchlist` rather than silently resolving.

#### Scenario: Calling a write method on a CSV port
- **WHEN** `pushRating` is called on a port whose `capabilities.writeMode` is `'csv'`
- **THEN** it throws an `Error` naming the service and stating that push is unsupported
- **AND** it does not resolve successfully or silently discard the call

#### Scenario: Enumerating available ports
- **WHEN** the orchestrator requests the available targets
- **THEN** it receives one port per supported service, each reporting its own `capabilities`

### Requirement: Source vs destination distinction
Kinopoisk MUST be modelled as a source only and MUST NOT appear as a selectable sync destination.

The UI MUST state this limitation explicitly instead of showing a disabled control without explanation.

#### Scenario: Opening the service selector
- **WHEN** the user opens the destination service selector
- **THEN** Kinopoisk is absent from the list of destinations
- **AND** the UI text explains that Kinopoisk exposes no write API and is a source only

### Requirement: TMDB adapter preserves existing behaviour
The TMDB adapter MUST reuse the existing `TMDBClient` without behavioural regression: OAuth session creation, `session_id` on every write, ≤4 requests/second throttle, 429 retry, and multi-search matching.

The TMDB adapter MUST implement `fetchExistingRatings`/`fetchExistingWatchlist` using the already-shipped `getAllRatedIds()` / `getAllWatchlistIds()`.

#### Scenario: Rating an already-rated film
- **WHEN** the user syncs a rating for a film already rated on TMDB
- **THEN** the item is counted as skipped with its existing rating named in the log
- **AND** no rating write request is issued

### Requirement: Trakt adapter
The Trakt adapter MUST authenticate via the OAuth device-code flow (`POST https://auth.trakt.tv/oauth/device/code`, then poll `POST https://auth.trakt.tv/oauth/device/token`) and store the resulting access token locally.

Because the device-token exchange requires `client_secret`, the user MUST supply their own Trakt application `client_id` and `client_secret`; the UI MUST NOT imply a bundled default exists.

It MUST send `trakt-api-version: 2`, `trakt-api-key`, and `Authorization: Bearer` headers.

It MUST resolve items via `GET /search/{id_type}/{id}` using `imdb`, then `tmdb`, falling back to `GET /search/movie,show?query=`.

It MUST read existing state via `GET /sync/ratings/{type}` and `GET /sync/watchlist/{type}`, and write via `POST /sync/ratings` and `POST /sync/watchlist` using the `{ movies: [...], shows: [...] }` body shape.

It MUST respect the documented 1 request/second write limit and handle HTTP 429 with `Retry-After`.

#### Scenario: Trakt credentials absent
- **WHEN** the user opens the Trakt tab with no saved credentials
- **THEN** the tab requests `client_id` and `client_secret`
- **AND** it does not claim a built-in application exists

#### Scenario: Trakt write rate limiting
- **WHEN** more than one write request per second would be issued
- **THEN** the client spaces the writes to the documented limit
- **AND** an HTTP 429 is retried honouring `Retry-After`

### Requirement: Simkl adapter
The Simkl adapter MUST authenticate via the PIN flow: `GET https://api.simkl.com/oauth/pin?client_id=`, then poll `GET /oauth/pin/{user_code}` honouring the returned `interval`.

Status `400` MUST be treated as pending, `200` as approved with `access_token`, and `404`/`410` as expired.

It MUST send the `simkl-api-key` header plus `Authorization: Bearer` on authenticated calls, resolve items via `GET /search/id?imdb=` or `?tmdb=`, read existing state via `GET /sync/ratings/{type}` and `GET /sync/all-items/{type}/plantowatch`, and write ratings via `POST /sync/ratings` and plan-to-watch via `POST /sync/add-to-list`.

It MUST prefer bulk arrays over per-item calls.

#### Scenario: Polling before approval
- **WHEN** the PIN has not yet been approved
- **THEN** polling continues at the returned `interval`
- **AND** the UI shows a pending state rather than an error

#### Scenario: PIN expires
- **WHEN** Simkl returns `404` or `410`
- **THEN** polling stops and the UI reports that the code expired and offers a retry

### Requirement: CSV-only adapters
Each CSV adapter MUST expose the exact column set its service documents, in the documented order. Inventing column names is prohibited.

Letterboxd MUST emit `LetterboxdURI,tmdbID,imdbID,Title,Year,Directors,Rating,Rating10,WatchedDate,Rewatch,Tags,Review`, using `Rating10` as the 1–10 integer rating field.

MovieLens MUST emit `ratings.csv` with the dataset header `userId,movieId,rating,timestamp` and MUST be labelled export-only, because `movieId` cannot be resolved without the dataset's `links.csv`.

IMDb MUST emit the 13-column header `Const,Your Rating,Date Rated,Title,URL,Title Type,IMDb Rating,Runtime (mins),Year,Genres,Num Votes,Release Date,Directors` and MUST be labelled export-only: IMDb documents no CSV import whatsoever, so no import path may be implied.

Every CSV adapter MUST write UTF-8 with a BOM.

#### Scenario: Exporting IMDb data
- **WHEN** the user exports to the IMDb tab
- **THEN** exactly the 13 documented columns are produced in that order
- **AND** the UI states that IMDb has no import path

#### Scenario: Cyrillic titles in CSV
- **WHEN** an exported title contains Cyrillic characters
- **THEN** the file starts with a UTF-8 BOM
- **AND** the title opens without mojibake in Excel and Google Sheets

### Requirement: CSV generation boundary in Manifest V3
CSV content generation MUST be pure string building inside the adapter, with no DOM access, because a service worker has no `document`, `Blob` object URL, or anchor-click download.

The download trigger MUST occur in the popup context, which owns the DOM; the background MUST return generated content over the existing message channel.

#### Scenario: Exporting from the background worker
- **WHEN** an export is requested
- **THEN** the background generates file content without referencing `document` or `window`
- **AND** the popup performs the actual save

### Requirement: Letterboxd file-size split is UTF-8 safe
The 1 MB per-file limit MUST be enforced against UTF-8 encoded byte length measured with `TextEncoder`, not JavaScript string length.

Splitting MUST occur only on line boundaries; splitting at a raw byte offset is prohibited because Cyrillic titles are multi-byte and a mid-character cut corrupts the file.

Each part MUST repeat the full header row and carry its own BOM, and MUST be named with a `_partN` suffix.

#### Scenario: Payload under the limit
- **WHEN** the payload fits within 1 048 576 UTF-8 bytes
- **THEN** exactly one file is produced
- **AND** it carries no part suffix

#### Scenario: Payload over the limit
- **WHEN** the payload exceeds 1 048 576 UTF-8 bytes
- **THEN** more than one file is produced, each starting with a BOM and the full header
- **AND** no line is cut mid-character

### Requirement: Multi-target execution
The orchestrator MUST accept a list of enabled target service ids and run resolve → dedupe → push for each independently.

One target failing MUST NOT abort the remaining targets.

Existing abort and pause flags MUST gate every per-target loop.

#### Scenario: One target fails, another succeeds
- **WHEN** two targets are enabled and one fails mid-run
- **THEN** the other target continues to completion
- **AND** the run's terminal status reflects partial failure rather than plain success

#### Scenario: Stopping mid-run
- **WHEN** the user presses stop while a multi-target sync is running
- **THEN** every per-target loop halts at its next check point

### Requirement: Per-target progress reporting
`MigrationState` MUST carry a `targets` array whose entries are `{ service, synced, skipped, failed, total, status, error? }`, with `status` one of `pending | running | completed | failed | skipped`.

Aggregate `syncedCount` / `skippedCount` / `failedCount` MUST remain populated as the sum of the per-target counters so existing UI wiring keeps rendering.

A run where at least one target failed while at least one completed MUST resolve to terminal status `partial`.

#### Scenario: Observing two enabled targets
- **WHEN** a sync starts with two enabled targets
- **THEN** the state contains two target entries
- **AND** each entry carries its own counters

#### Scenario: Aggregate counters stay correct
- **WHEN** per-target counters change
- **THEN** the aggregate counters equal their sum

### Requirement: Authentication expiry during a run
On HTTP 401 or 403 from a target mid-run, the orchestrator MUST mark that target `failed` with reason `AUTH_EXPIRED`, stop issuing further requests to that service, and continue with the remaining targets.

The UI MUST name the affected service and offer a re-authenticate affordance.

#### Scenario: Token expires mid-sync
- **WHEN** a target returns 401 during item synchronization
- **THEN** that target is marked failed with reason `AUTH_EXPIRED`
- **AND** no further requests are sent to that service
- **AND** other targets continue

### Requirement: Bounded pagination
Every pre-fetch of existing ratings or watchlist MUST paginate with `limit` at most 100 per request.

Pre-fetch MUST stop after 50 pages per category and MUST log a warning naming the cap when reached.

#### Scenario: Reaching the pagination cap
- **WHEN** a target reports more pages than the cap allows
- **THEN** pre-fetch stops at the cap
- **AND** a warning naming the cap is logged

### Requirement: Hybrid credential model
Where a service permits a bundled public client identifier, it MUST ship one and MUST also accept a user override.

Where a service does not permit a bundled client — Trakt requires `client_secret`, Simkl requires an app-scoped `client_id` — the UI MUST require the user to register their own application and MUST NOT imply a default exists.

Credentials MUST be stored under fixed per-service keys: `tmdbAuth` (`{ apiKey, sessionId, accountId, username }`, unchanged), `traktAuth` (`{ clientId, clientSecret, accessToken }`), `simklAuth` (`{ clientId, accessToken }`), and `{ userId }` for the CSV services.

Absent fields MUST be `undefined`, never a fabricated placeholder.

`accountId` MUST be fetched on login and persisted for TMDB, because its watchlist endpoint is account-scoped.

No client secret or token may be committed to the repository.

#### Scenario: Upgrading an existing installation
- **WHEN** the extension updates over an installation holding existing TMDB credentials
- **THEN** those credentials and settings still load
- **AND** the TMDB watchlist action still works, proving `accountId` survived

### Requirement: Live credential probe
Every service tab MUST ping its credentials and render a `valid` / `invalid` / `checking` state adjacent to the field.

Ping MUST be triggered on popup open and on credential save.

#### Scenario: Saving a valid credential
- **WHEN** a service's credentials validate successfully
- **THEN** its badge renders the `valid` state

#### Scenario: Saving an invalid credential
- **WHEN** validation fails
- **THEN** its badge renders the `invalid` state
- **AND** the failure is distinguishable from the pending state

### Requirement: Two-level tab navigation
The tab bar MUST contain the four primary tabs (Перенос, Экспорт CSV, Ключи, Инструкция) plus one entry per service.

Because ten tabs cannot fit a 390 px popup alongside a no-scroll requirement, navigation MUST be two-level: the primary bar holds the four fixed tabs, and service tabs are reached through a second-level selector rendered as a horizontally scrollable segmented row.

The primary bar MUST NOT wrap or overflow horizontally at the popup's minimum width.

#### Scenario: Primary bar at minimum width
- **WHEN** the popup is rendered at its minimum width
- **THEN** all four primary labels are fully visible
- **AND** the bar's `scrollWidth` does not exceed its `clientWidth`

#### Scenario: Reaching any service in one click
- **WHEN** the user selects a service from the second-level selector
- **THEN** that service's tab becomes active without requiring page scrolling

### Requirement: Service tab content
Each service tab MUST contain credential inputs, a live ping badge, a connection status line, an enable toggle feeding the sync matrix, and that service's own actions.

A service with `writeMode: 'csv'` MUST show an export action and an import-instruction link instead of a connect-and-push action.

A service marked export-only MUST state in the tab itself, in both languages, that no import path exists.

#### Scenario: Opening a CSV service tab
- **WHEN** the user opens the Letterboxd tab
- **THEN** an export action and an import-instruction link are shown
- **AND** no connect-and-push control is present

### Requirement: Bilingual coverage
Every new tab label, field label, status string, and guide section MUST exist in both the `ru` and `en` dictionaries.

The log auto-scroll MUST keep respecting manual scroll position: auto-scroll applies only while the log is scrolled within 40 px of the bottom; any wider offset suppresses it until the user returns to the bottom.

#### Scenario: Both languages render every key
- **WHEN** the language is switched
- **THEN** every element carrying a translation key shows a translated string
- **AND** no key falls back to a raw identifier

#### Scenario: User scrolls up in the log
- **WHEN** the log is scrolled more than 40 px from the bottom and a new entry arrives
- **THEN** the scroll position is preserved
- **AND** auto-scroll resumes once the user returns to the bottom

### Requirement: Guide coverage
The guide MUST document, per service, where to obtain credentials, what the service can and cannot do, and — for CSV services — the exact import path.

All external links MUST open in a new browser tab.

#### Scenario: Reading a CSV service's guide section
- **WHEN** the user opens the guide section for a CSV service
- **THEN** the required credential source and the import steps are described
- **AND** the import link opens in a new tab

### Requirement: No regression
Kinopoisk scraping, TMDB push, CSV export, key ping, stop/pause, and the bilingual UI MUST continue to work after the refactor.

The build MUST run a real `tsc --noEmit` gate; `vite build` alone does not type-check and currently hides genuine type errors.

The Kinopoisk title-matching pipeline MUST be preserved verbatim inside the TMDB adapter's resolution: IMDb-id lookup, `е`/`ё` normalization, and the post-colon franchise fallback.

The Kinopoisk scraper functions MUST remain self-contained for `chrome.scripting.executeScript({ func })`: no imports and no outer-scope references.

The existing `chrome.storage.local` keys `tmdbAuth` and `kpApiKey`, and the UI preference keys, MUST keep their current names and shapes so an existing user's saved credentials and settings survive the upgrade.

#### Scenario: Running the build
- **WHEN** `npm run build` is executed with a type error present in `src/`
- **THEN** the build fails rather than producing output

#### Scenario: Scraper injection
- **WHEN** the Kinopoisk parser is injected via `chrome.scripting.executeScript`
- **THEN** it executes without referencing any outer-scope symbol
- **AND** it returns parsed items or a captcha signal

#### Scenario: Franchise title with a colon
- **WHEN** a title contains a colon and the full-title search yields no match
- **THEN** the post-colon segment is searched as a fallback

#### Scenario: Existing settings survive the upgrade
- **WHEN** the extension updates over an installation with saved credentials and preferences
- **THEN** those values still load
- **AND** the previously working controls still function

### Requirement: No dead runtime message actions
The message union MUST NOT declare an action that has no handler, and MUST NOT contain a handler that no caller reaches.

#### Scenario: Message union after the refactor
- **WHEN** the message union is inspected
- **THEN** no declared action lacks a handler
- **AND** no handler lacks a caller
