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

const SIMKL_API_BASE = 'https://api.simkl.com';
const MAX_PAGES = 50;
const PAGE_LIMIT = 100;

export class AuthExpiredError extends Error {
  readonly code = 'AUTH_EXPIRED' as const;
  readonly service: ServiceId = 'simkl';

  constructor(message = 'Simkl authentication expired or invalid') {
    super(message);
    this.name = 'AuthExpiredError';
    Object.setPrototypeOf(this, AuthExpiredError.prototype);
  }
}

export interface SimklPinResponse {
  user_code: string;
  verification_url: string;
  expires_in: number;
  interval: number;
}

export interface SimklTokenResponse {
  access_token: string;
  token_type?: string;
  scope?: string;
}

interface SimklSearchItem {
  title: string;
  year?: number;
  type?: 'movie' | 'tv' | 'anime';
  ids: {
    simkl: number;
    imdb?: string;
    tmdb?: string | number;
    slug?: string;
  };
}

interface SimklRatingEntry {
  rating: number;
  user_rating?: number;
  rated_at?: string;
  movie?: {
    title?: string;
    year?: number;
    ids: {
      simkl: number;
      imdb?: string;
      tmdb?: string | number;
    };
  };
  show?: {
    title?: string;
    year?: number;
    ids: {
      simkl: number;
      imdb?: string;
      tmdb?: string | number;
    };
  };
  anime?: {
    title?: string;
    year?: number;
    ids: {
      simkl: number;
      imdb?: string;
      tmdb?: string | number;
    };
  };
}

interface SimklPlantowatchEntry {
  movie?: {
    title?: string;
    year?: number;
    ids: {
      simkl: number;
      imdb?: string;
      tmdb?: string | number;
    };
  };
  show?: {
    title?: string;
    year?: number;
    ids: {
      simkl: number;
      imdb?: string;
      tmdb?: string | number;
    };
  };
  anime?: {
    title?: string;
    year?: number;
    ids: {
      simkl: number;
      imdb?: string;
      tmdb?: string | number;
    };
  };
}

interface SimklAllItemsPlantowatchResponse {
  movies?: Array<{
    title?: string;
    ids: {
      simkl: number;
      imdb?: string;
      tmdb?: string | number;
    };
  }>;
  shows?: Array<{
    title?: string;
    ids: {
      simkl: number;
      imdb?: string;
      tmdb?: string | number;
    };
  }>;
  anime?: Array<{
    title?: string;
    ids: {
      simkl: number;
      imdb?: string;
      tmdb?: string | number;
    };
  }>;
}

export type SimklLogCallback = (message: string) => void;

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

export class SimklPort implements MediaServicePort {
  readonly id: ServiceId = 'simkl';
  readonly label = 'Simkl';
  readonly capabilities: ServiceCapabilities = {
    canRate: true,
    canWatchlist: true,
    requiresAuth: true,
    writeMode: 'api',
  };

  private clientId: string;
  private accessToken?: string;
  private onLog?: SimklLogCallback;

  constructor(
    creds: { clientId: string; accessToken?: string },
    options?: { onLog?: SimklLogCallback }
  ) {
    this.clientId = creds.clientId;
    this.accessToken = creds.accessToken;
    this.onLog = options?.onLog;
  }

  setAccessToken(token: string): void {
    this.accessToken = token;
  }

