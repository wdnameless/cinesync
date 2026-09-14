# Technical Design: MV3 Kinopoisk to TMDB Migrator

## Architecture
```
┌─────────────────────────────────────────────────────────────┐
│                       CHROME BROWSER                        │
│                                                             │
│  ┌────────────────┐     runtime msg   ┌──────────────────┐  │
│  │   popup.html   │ ────────────────> │  background.ts   │  │
│  │  (popup.ts)    │ <──────────────── │ (Service Worker) │  │
│  └────────┬───────┘   storage changes └────────┬─────────┘  │
│           │                                    │            │
│           ▼                                    ▼            │
│  ┌────────────────┐                   ┌──────────────────┐  │
│  │ chrome.storage │ ◄─────────────────┤ State & Queue    │  │
│  │    .local      │                   │ Controller       │  │
│  └────────────────┘                   └────────┬─────────┘  │
│                                                │            │
│               chrome.scripting                 │            │
│                      │                         ▼            │
│                      ▼                ┌──────────────────┐  │
│               ┌──────────────┐        │ TMDB API Client  │  │
│               │ Kinopoisk    │        │ - Session Auth   │  │
│               │ Tab Parser   │        │ - Rate Limiter   │  │
│               └──────────────┘        │ - Matcher Engine │  │
│                                       └────────┬─────────┘  │
└────────────────────────────────────────────────┼────────────┘
                                                 ▼
                                        ┌──────────────────┐
                                        │  TMDB REST API   │
                                        └──────────────────┘
```

## State Management (`chrome.storage.local`)
Key `kp_tmdb_migration`:
```ts
interface MigrationState {
  status: 'idle' | 'detecting' | 'scraping' | 'paused_captcha' | 'migrating' | 'completed' | 'error';
  userId?: string;
  category: 'ratings' | 'watchlist' | 'both';
  totalItems: number;
  scrapedCount: number;
  syncedCount: number;
  failedCount: number;
  logs: Array<{ timestamp: number; message: string; type: 'info' | 'warn' | 'error' | 'success' }>;
  error?: string;
}
```

## Auth State
Key `kp_tmdb_auth`:
```ts
interface AuthState {
  apiKey: string;
  sessionId?: string;
  accountId?: string;
}
```

## Scraping Engine
1. Execute content script in active Kinopoisk tab.
2. Probe `document.querySelector('a[href*="/user/"]')` or parse page URL to extract User ID.
3. Pagination loop: navigate or fetch pages `movies/voted-watched/perpage/100/page/${page}/`.
4. Check for presence of captcha element (`div[class*="captcha"]` or URL containing `showcaptcha`). If detected, transition status to `paused_captcha`, ping user, await manual resolution.
5. Parse items:
   - Extract title, original title, release year, user rating, vote date.
   - Extract internal Kinopoisk ID from item href (`/film/(\d+)/` or `/series/(\d+)/`).

## TMDB Client & Matcher
1. `RateLimiter`: Sliding window token bucket ensuring $\le 4$ req/sec.
2. `searchMedia(title, originalTitle, year)`:
   - Query `/search/multi` (or `/search/movie` and `/search/tv`).
   - Match scoring:
     * High priority: match by `original_title` / `original_name` + exact `release_date` year ($\pm 1$).
     * Fallback: match by Russian localized title.
3. Push Actions:
   - Ratings: `POST /3/{media_type}/{id}/rating?session_id=...` with `{ value: kp_rating }`.
   - Watchlist: `POST /3/account/{account_id}/watchlist?session_id=...` with `{ media_type, media_id, watchlist: true }`.
