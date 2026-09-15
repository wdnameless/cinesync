# Releasing CineSync

Two independent channels ship CineSync, and they use different mechanics.
Neither one reads the other.

| Channel | What users get | How it updates |
|---|---|---|
| **GitHub Releases** | `cinesync-<version>.zip` + unpacked build | Users re-download manually |
| **Chrome Web Store** (`webstore`) | Same ZIP, uploaded to the store | Chrome auto-updates installed copies |

GitHub is the source of truth for code and history. The Web Store is the
delivery channel for end users. A tag does not publish to the store, and a store
upload does not create a GitHub release.

## Cutting a release

1. **Bump the version** in `ext/manifest.json` and `ext/package.json` — they
   must match; the workflow fails the build if the tag disagrees with the
   manifest.

   Note: Chrome considers a build updated only when this version increases.
   See "Why the version bump matters" below.

2. **Update `CHANGELOG.md`.** Its path is used verbatim as the release body, so
   the top version section becomes the release notes.

3. **Verify locally.**
   ```bash
   cd ext
   npm ci
   npm run typecheck
   npm test
   npm run package     # writes ../cinesync-<version>.zip
   ```

4. **Commit and tag.**
   ```bash
   git add -A
   git commit -m "release(ext): v<version> — <summary>"
   git tag v<version>
   git push origin main --tags
   ```

5. The `Release` workflow builds, tests, packs, checks the tag against the
   manifest, and attaches `cinesync-<version>.zip` plus an unpacked build
   to the GitHub Release.

6. **Upload to the Chrome Web Store** (manual — see below).

## Publishing to the Chrome Web Store

The store needs a developer account and an upload. Neither is stored in this
repo, and the workflow deliberately does not attempt it.

### One-time setup

1. Register a **Chrome Web Store developer account** (one-time USD 5 fee) and
   note the **publisher ID**.
2. For API-driven uploads, create a Google Cloud project, enable the
   **Chrome Web Store API**, and create an OAuth client (`Desktop app`).
   Keep the client ID and secret; the refresh token is issued once at consent.
3. Upload the first version through the
   [developer dashboard](https://chrome.google.com/webstore/devconsole) so the
   listing exists.

### Uploading a new version

Dashboard, which is the simplest path:

1. Open the item in the developer dashboard → **Package** → **Upload new
   package**.
2. Select `cinesync-<version>.zip` produced by `npm run package`.
3. Fill in the **What's new** field, click **Submit for review**.

Store review typically takes hours to a few days. Until it passes, the previous
version stays live for existing users.

For scripted uploads, `chrome-webstore-upload-cli` wraps the API:

```bash
npx chrome-webstore-upload-cli upload \
  --source cinesync-3.1.0.zip \
  --extension-id <item-id> \
  --client-id <oauth-client-id> \
  --client-secret <oauth-client-secret> \
  --refresh-token <refresh-token>
```

To publish programmatically, swap `upload` for `publish`. Automating this in CI
means storing those four secrets in the repository's Actions secrets — do that
only if the token is scoped narrowly, since it can publish to your store
listing.

## Listing assets the store requires

Beyond the ZIP, the dashboard needs these once:

- **Icons** — already in `ext/icons/` (16/32/48/128).
- **Screenshots** — at least one at 1280×800 or 640×400.
- **Description** — short and detailed.
- **Category** and **language**.
- **Privacy practices** — the *Single purpose*, *Justification for each
  permission*, and *Data usage* forms. See `docs/PRIVACY.md` for text that
  matches what CineSync actually does; the permission justifications in
  particular are checked against the manifest, and a mismatch is a common
  rejection reason.

## Why the version bump matters

This trips people up locally as well as in the store, so it is worth being
explicit.

Chrome identifies an extension by its manifest `version`. On startup it reads
the manifest, and if the version is **unchanged** it reuses the cached compiled
code from the profile's `Service Worker` directory instead of re-reading the
files on disk.

In practice, during development, copying new files over an unpacked extension
without bumping the version leaves the *old* service worker running. The popup
reloads and looks new, so the build appears deployed while the background logic
is stale. Pressing **Reload** on `chrome://extensions` clears it; so does
bumping the version, or deleting `Default/Service Worker`, `Default/Extension
Scripts` and `Default/Code Cache` from the profile while the browser is closed.

For real users this is a feature — it is exactly what makes silent background
updates possible — and it is why every store release must carry a higher
version, including patch-only changes.

## How users receive updates

Users who installed from the Web Store do **not** need to do anything. Chrome
polls the store (roughly every few hours, and on browser start), downloads a
newer version, and applies it. The extension's storage and credentials survive
because an update reuses the same extension ID and profile data.

The extension ID is derived from the signing key, not from the code. Uploading a
new ZIP keeps the same ID, so `chrome.storage.local` — API keys, session ids,
the saved scan — is preserved across updates. This is also the reason a release
must never be distributed as a *different* extension (a new ID would start with
empty storage and orphan the user's existing data).

### What that means for this project

- **Storage changes must be backward compatible.** On update, the new code
  reads state written by the old one. Adding a key is safe; renaming or removing
  one silently loses it unless the new code migrates or tolerates the old shape.
- **The popup is not cached across updates**, but the service worker is keyed to
  the version — another reason the version must move on every release.
- **A published version cannot be replaced.** The store rejects a re-upload of
  the same version. Fixing a bad release means publishing a higher version.

## Status of this project as of v3.1.0

- **GitHub Release: published.** `v3.1.0` carries `cinesync-3.1.0.zip`
  plus an unpacked build. The `Release` workflow is tag-triggered and green.
- **Chrome Web Store: not published.** No developer account or API credentials
  are configured for this repository, which is a prerequisite rather than an
  oversight. Until it is listed, users install by loading the unpacked build;
  that path has no automatic updates (see below).

### Installing without the store

Unpacked installs are the supported path meanwhile. Note the consequence: an
unpacked extension does **not** update itself. Chrome has no update URL for it,
so the user must replace the files and press **Reload** on
`chrome://extensions` for each new version — and because of the service-worker
cache described above, that reload is required even when the files on disk have
already changed.
