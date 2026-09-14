# Proposal: Modernize MV3 Extension for Kinopoisk to TMDB Migration

## Problem
The current Chrome Extension (`ext/`) is broken and unusable:
1. Long-running scraping runs directly inside ephemeral `popup.ts` and dies when the popup closes.
2. Build paths between `manifest.json` and `vite.config.ts` are mismatched (`dist/dist/` vs `dist/`).
3. Kinopoisk user ID (`13730019`) and page totals are hardcoded in source code.
4. Scraping selectors rely on volatile CSS modules classes (`styles_root...`).
5. TMDB rating requests omit `session_id`, causing HTTP 401 on rating and watchlist actions.
6. Rate limiting is absent, causing HTTP 429 errors.
7. Captcha redirects immediately abort export without pausing for human resolution.

## Solution
1. **Runner Migration to Background Service Worker**:
   - Move export, queueing, and TMDB synchronizer into `background.ts`.
   - `popup.ts` becomes a light UI that communicates via `chrome.runtime.sendMessage` and reacts to `chrome.storage.local`.
   - Migration state persists across popup opens/closes.
2. **Build System Overhaul**:
   - Align `ext/vite.config.ts` and `ext/manifest.json` so build outputs to `dist/` cleanly (`background.js`, `popup.html`, `popup.js`).
3. **Smart Kinopoisk Scraping**:
   - Auto-detect current logged-in Kinopoisk User ID from active tab or cookies.
   - Robust selectors inspecting link targets `/film/\d+/` and structured elements instead of hashed CSS class names.
   - SmartCaptcha pause-and-resume detection.
4. **TMDB Integration & Auth**:
   - Full OAuth / Session ID creation workflow (`authentication/token/new` -> authenticate -> `session/new`).
   - Token bucket / rate-limiter for TMDB calls (max 4 requests per second).
   - Movie & TV search matching with original title fallback and release year validation.
   - Rating (`POST /movie/{id}/rating`, `POST /tv/{id}/rating`) and Watchlist (`POST /account/{account_id}/watchlist`) support with `session_id`.
