import {
  MediaServicePort,
  ServiceCapabilities,
  ServiceId,
  ServiceRef,
  CsvBundle,
  MovieItem,
} from './port';
import { ServiceCredentials } from './credentials';
import { jsonRequest } from './http';

const TRAKT_API_BASE = 'https://api.trakt.tv';
const TRAKT_AUTH_BASE = 'https://auth.trakt.tv';
const MAX_PAGES = 50;
const PAGE_LIMIT = 100;
const MIN_WRITE_INTERVAL_MS = 1000; // Trakt write rate limit: max 1 req/s

export class AuthExpiredError extends Error {
  readonly code = 'AUTH_EXPIRED' as const;
  readonly service: ServiceId = 'trakt';

  constructor(message = 'Trakt authentication expired or invalid') {
    super(message);
    this.name = 'AuthExpiredError';
    Object.setPrototypeOf(this, AuthExpiredError.prototype);
  }
}

export interface TraktDeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_url: string;
  expires_in: number;
  interval: number;
}

export interface TraktTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  created_at?: number;
}

interface TraktIdLookupResult {
  type: 'movie' | 'show';
  score?: number;
  movie?: {
    title: string;
    year?: number;
    ids: {
      trakt: number;
      slug?: string;
      imdb?: string;
      tmdb?: number;
    };
  };
  show?: {
    title: string;
    year?: number;
    ids: {
      trakt: number;
      slug?: string;
      imdb?: string;
      tmdb?: number;
    };
  };
}

interface TraktSyncRatingItem {
  rating: number;
  rated_at?: string;
  type?: 'movie' | 'show';
  movie?: {
    title: string;
    year?: number;
    ids: {
      trakt: number;
      imdb?: string;
      tmdb?: number;
    };
  };
  show?: {
    title: string;
    year?: number;
    ids: {
      trakt: number;
      imdb?: string;
      tmdb?: number;
    };
  };
}

interface TraktSyncWatchlistItem {
  listed_at?: string;
  type?: 'movie' | 'show';
  movie?: {
    title: string;
    year?: number;
    ids: {
      trakt: number;
      imdb?: string;
      tmdb?: number;
    };
  };
  show?: {
    title: string;
    year?: number;
    ids: {
      trakt: number;
      imdb?: string;
      tmdb?: number;
    };
  };
}

export type TraktLogCallback = (message: string) => void;

function isHttpAuthExpired(err: unknown): boolean {
  if (!err) return false;
  if (typeof err === 'object') {
    const record = err as Record<string, unknown>;
    if (record.code === 'AUTH_EXPIRED') return true;
    if (record.status === 401 || record.status === 403) return true;
  }
  if (err instanceof Error) {
    if (err.message.includes('[401]') || err.message.includes('[403]')) {
      return true;
    }
  }
  return false;
}

export class TraktPort implements MediaServicePort {
  readonly id: ServiceId = 'trakt';
  readonly label = 'Trakt';
  readonly capabilities: ServiceCapabilities = {
    canRate: true,
    canWatchlist: true,
    requiresAuth: true,
    writeMode: 'api',
  };

  private clientId: string;
  private clientSecret?: string;
  private accessToken?: string;
  private onLog?: TraktLogCallback;
  private lastWriteTime = 0;

  constructor(
    creds: { clientId: string; clientSecret?: string; accessToken?: string },
    options?: { onLog?: TraktLogCallback }
  ) {
    this.clientId = creds.clientId;
    this.clientSecret = creds.clientSecret;
    this.accessToken = creds.accessToken;
    this.onLog = options?.onLog;
  }

  setAccessToken(token: string): void {
    this.accessToken = token;
  }

  setClientSecret(secret: string): void {
    this.clientSecret = secret;
  }

