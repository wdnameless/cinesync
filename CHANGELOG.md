# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.2.1] — 2026-09-19

### Fixed

- **The packaged extension shipped with a dead popup.** `vite` emitted
  `<script src="/popup.js">`, which a Chrome extension resolves against the
  extension **root**, while the file lands in `dist/`. The packaged build
  therefore loaded *no* popup JavaScript: no tabs, no sync, no credentials —
  the store ZIP would have shipped non-functional. Builds now use a relative
  asset base (`./popup.js`).

  Note for reviewers: the markup still rendered and `getManifest()` still
  answered, which is why a smoke test that only checked the DOM passed. The
  regression is caught by clicking a tab and asserting the pane changed.

### Changed

- **No more third-party font requests.** The popup fetched Plus Jakarta Sans
  and JetBrains Mono from `fonts.googleapis.com`, which contradicted the
  privacy statement (an undeclared fifth contacted host) and delayed first
  paint. It now uses a system font stack.
- **Header brand corrected.** The in-app header still read
  "Кинопоиск ➔ TMDB" after the rename; the manifest and `<title>` had changed
  but the visible brand had not.
- **Service tabs wrap instead of hiding.** Six services did not fit one 440px
  row, and the last one sat behind an invisible scroll edge.
- **Target rows are readable.** They showed raw wire values ("tmdb completed")
  instead of the product name and a localised status.
- **Metric and action labels are target-agnostic.** "Собрано / В TMDB / Ошибки"
  and "2. В TMDB" predated multi-target sync and now read
  "Собрано / Перенесено / Ошибки" and "2. Синхронизировать".
- **Progress reflects finished runs.** A completed run showed 0% next to its
  own counters.

### Added

- `store/` with the listing assets: six 1280×800 screenshots and the 440×280
  and 1400×560 promo tiles.

## [3.2.0] — 2026-09-16

### Changed

- **Renamed to CineSync.** The product, manifest name, package name, popup
  title, store artifacts and repository all move from the Kinopoisk-anchored
  names to one that describes the actual capability: synchronising ratings and
  watchlists across services. The former name also implied a TMDB-only, 
  Kinopoisk-only tool and carried a third-party brand in the product title,
  which the store's impersonation policy discourages.
- Store artifacts are now `cinesync-<version>.zip` and
  `cinesync-unpacked.zip`.
- Extension ID is unchanged, so existing installs keep their credentials and
  saved scans when they update.

## [3.1.0] — 2026-09-15

### Removed

- **Trakt support.** The adapter, `ServiceId`, credential key, UI tab, i18n
  strings and manifest host permission are gone. Ratings now go to TMDB,
  Simkl and Kinopoisk's own profile; CSV export covers Letterboxd, IMDb and
  MovieLens.

### Fixed

- **Ratings could be written to the wrong title.** `findBestMatch` had no
  acceptance floor and searched `/search/multi`, which silently ignores the
  year filters, so a candidate whose year contradicted the item — or one of a
  different media type — was accepted and written to a real account. Matching
  now searches the type-specific endpoint, requires an exact title (or a
  partial title corroborated by an exact year), and refuses an IMDb id whose
  media type disagrees with the scraped item.
- **Scraped ratings could be invented.** The "first number in the card"
  fallback read the row index (1..25) on the votes page. Removed; only a node
  that declares itself the user's rating is trusted.
- **The original title was never scraped.** `originalTitle` was declared and
  assigned but always `undefined`, disabling the strongest matching signal.
  It is now read from the card when it is Latin script.
- **An empty page silently erased the saved scan.** A zero-item first page is
  now reported as a failure rather than treated as the end of pagination.
- **Watchlist writes reported success without writing.** The check accepted
  any button containing "Смотрите", which matches the Yandex Plus streaming
  promo present on nearly every film page.
- **`10 → 1` was reported as verified.** Rating verification used a substring
  test, and `'10'.includes('1')` is true before the DOM updates. It now
  requires an exactly equal parsed value.
- **`RESUME_MIGRATION` never cleared `paused_captcha`.** The UI rendered the
  paused branch — Start and Stop hidden, Scan disabled — with no way back.
  Pausing an idle extension also latched that state; it no longer does.
- **A double click started two runs.** `isSyncRunning`/`isScanRunning` were
  assigned but never read, so concurrent runs raced over one set of counters.
- **A worker restart could strand the status.** An MV3 service worker killed
  mid-run left a non-terminal status persisted forever; startup now recovers
  it to `idle`.
- **Simkl `resolve` produced a garbage reference.** The text-search fallback
  read `ids.simkl`/`type`, but `/search/{type}` returns `ids.simkl_id`/
  `endpoint_type`, yielding `id: "undefined"` and reporting films as `tv`.
- **Simkl polling misread its own contract.** `pollForToken` treated HTTP 400
  as "pending", but the live endpoint answers HTTP 200 with
  `{"result":"KO"}`.
- **Simkl authorization was unreachable.** `requestPin`/`pollForToken` had no
  caller anywhere in the codebase. The PIN flow is now wired end-to-end.

### Added

- **Simkl PIN authorization** (`SIMKL_START_AUTH` / `SIMKL_COMPLETE_AUTH`),
  with a bounded, resumable wait so the message channel cannot hang.
- **Extension icons** (16/32/48/128) and their manifest entries.
- **`npm run package`** — an allowlist-based packager that ships only the
  files the manifest loads, with an integrity check on the result.
- **TMDB match-gate, Simkl search-shape and dedupe-alias tests** (11 total).

### Changed

- `--text-muted` failed WCAG AA (3.7–4.1:1) in 12 places; corrected at the
  token so every caption passes.
- `aria-label` on icon-only controls, 24 px minimum target for the language
  switch, named transition properties instead of `transition: all`.
- Hardcoded Russian strings in the live render moved into the i18n dictionary.
- Versions aligned across `manifest.json` and `package.json`.
- README rewritten for the current service set and setup steps.

## [3.0.0] — 2026-09-14

### Added

- Multi-service sync matrix: TMDB, Trakt, Simkl, plus CSV export for
  Letterboxd, IMDb and MovieLens.
- Kinopoisk as a write target via browser automation.
- Kinopoisk Unofficial API enrichment (IMDb id, original title).
- Per-service credentials, live ping badges, and an enable toggle per target.
- UTF-8 BOM CSV output with a 1 MB split for Letterboxd.

## [2.0.0] — 2026-09-10

### Added

- Manifest V3 browser extension alongside the Python CLI/TUI.
- Kinopoisk scraping from the active browser session.
- TMDB rating and watchlist migration with duplicate skip.
- RU/EN interface.

## [1.0.0] — 2026-09-05

### Added

- Initial Kinopoisk to TMDB migration: export, id mapping with checkpoints,
  and upload, driven from a CLI/TUI.
