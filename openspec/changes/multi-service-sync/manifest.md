# Requirements Manifest — multi-service-sync

Change: `multi-service-sync`
Source: conversation turns (user language: Russian). Every requirement carries the VERBATIM quote it came from.
Status values: `open` | `in-spec` | `in-ticket` | `done` | `placeholder` | `deferred` | `dropped`.

## Rows

| ID | Requirement | Verbatim quote | Status |
|----|-------------|----------------|--------|
| R01 | Extension must support double/two-way synchronization across services, not only TMDB | «хочу, чтобы оно могло делать двойную синхронизацию везде» | in-spec |
| R02 | Kinopoisk must remain one of the synchronization endpoints | «На таких сервисах и кинопоиск» | in-spec |
| R03 | The UI must be modernized and split into navigable tabs | «модернизировать наш UAI в расширении все это разделить на вкладке, чтобы пользователь мог удобно навигировать» | in-spec |
| R04 | Work must be executed using the T3 workflow (full SDD program lane) | «Используя наш т3 Воркфлоу» | done |
| R05 | The set of target services includes all six shown in the user's status screenshots | `services: "все"` (IMDb, Letterboxd, MovieLens, Trakt, Simkl, TMDB) | in-spec |
| R06 | Sync direction is a full matrix — any source to any target | «Полная матрица: любой источник ➔ любой приёмник» | in-spec |
| R07 | Services without a write API are delivered as exact-format CSV export plus clear in-UI import instructions on the guide tab | «Генерация CSV + понятная инструкция на вкладке гайда» | in-spec |
| R08 | Auth model is hybrid: ship a default public client_id, keep fields for user-supplied override | «Гибрид: свои ключи по умолчанию + возможность вставить свои» | in-spec |
| R09 | UI delivery is one dedicated tab per service | «Отдельная вкладка на каждый сервис» | in-spec |
| R10 | Incremental diff-sync (history of previous runs / only-new-items) is CUT from this release | `scope_cut: "2"` → «Инкрементальный дифф-синк (только новые элементы)» | dropped |

## Implicit requirements (derived, not literally spoken) — `i`-suffix

| ID | Requirement | Basis | Status |
|----|-------------|-------|--------|
| R11i | Kinopoisk CANNOT be a write target — no public write API exists; it is source-only, with CSV as the honest fallback | Consequence of R02 + R06 that the user did not state | in-spec |
| R12i | Per-target duplicate detection must be preserved for every API-backed target (existing TMDB behaviour generalized), since the user already approved it for TMDB | Consequence of R01 + R06 | in-spec |
| R13i | RESOLVED BY FACT: Trakt `/oauth/device/token` requires `client_secret`; Simkl requires an app `client_id`. No default public client can ship for either — both degrade to user-registered apps with input fields (the "гибрид" answer is honoured only where a service permits it). | Verified: `agent://ExternalApiFacts`, source https://docs.trakt.tv/reference/auth | in-spec |
| R14i | All API keys and tokens stay local (`chrome.storage.local`); no key may be committed or transmitted to a third party | Stated in the repo README security section and maintained across all prior turns | in-spec |
| R15i | The existing RU/EN bilingual interface must extend to every new tab and every new guide section | Existing product invariant (i18n object in popup.ts) | in-spec |
| R16i | Existing working behaviour must not regress: Kinopoisk scraping, TMDB rating/watchlist push, CSV export, key ping, stop/pause controls | Repo state and prior verification turns | in-spec |
| R17i | RESOLVED BY FACT: IMDb has NO CSV import of any kind. Deliverable is export-only with the exact 13-column header `Const,Your Rating,Date Rated,Title,URL,Title Type,IMDb Rating,Runtime (mins),Year,Genres,Num Votes,Release Date,Directors`; the UI must state plainly that import is impossible rather than implying otherwise. | Verified: `agent://ExternalApiFacts` | in-spec |
| R18i | RESOLVED BY FACT: MovieLens ratings key on internal `movieId`, unresolvable without their `links.csv`. Deliverable is dataset-format `ratings.csv` export, marked export-only — not a live sync. | Verified: `agent://ExternalApiFacts` | in-spec |
| R19i | Letterboxd CSV import is the only genuine file-upload path; output must honour the documented 1 MB per-file limit by splitting and repeating the header. Columns: `LetterboxdURI,tmdbID,imdbID,Title,Year,Directors,Rating,Rating10,WatchedDate,Rewatch,Tags,Review`; `Rating10` is the 1–10 integer field. Import screen: https://letterboxd.com/import/ | Verified: `agent://ExternalApiFacts` | in-spec |
| R20i | Dead message types `STOP_SCANNING` / `STOP_MIGRATION` (declared, no handler) and the orphaned `PAUSE_MIGRATION` handler must be removed or wired during this refactor — no dead code may survive. | Recon: `ext/src/types.ts:75-76`, no handler in `background.ts` | in-spec |
| R21i | A real `tsc --noEmit` type-check gate must be added: `vite build` does NOT type-check and currently hides genuine errors, e.g. `MovieItem` imported by `popup.ts:1` is not exported by `types.ts`. | Verified locally: `vite build` passed with the error present | in-spec |

## Explicit non-goals for this release (confirmed by user's scope_cut answer)

- Reverse import INTO Kinopoisk (no write API) — `dropped`
- Incremental diff-sync / run history — `dropped` (R10)
- Scheduled or background auto-sync — not selected, therefore `deferred`
- Python CLI/TUI layer changes — not selected, therefore `deferred`