  private authHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'trakt-api-version': '2',
      'trakt-api-key': this.clientId,
    };
    if (this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }
    return headers;
  }

  private async enforceWriteRateLimit(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastWriteTime;
    if (elapsed < MIN_WRITE_INTERVAL_MS) {
      const waitTime = MIN_WRITE_INTERVAL_MS - elapsed;
      await new Promise<void>((resolve) => setTimeout(resolve, waitTime));
    }
    this.lastWriteTime = Date.now();
  }

  async requestDeviceCode(): Promise<TraktDeviceCodeResponse> {
    return jsonRequest<TraktDeviceCodeResponse>(
      `${TRAKT_AUTH_BASE}/oauth/device/code`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: this.clientId }),
      }
    );
  }

  async pollForToken(
    deviceCode: string,
    intervalSeconds = 5,
    expiresInSeconds = 600
  ): Promise<TraktTokenResponse> {
    if (!this.clientSecret) {
      throw new Error(
        'Trakt client_secret is required for device token polling.'
      );
    }

    const startTime = Date.now();
    const intervalMs = Math.max(intervalSeconds, 1) * 1000;
    const expiryMs = expiresInSeconds * 1000;

    while (Date.now() - startTime < expiryMs) {
      await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));

      try {
        const tokenData = await jsonRequest<TraktTokenResponse>(
          `${TRAKT_AUTH_BASE}/oauth/device/token`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              code: deviceCode,
              client_id: this.clientId,
              client_secret: this.clientSecret,
            }),
          }
        );

        if (tokenData && tokenData.access_token) {
          this.accessToken = tokenData.access_token;
          return tokenData;
        }
      } catch (err: unknown) {
        if (typeof err === 'object' && err !== null) {
          const record = err as Record<string, unknown>;
          // Status 400 means pending authorization; 404/409/410/418/429 other pending or specific codes
          if (record.status === 400) {
            // Still waiting for user authorization
            continue;
          }
          if (record.status === 404 || record.status === 410) {
            throw new Error('Trakt device code expired or not found');
          }
          if (record.status === 409) {
            throw new Error('Trakt device code already approved');
          }
          if (record.status === 418) {
            throw new Error('Trakt device code denied by user');
          }
        }
        throw err;
      }
    }

    throw new Error('Trakt device code polling timed out');
  }

  async ping(): Promise<boolean> {
    if (!this.accessToken) {
      return false;
    }
    try {
      await jsonRequest<unknown>(
        `${TRAKT_API_BASE}/users/settings`,
        {
          headers: this.authHeaders(),
        }
      );
      return true;
    } catch (err: unknown) {
      if (isHttpAuthExpired(err)) {
        return false;
      }
      return false;
    }
  }

  async resolve(item: MovieItem): Promise<ServiceRef | null> {
    const headers = this.authHeaders();

    // 1. Try resolving by IMDb ID
    if (item.imdbId) {
      try {
        const imdbResults = await jsonRequest<TraktIdLookupResult[]>(
          `${TRAKT_API_BASE}/search/imdb/${encodeURIComponent(item.imdbId)}`,
          { headers }
        );
        const match = this.selectFirstLookupMatch(imdbResults);
        if (match) {
          return match;
        }
      } catch (err: unknown) {
        if (isHttpAuthExpired(err)) {
          throw new AuthExpiredError();
        }
      }
    }

    // 2. Try resolving by TMDB ID
    if (item.tmdbId) {
      try {
        const tmdbResults = await jsonRequest<TraktIdLookupResult[]>(
          `${TRAKT_API_BASE}/search/tmdb/${item.tmdbId}`,
          { headers }
        );
        const match = this.selectFirstLookupMatch(tmdbResults);
        if (match) {
          return match;
        }
      } catch (err: unknown) {
        if (isHttpAuthExpired(err)) {
          throw new AuthExpiredError();
        }
      }
    }

    // 3. Fall back to text search GET /search/movie,show?query=
    const query = item.originalTitle || item.title;
    if (!query) {
      return null;
    }

    try {
      const url = `${TRAKT_API_BASE}/search/movie,show?query=${encodeURIComponent(query)}${
        item.year ? `&years=${item.year}` : ''
      }`;
      const searchResults = await jsonRequest<TraktIdLookupResult[]>(url, {
        headers,
      });
      return this.selectBestTextMatch(searchResults, item);
    } catch (err: unknown) {
      if (isHttpAuthExpired(err)) {
        throw new AuthExpiredError();
      }
      throw err;
    }
  }

  private selectFirstLookupMatch(results: TraktIdLookupResult[]): ServiceRef | null {
    if (!results || results.length === 0) return null;
    const first = results[0];
    if (first.movie) {
      return {
        service: 'trakt',
        id: String(first.movie.ids.trakt),
        mediaType: 'movie',
        label: first.movie.title,
      };
    }
    if (first.show) {
      return {
        service: 'trakt',
        id: String(first.show.ids.trakt),
        mediaType: 'tv',
        label: first.show.title,
      };
    }
    return null;
  }

  private selectBestTextMatch(
    results: TraktIdLookupResult[],
    item: MovieItem
  ): ServiceRef | null {
    if (!results || results.length === 0) return null;

    const targetType =
      item.type === 'series' || item.type === 'tv' ? 'tv' : 'movie';

    // Prioritize match with matching type and year
    for (const res of results) {
      const media = res.movie || res.show;
      const mediaType: 'movie' | 'tv' = res.movie ? 'movie' : 'tv';
      if (!media) continue;

      if (
        item.year &&
        media.year &&
        Math.abs(media.year - item.year) <= 1 &&
        mediaType === targetType
      ) {
        return {
          service: 'trakt',
          id: String(media.ids.trakt),
          mediaType,
          label: media.title,
        };
      }
    }

    // Next preference: match with same type
    for (const res of results) {
      const media = res.movie || res.show;
      const mediaType: 'movie' | 'tv' = res.movie ? 'movie' : 'tv';
      if (!media) continue;

      if (mediaType === targetType) {
        return {
          service: 'trakt',
          id: String(media.ids.trakt),
          mediaType,
          label: media.title,
        };
      }
    }

    // Default to first result
    return this.selectFirstLookupMatch(results);
  }

  async pushRating(ref: ServiceRef, rating: number): Promise<void> {
    await this.enforceWriteRateLimit();

    const traktId = Number(ref.id);
    const itemPayload = {
      rating,
      ids: {
        trakt: Number.isNaN(traktId) ? undefined : traktId,
      },
    };

    const body =
      ref.mediaType === 'tv'
        ? { shows: [itemPayload] }
        : { movies: [itemPayload] };

    try {
      await jsonRequest<unknown>(`${TRAKT_API_BASE}/sync/ratings`, {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify(body),
      });
    } catch (err: unknown) {
      if (isHttpAuthExpired(err)) {
        throw new AuthExpiredError();
      }
      throw err;
    }
  }

  async pushWatchlist(ref: ServiceRef): Promise<void> {
    await this.enforceWriteRateLimit();

    const traktId = Number(ref.id);
    const itemPayload = {
      ids: {
        trakt: Number.isNaN(traktId) ? undefined : traktId,
      },
    };

    const body =
      ref.mediaType === 'tv'
        ? { shows: [itemPayload] }
        : { movies: [itemPayload] };

    try {
      await jsonRequest<unknown>(`${TRAKT_API_BASE}/sync/watchlist`, {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify(body),
      });
    } catch (err: unknown) {
      if (isHttpAuthExpired(err)) {
        throw new AuthExpiredError();
      }
      throw err;
    }
  }

  async fetchExistingRatings(): Promise<Map<string, number>> {
    const ratingsMap = new Map<string, number>();

    await this.fetchPagedSyncItems<TraktSyncRatingItem>(
      'ratings',
      'movies',
      (item) => {
        if (item.movie && typeof item.rating === 'number') {
          ratingsMap.set(`movie:${item.movie.ids.trakt}`, item.rating);
          if (item.movie.ids.imdb) {
            ratingsMap.set(`imdb:${item.movie.ids.imdb}`, item.rating);
          }
          if (item.movie.ids.tmdb) {
            ratingsMap.set(`tmdb:${item.movie.ids.tmdb}`, item.rating);
          }
        }
      }
    );

    await this.fetchPagedSyncItems<TraktSyncRatingItem>(
      'ratings',
      'shows',
      (item) => {
        if (item.show && typeof item.rating === 'number') {
          ratingsMap.set(`show:${item.show.ids.trakt}`, item.rating);
          if (item.show.ids.imdb) {
            ratingsMap.set(`imdb:${item.show.ids.imdb}`, item.rating);
          }
          if (item.show.ids.tmdb) {
            ratingsMap.set(`tmdb:${item.show.ids.tmdb}`, item.rating);
          }
        }
      }
    );

    return ratingsMap;
  }

  async fetchExistingWatchlist(): Promise<Set<string>> {
    const watchlistSet = new Set<string>();

    await this.fetchPagedSyncItems<TraktSyncWatchlistItem>(
      'watchlist',
      'movies',
      (item) => {
        if (item.movie) {
          watchlistSet.add(`movie:${item.movie.ids.trakt}`);
          if (item.movie.ids.imdb) {
            watchlistSet.add(`imdb:${item.movie.ids.imdb}`);
          }
          if (item.movie.ids.tmdb) {
            watchlistSet.add(`tmdb:${item.movie.ids.tmdb}`);
          }
        }
      }
    );

    await this.fetchPagedSyncItems<TraktSyncWatchlistItem>(
      'watchlist',
      'shows',
      (item) => {
        if (item.show) {
          watchlistSet.add(`show:${item.show.ids.trakt}`);
          if (item.show.ids.imdb) {
            watchlistSet.add(`imdb:${item.show.ids.imdb}`);
          }
          if (item.show.ids.tmdb) {
            watchlistSet.add(`tmdb:${item.show.ids.tmdb}`);
          }
        }
      }
    );

    return watchlistSet;
  }

  private async fetchPagedSyncItems<T>(
    endpoint: 'ratings' | 'watchlist',
    type: 'movies' | 'shows',
    processItem: (item: T) => void
  ): Promise<void> {
    const headers = this.authHeaders();

    for (let page = 1; page <= MAX_PAGES; page++) {
      try {
        const url = `${TRAKT_API_BASE}/sync/${endpoint}/${type}?page=${page}&limit=${PAGE_LIMIT}`;
        const items = await jsonRequest<T[]>(url, { headers });

        if (!items || !Array.isArray(items) || items.length === 0) {
          break;
        }

        for (const item of items) {
          processItem(item);
        }

        if (items.length < PAGE_LIMIT) {
          break;
        }

        if (page === MAX_PAGES) {
          const warnMsg = `Trakt ${endpoint}/${type} reached maximum pagination limit (${MAX_PAGES} pages). Some items may not have been preloaded.`;
          if (this.onLog) {
            this.onLog(warnMsg);
          }
        }
      } catch (err: unknown) {
        if (isHttpAuthExpired(err)) {
          throw new AuthExpiredError();
        }
        throw err;
      }
    }
  }

  exportCsv(_items: MovieItem[]): CsvBundle[] {
    throw new Error('Trakt does not support CSV export');
  }
}

export function createTraktPort(
  creds: ServiceCredentials,
  options?: { onLog?: TraktLogCallback }
): MediaServicePort {
  if (!creds.clientId) {
    throw new Error('Trakt clientId is required to initialize Trakt port');
  }
  return new TraktPort(
    {
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
      accessToken: creds.accessToken,
    },
    options
  );
}
