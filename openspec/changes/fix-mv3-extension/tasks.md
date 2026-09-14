# Tasks: Fix MV3 Extension for Kinopoisk to TMDB

- [ ] Clean up redundant root build artifacts in `ext/` and fix `manifest.json` and `vite.config.ts`. <!-- id: 1 -->
- [ ] Define shared TypeScript interfaces in `ext/src/types.ts`. <!-- id: 2 -->
- [ ] Implement robust Kinopoisk scraper in `ext/src/scraper.ts` with User ID auto-detection, resilient selectors, and captcha sensing. <!-- id: 3 -->
- [ ] Implement TMDB client in `ext/src/tmdb.ts` with rate-limiter, session authentication flow, search matcher, rating, and watchlist. <!-- id: 4 -->
- [ ] Implement persistent Background Service Worker in `ext/src/background.ts` with state storage, queue runner, and messaging handlers. <!-- id: 5 -->
- [ ] Update `ext/popup.html` and `ext/src/popup.ts` to provide reactive UI, TMDB auth button, progress indicators, and logs. <!-- id: 6 -->
- [ ] Build and verify extension with `npm run build` in `ext/`. <!-- id: 7 -->