  private authHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'simkl-api-key': this.clientId,
    };
    if (this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }
    return headers;
  }

  async requestPin(): Promise<SimklPinResponse> {
    return jsonRequest<SimklPinResponse>(
      `${SIMKL_API_BASE}/oauth/pin?client_id=${encodeURIComponent(this.clientId)}`,
      {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  async pollForToken(
    userCode: string,
    intervalSeconds = 5,
    expiresInSeconds = 900
  ): Promise<SimklTokenResponse> {
    const startTime = Date.now();
    const intervalMs = Math.max(intervalSeconds, 1) * 1000;
    const expiryMs = expiresInSeconds * 1000;

    while (Date.now() - startTime < expiryMs) {
      await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));

      try {
        const tokenData = await jsonRequest<SimklTokenResponse>(
          `${SIMKL_API_BASE}/oauth/pin/${encodeURIComponent(userCode)}?client_id=${encodeURIComponent(
            this.clientId
          )}`,
          {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
          }
        );

        if (tokenData && tokenData.access_token) {
          this.accessToken = tokenData.access_token;
          return tokenData;
        }
      } catch (err: unknown) {
        if (typeof err === 'object' && err !== null) {
          const record = err as Record<string, unknown>;
          // HTTP 400 = pending
          if (record.status === 400) {
            continue;
          }
          // HTTP 404 or 410 = expired
          if (record.status === 404 || record.status === 410) {
            throw new Error('Simkl PIN expired');
          }
        }
        throw err;
      }
    }

    throw new Error('Simkl PIN polling timed out');
  }

  async ping(): Promise<boolean> {
    if (!this.accessToken) {
      return false;
    }
    try {
      await jsonRequest<unknown>(`${SIMKL_API_BASE}/users/settings`, {
        headers: this.authHeaders(),
      });
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

    // 1. Try resolving by IMDb ID: GET /search/id?imdb=<id>&client_id=
    if (item.imdbId) {
      try {
        const url = `${SIMKL_API_BASE}/search/id?imdb=${encodeURIComponent(
          item.imdbId
        )}&client_id=${encodeURIComponent(this.clientId)}`;
        const results = await jsonRequest<SimklSearchItem[] | SimklSearchItem>(
          url,
          { headers }
        );
        const match = this.normalizeSearchItem(results);
        if (match) {
          return match;
        }
      } catch (err: unknown) {
        if (isHttpAuthExpired(err)) {
          throw new AuthExpiredError();
        }
      }
    }

    // 2. Try resolving by TMDB ID: GET /search/id?tmdb=<id>&client_id=
    if (item.tmdbId) {
      try {
        const url = `${SIMKL_API_BASE}/search/id?tmdb=${encodeURIComponent(
          String(item.tmdbId)
        )}&client_id=${encodeURIComponent(this.clientId)}`;
        const results = await jsonRequest<SimklSearchItem[] | SimklSearchItem>(
          url,
          { headers }
        );
        const match = this.normalizeSearchItem(results);
        if (match) {
          return match;
        }
      } catch (err: unknown) {
        if (isHttpAuthExpired(err)) {
          throw new AuthExpiredError();
        }
      }
    }

    // 3. Fallback: text search GET /search/{type}?q=&client_id=
    const query = item.originalTitle || item.title;
    if (!query) {
      return null;
    }

    try {
      const typePath =
        item.type === 'series' || item.type === 'tv' ? 'tv' : 'movie';
      const url = `${SIMKL_API_BASE}/search/${typePath}?q=${encodeURIComponent(
        query
      )}&client_id=${encodeURIComponent(this.clientId)}${
        item.year ? `&year=${item.year}` : ''
      }`;
      const searchResults = await jsonRequest<SimklSearchItem[]>(url, {
        headers,
      });
      if (Array.isArray(searchResults) && searchResults.length > 0) {
        const first = searchResults[0];
        return {
          service: 'simkl',
          id: String(first.ids.simkl),
          mediaType: first.type === 'movie' ? 'movie' : 'tv',
          label: first.title,
        };
      }
    } catch (err: unknown) {
      if (isHttpAuthExpired(err)) {
        throw new AuthExpiredError();
      }
      throw err;
    }

    return null;
  }

  private normalizeSearchItem(
    result: SimklSearchItem[] | SimklSearchItem | null | undefined
  ): ServiceRef | null {
    if (!result) return null;
    const item = Array.isArray(result) ? result[0] : result;
    if (!item || !item.ids || !item.ids.simkl) return null;

    const mediaType: 'movie' | 'tv' = item.type === 'movie' ? 'movie' : 'tv';
    return {
      service: 'simkl',
      id: String(item.ids.simkl),
      mediaType,
      label: item.title,
    };
  }

  async pushRating(ref: ServiceRef, rating: number): Promise<void> {
    const simklId = Number(ref.id);
    const itemPayload = {
      rating,
      ids: {
        simkl: Number.isNaN(simklId) ? undefined : simklId,
      },
    };

    const body =
      ref.mediaType === 'tv'
        ? { shows: [itemPayload] }
        : { movies: [itemPayload] };

    try {
      await jsonRequest<unknown>(`${SIMKL_API_BASE}/sync/ratings`, {
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
    const simklId = Number(ref.id);
    const itemPayload = {
      to: 'plantowatch',
      ids: {
        simkl: Number.isNaN(simklId) ? undefined : simklId,
      },
    };

    const body =
      ref.mediaType === 'tv'
        ? { shows: [itemPayload] }
        : { movies: [itemPayload] };

    try {
      await jsonRequest<unknown>(`${SIMKL_API_BASE}/sync/add-to-list`, {
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

    await this.fetchPagedRatings('movies', (entry) => {
      const score = entry.user_rating ?? entry.rating;
      if (entry.movie && typeof score === 'number') {
        ratingsMap.set(`movie:${entry.movie.ids.simkl}`, score);
        if (entry.movie.ids.imdb) {
          ratingsMap.set(`imdb:${entry.movie.ids.imdb}`, score);
        }
        if (entry.movie.ids.tmdb) {
          ratingsMap.set(`tmdb:${entry.movie.ids.tmdb}`, score);
        }
      }
    });

    await this.fetchPagedRatings('shows', (entry) => {
      const score = entry.user_rating ?? entry.rating;
      if (entry.show && typeof score === 'number') {
        ratingsMap.set(`show:${entry.show.ids.simkl}`, score);
        if (entry.show.ids.imdb) {
          ratingsMap.set(`imdb:${entry.show.ids.imdb}`, score);
        }
        if (entry.show.ids.tmdb) {
          ratingsMap.set(`tmdb:${entry.show.ids.tmdb}`, score);
        }
      }
    });

    return ratingsMap;
  }

  async fetchExistingWatchlist(): Promise<Set<string>> {
    const watchlistSet = new Set<string>();

    // Simkl read plantowatch: GET /sync/all-items/{type}/plantowatch
    await this.fetchPlantowatch('movies', (entry) => {
      if (entry.movie) {
        watchlistSet.add(`movie:${entry.movie.ids.simkl}`);
        if (entry.movie.ids.imdb) {
          watchlistSet.add(`imdb:${entry.movie.ids.imdb}`);
        }
        if (entry.movie.ids.tmdb) {
          watchlistSet.add(`tmdb:${entry.movie.ids.tmdb}`);
        }
      }
    });

    await this.fetchPlantowatch('shows', (entry) => {
      if (entry.show) {
        watchlistSet.add(`show:${entry.show.ids.simkl}`);
        if (entry.show.ids.imdb) {
          watchlistSet.add(`imdb:${entry.show.ids.imdb}`);
        }
        if (entry.show.ids.tmdb) {
          watchlistSet.add(`tmdb:${entry.show.ids.tmdb}`);
        }
      }
    });

    return watchlistSet;
  }

  private async fetchPagedRatings(
    type: 'movies' | 'shows',
    processItem: (item: SimklRatingEntry) => void
  ): Promise<void> {
    const headers = this.authHeaders();

    for (let page = 1; page <= MAX_PAGES; page++) {
      try {
        const url = `${SIMKL_API_BASE}/sync/ratings/${type}?page=${page}&limit=${PAGE_LIMIT}`;
        const items = await jsonRequest<SimklRatingEntry[]>(url, { headers });

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
          const warnMsg = `Simkl ratings/${type} reached maximum pagination limit (${MAX_PAGES} pages). Some items may not have been preloaded.`;
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

  private async fetchPlantowatch(
    type: 'movies' | 'shows',
    processItem: (item: SimklPlantowatchEntry) => void
  ): Promise<void> {
    const headers = this.authHeaders();

    for (let page = 1; page <= MAX_PAGES; page++) {
      try {
        const url = `${SIMKL_API_BASE}/sync/all-items/${type}/plantowatch?page=${page}&limit=${PAGE_LIMIT}`;
        const response = await jsonRequest<
          SimklPlantowatchEntry[] | SimklAllItemsPlantowatchResponse
        >(url, { headers });

        if (!response) {
          break;
        }

        if (Array.isArray(response)) {
          if (response.length === 0) {
            break;
          }
          for (const item of response) {
            processItem(item);
          }
          if (response.length < PAGE_LIMIT) {
            break;
          }
        } else {
          // Object response with movies or shows array
          const list = type === 'movies' ? response.movies : response.shows;
          if (!list || list.length === 0) {
            break;
          }
          for (const raw of list) {
            if (type === 'movies') {
              processItem({ movie: raw });
            } else {
              processItem({ show: raw });
            }
          }
          if (list.length < PAGE_LIMIT) {
            break;
          }
        }

        if (page === MAX_PAGES) {
          const warnMsg = `Simkl all-items/${type}/plantowatch reached maximum pagination limit (${MAX_PAGES} pages). Some items may not have been preloaded.`;
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
    throw new Error('Simkl does not support CSV export');
  }
}

export function createSimklPort(
  creds: ServiceCredentials,
  options?: { onLog?: SimklLogCallback }
): MediaServicePort {
  if (!creds.clientId) {
    throw new Error('Simkl clientId is required to initialize Simkl port');
  }
  return new SimklPort(
    {
      clientId: creds.clientId,
      accessToken: creds.accessToken,
    },
    options
  );
}
