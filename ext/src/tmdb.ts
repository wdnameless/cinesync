import { KPItem, TMDBSearchResult, TMDBAuth } from './types';

const TMDB_BASE = 'https://api.themoviedb.org/3';

export class TMDBClient {
  private apiKey: string;
  private sessionId?: string;
  private accountId?: string;
  private lastRequestTime = 0;
  private minIntervalMs = 260; // ~4 requests per second

  constructor(auth: TMDBAuth) {
    this.apiKey = auth.apiKey;
    this.sessionId = auth.sessionId;
    this.accountId = auth.accountId;
  }

  public setSessionId(sessionId: string) {
    this.sessionId = sessionId;
  }

  public setAccountId(accountId: string) {
    this.accountId = accountId;
  }

  private async rateLimitWait(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < this.minIntervalMs) {
      await new Promise((r) => setTimeout(r, this.minIntervalMs - elapsed));
    }
    this.lastRequestTime = Date.now();
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    params: Record<string, string> = {}
  ): Promise<T> {
    await this.rateLimitWait();

    const query = new URLSearchParams({
      api_key: this.apiKey,
      ...params,
    });

    if (this.sessionId && !params.session_id) {
      query.set('session_id', this.sessionId);
    }

    const url = `${TMDB_BASE}${endpoint}?${query.toString()}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });

    if (res.status === 429) {
      // Handle rate limit
      const retryAfter = parseInt(res.headers.get('Retry-After') || '2', 10);
      await new Promise((r) => setTimeout(r, (retryAfter + 1) * 1000));
      return this.request<T>(endpoint, options, params);
    }

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`TMDB API Error [${res.status}]: ${errorText}`);
    }

    return res.json();
  }

  /**
   * OAuth Step 1: Create a temporary request token
   */
  public async createRequestToken(): Promise<string> {
    const data = await this.request<{ request_token: string }>('/authentication/token/new');
    return data.request_token;
  }

  /**
   * OAuth Step 2: Validate token and create persistent session_id
   */
  public async createSession(requestToken: string): Promise<string> {
    const data = await this.request<{ success: boolean; session_id: string }>(
      '/authentication/session/new',
      {
        method: 'POST',
        body: JSON.stringify({ request_token: requestToken }),
      }
    );

    if (!data.success || !data.session_id) {
      throw new Error('Failed to create TMDB session. Ensure you approved authorization.');
    }

    this.sessionId = data.session_id;

    // Fetch account details to get account_id
    try {
      const account = await this.getAccountDetails();
      if (account?.id) {
        this.accountId = account.id.toString();
      }
    } catch {
      // Ignore account id fetch error if permissions vary
    }

    return this.sessionId;
  }

  public async getAccountDetails(): Promise<{ id: number; username: string }> {
    if (!this.sessionId) throw new Error('Session ID required');
    return this.request<{ id: number; username: string }>('/account', {}, { session_id: this.sessionId });
  }

  /**
   * Searches TMDB for matching media using Multi-Search or specific movie/tv search.
   * Ranks candidates by title similarity and release year proximity.
   */
  public async findBestMatch(item: KPItem): Promise<TMDBSearchResult | null> {
    // 0. If item has imdbId, use exact TMDB /find endpoint
    if (item.imdbId) {
      try {
        const findRes = await this.request<{
          movie_results?: TMDBSearchResult[];
          tv_results?: TMDBSearchResult[];
        }>(`/find/${item.imdbId}`, {}, { external_source: 'imdb_id' });
        if (findRes.movie_results && findRes.movie_results.length > 0) {
          return { ...findRes.movie_results[0], media_type: 'movie' };
        }
        if (findRes.tv_results && findRes.tv_results.length > 0) {
          return { ...findRes.tv_results[0], media_type: 'tv' };
        }
      } catch {
        // fallback to title search
      }
    }

    const candidates: TMDBSearchResult[] = [];
    // Helper search function
    const searchWith = async (queryText: string, year?: number) => {
      try {
        const params: Record<string, string> = {
          query: queryText,
          language: 'ru-RU',
          include_adult: 'true',
        };
        if (year) {
          params.primary_release_year = year.toString();
          params.first_air_date_year = year.toString();
        }

        const data = await this.request<{ results: TMDBSearchResult[] }>('/search/multi', {}, params);
        if (data.results && data.results.length > 0) {
          candidates.push(
            ...data.results.filter((r) => r.media_type === 'movie' || r.media_type === 'tv')
          );
        }
      } catch {
        // Continue search fallback
      }
    };

    // 1. Search by original title if available
    if (item.originalTitle) {
      await searchWith(item.originalTitle, item.year);
      if (candidates.length === 0 && item.year) {
        // Try without strict year
        await searchWith(item.originalTitle);
      }
    }

    // 2. Search by Russian / localized title
    if (candidates.length === 0 && item.title) {
      await searchWith(item.title, item.year);
      if (candidates.length === 0) {
        const titleYo = item.title.replace(/е/g, 'ё').replace(/Е/g, 'Ё');
        if (titleYo !== item.title) {
          await searchWith(titleYo, item.year);
        }
      }
      if (candidates.length === 0 && item.title.includes(':')) {
        const partAfterColon = item.title.split(':').slice(1).join(':').trim();
        if (partAfterColon) {
          await searchWith(partAfterColon, item.year);
          if (candidates.length === 0) {
            await searchWith(partAfterColon);
          }
        }
      }
      if (candidates.length === 0 && item.year) {
        await searchWith(item.title);
      }
    }
    if (candidates.length === 0) {
      return null;
    }

    // Scoring candidates
    const normalize = (s?: string) =>
      (s || '')
        .toLowerCase()
        .replace(/ё/g, 'е')
        .replace(/[^a-zа-я0-9]/gi, '')
        .trim();

    const targetNormRu = normalize(item.title);
    const targetNormOrig = normalize(item.originalTitle);
    const targetPartRu = item.title && item.title.includes(':') ? normalize(item.title.split(':').slice(1).join(':')) : '';
    let bestMatch: TMDBSearchResult | null = null;
    let maxScore = -1;

    for (const c of candidates) {
      let score = 0;
      const cTitle = normalize(c.title || c.name);
      const cOrig = normalize(c.original_title || c.original_name);

      // Title matching
      if (targetNormOrig && cOrig === targetNormOrig) score += 50;
      else if (targetNormOrig && cOrig.includes(targetNormOrig)) score += 30;
      if (targetNormRu && cTitle === targetNormRu) score += 40;
      else if (targetNormRu && cTitle.includes(targetNormRu)) score += 20;
      else if (targetPartRu && (cTitle === targetPartRu || cTitle.includes(targetPartRu))) score += 35;

      // Year matching
      const releaseDate = c.release_date || c.first_air_date;
      if (releaseDate && item.year) {
        const candYear = parseInt(releaseDate.slice(0, 4), 10);
        if (candYear === item.year) {
          score += 30;
        } else if (Math.abs(candYear - item.year) <= 1) {
          score += 15;
        } else {
          score -= 20; // Year mismatch penalty
        }
      }

      // Popularity boost as tie breaker
      if (c.popularity) {
        score += Math.min(10, c.popularity / 10);
      }

      if (score > maxScore) {
        maxScore = score;
        bestMatch = c;
      }
    }

    return bestMatch;
  }

  /**
   * Post rating (1-10) for Movie or TV show
   */
  public async rateMedia(mediaId: number, mediaType: 'movie' | 'tv', rating: number): Promise<void> {
    if (!this.sessionId) {
      throw new Error('Cannot rate media: Session ID is missing. Authorize via TMDB first.');
    }

    await this.request(
      `/${mediaType}/${mediaId}/rating`,
      {
        method: 'POST',
        body: JSON.stringify({ value: rating }),
      },
      { session_id: this.sessionId }
    );
  }

  /**
   * Add Movie or TV show to TMDB Watchlist
   */
  public async addToWatchlist(mediaId: number, mediaType: 'movie' | 'tv'): Promise<void> {
    if (!this.sessionId) {
      throw new Error('Cannot update watchlist: Session ID is missing. Authorize via TMDB first.');
    }

    const accId = this.accountId || 'account_id';
    await this.request(
      `/account/${accId}/watchlist`,
      {
        method: 'POST',
        body: JSON.stringify({
          media_type: mediaType,
          media_id: mediaId,
          watchlist: true,
        }),
      },
      { session_id: this.sessionId }
    );
  }

  /**
   * Check if TMDB API key is valid
   */
  public async pingKey(): Promise<boolean> {
    try {
      const res = await this.request<{ success?: boolean }>('/authentication');
      return res?.success === true;
    } catch {
      try {
        const res2 = await this.request<{ request_token?: string }>('/authentication/token/new');
        return !!res2?.request_token;
      } catch {
        return false;
      }
    }
  }

  /**
   * Fetches all already rated media from TMDB account to skip duplicates
   */
  public async getAllRatedIds(): Promise<Map<string, number>> {
    const ratingsMap = new Map<string, number>(); // key: 'movie:1234' -> rating
    if (!this.sessionId) return ratingsMap;
    const accId = this.accountId || 'account_id';

    for (const type of ['movies', 'tv'] as const) {
      let page = 1;
      let totalPages = 1;
      while (page <= totalPages && page <= 50) {
        try {
          const data = await this.request<{
            page: number;
            total_pages: number;
            results: Array<{ id: number; rating: number }>;
          }>(`/account/${accId}/rated/${type}`, {}, { session_id: this.sessionId, page: page.toString() });
          totalPages = data.total_pages || 1;
          const prefix = type === 'movies' ? 'movie' : 'tv';
          for (const item of data.results || []) {
            ratingsMap.set(`${prefix}:${item.id}`, item.rating);
          }
          page++;
        } catch {
          break;
        }
      }
    }
    return ratingsMap;
  }

  /**
   * Fetches all media in TMDB Watchlist to skip duplicates
   */
  public async getAllWatchlistIds(): Promise<Set<string>> {
    const watchlistSet = new Set<string>(); // 'movie:1234'
    if (!this.sessionId) return watchlistSet;
    const accId = this.accountId || 'account_id';

    for (const type of ['movies', 'tv'] as const) {
      let page = 1;
      let totalPages = 1;
      while (page <= totalPages && page <= 50) {
        try {
          const data = await this.request<{
            page: number;
            total_pages: number;
            results: Array<{ id: number }>;
          }>(`/account/${accId}/watchlist/${type}`, {}, { session_id: this.sessionId, page: page.toString() });
          totalPages = data.total_pages || 1;
          const prefix = type === 'movies' ? 'movie' : 'tv';
          for (const item of data.results || []) {
            watchlistSet.add(`${prefix}:${item.id}`);
          }
          page++;
        } catch {
          break;
        }
      }
    }
    return watchlistSet;
  }
}
