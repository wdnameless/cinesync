# Privacy practices

Privacy answers for CineSync, written to match what the extension actually does, for the Chrome Web
Store's *Privacy practices* tab. The permission justifications are checked
against the manifest, so keep them in sync when permissions change.

## Single purpose

Migrate a user's own Kinopoisk ratings and watchlist to other movie-tracking
services (TMDB, Simkl, their own Kinopoisk profile) and export them as CSV for
import into Letterboxd, IMDb and MovieLens.

## Data handling summary

- **Nothing is sent to the developer.** There is no backend, no analytics, no
  telemetry, and no account system. The extension has no server of its own.
- **Credentials stay on the device.** API keys, session ids and tokens are kept
  in `chrome.storage.local` inside the user's own browser profile. They are
  never transmitted anywhere except to the service they belong to.
- **Collected data lives on the device.** Ratings, titles, years and Kinopoisk
  ids are stored locally to drive the migration and the CSV export.
- **No selling, no sharing, no ad use.** No data is transferred to third
  parties for any purpose other than the user-initiated request to the chosen
  service.
- **No remote code.** All logic ships in the package. Nothing is fetched and
  evaluated at runtime.

## Data the extension reads, and why

| Data | Source | Purpose |
|---|---|---|
| Ratings and watchlist | The user's Kinopoisk pages, in their own logged-in tab | The thing being migrated |
| Page DOM | Kinopoisk film pages | To set a rating or add a watchlist entry, and to verify it took effect |
| TMDB API key, session, account id | Entered by the user | Authorization for TMDB writes |
| Simkl client id and access token | Entered by, or issued to, the user | Authorization for Simkl writes |
| Kinopoisk Unofficial API key | Entered by the user | Resolving Kinopoisk ids to IMDb ids |
| CSV user ids (Letterboxd/IMDb/MovieLens) | Entered by the user | Formatting the exported CSV |

## Network destinations

The extension contacts only these hosts, all of which are declared in
`host_permissions`:

- `*.kinopoisk.ru` — reading the user's own pages and applying changes.
- `api.themoviedb.org` (via `*.themoviedb.org`) — TMDB reads and writes.
- `api.simkl.com` (via `*.simkl.com`) — Simkl reads and writes.
- `kinopoiskapiunofficial.tech` — optional id enrichment.

No other host is contacted, and no data goes anywhere else.

## Permission justifications

The dashboard asks for a reason per permission. These are the reasons the code
actually depends on:

- **`storage`** — persist API credentials and the scanned ratings/watchlist
  locally, so a migration can resume and credentials survive a browser restart.
- **`tabs`** — locate the user's already-open Kinopoisk tab, navigate it to each
  film page during a write, and open the TMDB / Simkl authorization pages.
- **`scripting`** — run the scraper and the rating/watchlist automation inside
  the Kinopoisk tab. Kinopoisk has no public write API, so this is the only way
  to apply a rating to the user's own profile.
- **`host_permissions`** — restrict the above to the four services listed under
  *Network destinations*. The extension does not request access to all sites.

`downloads` is not requested either: CSV export is delivered with a blob URL
and an anchor click, which needs no permission.

## Data retention and deletion

All data is local. The extension's **Reset** control clears the migration state,
and removing the extension from the browser deletes everything it stored. There
is nothing for the developer to delete on the user's behalf, because the
developer never receives it.

## Changes to this document

This file is versioned with the code. A release that changes what data is read
or where it is sent must update it in the same commit, and the store listing's
privacy answers must be revisited before that version is submitted.
