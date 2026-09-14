# Specification: MV3 Kinopoisk to TMDB Migrator

## Module: Core Extension & Manifest
### Requirement: Valid MV3 Configuration and Build Output
- `manifest.json` MUST point to `dist/background.js` as the `service_worker`.
- `manifest.json` MUST declare necessary permissions: `storage`, `scripting`, `activeTab`, `cookies`, `tabs`.
- `manifest.json` MUST declare host permissions: `*://*.kinopoisk.ru/*`, `*://*.themoviedb.org/*`.
- `vite.config.ts` MUST bundle TypeScript sources from `src/` to `dist/` without nesting into `dist/dist/`.

## Module: Scraping Engine (`scraper.ts`)
### Requirement: Resilient Kinopoisk Scraping
- MUST automatically detect logged-in User ID from active Kinopoisk tab URL or DOM attributes.
- MUST parse items using structural selectors (inspecting `a[href*="/film/"]`, `a[href*="/series/"]`, dates, ratings).
- MUST parse Russian title, Original title (if present), Year (int), and User rating (1-10).
- MUST detect captcha redirect or presence of captcha DOM container and trigger a safe pause.

## Module: TMDB Client (`tmdb.ts`)
### Requirement: API Authentication & Rate-Limiting
- MUST support setting and saving TMDB API key.
- MUST implement User Authentication flow:
  1. `createRequestToken()`: `GET /3/authentication/token/new`
  2. Open approval URL: `https://www.themoviedb.org/authenticate/{token}`
  3. `createSession(token)`: `POST /3/authentication/session/new`
  4. Fetch Account ID: `GET /3/account?session_id=...`
- MUST throttle outgoing API calls to $\le 4$ requests per second.
- MUST handle HTTP 429 and retry with exponential backoff.

### Requirement: Search, Rating & Watchlist
- MUST search for movies and TV shows via `/3/search/multi`.
- MUST select the most relevant match by comparing original title, localized title, and year.
- MUST post rating to `/3/movie/{id}/rating` or `/3/tv/{id}/rating` with `session_id`.
- MUST add items to watchlist via `/3/account/{account_id}/watchlist` with `session_id`.

## Module: Background Service Worker (`background.ts`)
### Requirement: Long-Running Task Orchestration
- MUST maintain migration state in `chrome.storage.local`.
- MUST survive popup closure and continue running until task completion or pause.
- MUST support messages:
  - `START_MIGRATION` (category, delay)
  - `PAUSE_MIGRATION`
  - `RESUME_MIGRATION`
  - `GET_STATE`
  - `TMDB_START_AUTH`
  - `TMDB_COMPLETE_AUTH`

## Module: Popup UI (`popup.html`, `popup.ts`)
### Requirement: User Control and Real-Time Feedback
- MUST display TMDB connection status (connected with user details or disconnected).
- MUST allow input and storage of TMDB API Key.
- MUST provide buttons for:
  - Connect TMDB (OAuth)
  - Start Migration (Ratings / Watchlist / Both)
  - Pause / Resume
- MUST display live progress bars: Scraped items, Synced to TMDB, Failed/Skipped items.
- MUST display live log stream from `chrome.storage.local`.
