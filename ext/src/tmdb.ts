import { KPItem, TMDBSearchResult, TMDBAuth } from './types';

const TMDB_BASE = 'https://api.themoviedb.org/3';

/**
 * Generates the plausible ё spellings of a title for a literal-title search.
 *
 * Kinopoisk and TMDB disagree about е/ё often enough to matter ("Зеленая миля"
 * vs "Зелёная миля"). TMDB's search does not fold the letters, so the caller has
 * to try candidates. Replacing every е at once produces a title no one writes,
 * so each е is flipped on its own; the all-flipped form is added last. The list
 * is capped because the request budget is not free and titles are short.
 */
function yoVariants(title: string): string[] {
  const positions: number[] = [];
  for (let i = 0; i < title.length; i++) {
    const ch = title[i];
    if (ch === 'е' || ch === 'Е') positions.push(i);
    if (positions.length >= 6) break;
  }
  if (positions.length === 0) return [];

  const variants: string[] = [];
  for (const index of positions) {
    const flipped = title.slice(0, index) + (title[index] === 'е' ? 'ё' : 'Ё') + title.slice(index + 1);
    variants.push(flipped);
  }

  const allFlipped = title.replace(/е/g, 'ё').replace(/Е/g, 'Ё');
  return [...new Set([...variants, allFlipped])];
}

const ROMAN_NUMERALS: Record<string, string> = {
  i: '1', ii: '2', iii: '3', iv: '4', v: '5', vi: '6',
  vii: '7', viii: '8', ix: '9', x: '10', xi: '11', xii: '12',
};

/**
 * Folds a title into a comparable form for matching.
 *
 * Cyrillic ё and е are the same letter to a reader but different characters to
 * a string comparison, and TMDB is inconsistent about which one it stores.
 * Latin and Cyrillic lookalikes appear in mixed-script titles. A trailing roman
 * numeral ("Rocky II") and its Arabic form ("Rocky 2") must compare equal.
 */
function normalizeTitle(value?: string): string {
  const lowered = (value ?? '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9 ]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const tokens = lowered.split(' ').map((token) => ROMAN_NUMERALS[token] ?? token);
  return tokens.join('');
}

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
   * Searches TMDB for the media record matching a Kinopoisk item, and returns it
   * only when the match clears a confidence gate.
   *
   * Two things are deliberately strict here, because the caller writes a rating
   * onto whatever this returns and a wrong answer silently corrupts the account:
   *
   * 1. Only the endpoint matching the item's own media type is searched
   *    (`/search/movie` for films, `/search/tv` for series). `/search/multi`
   *    accepts both and silently ignores `primary_release_year`, so it could
   *    return a series for a film and the rating would land on the wrong record.
   *    The type-specific endpoints also honour the year filter, which makes the
   *    candidate set far less noisy to begin with.
   * 2. A candidate is returned only if a title really matches — exact title, or a
   *    partial title backed by an exact year. There is no "best of a bad bunch"
   *    fallback: a low-confidence match returns `null` so the caller counts a
   *    failure instead of writing to an unrelated film.
   */
  public async findBestMatch(item: KPItem): Promise<TMDBSearchResult | null> {
    const expectedType: 'movie' | 'tv' = item.type === 'series' ? 'tv' : 'movie';

    // 0. An IMDb id is authoritative — but only when it resolves to the same
    //    media type the scraped item claims.
    if (item.imdbId) {
      try {
        const findRes = await this.request<{
          movie_results?: TMDBSearchResult[];
          tv_results?: TMDBSearchResult[];
        }>(`/find/${item.imdbId}`, {}, { external_source: 'imdb_id' });

        const sameType = expectedType === 'movie' ? findRes.movie_results : findRes.tv_results;
        const otherType = expectedType === 'movie' ? findRes.tv_results : findRes.movie_results;

        if (sameType && sameType.length > 0) {
          return { ...sameType[0], media_type: expectedType };
        }
        if (otherType && otherType.length > 0) {
          // The id belongs to a record of a different media type: the scraped
          // type and the external id disagree. Refuse rather than guess.
          return null;
        }
      } catch {
        // fallback to title search
      }
    }

    const candidates: TMDBSearchResult[] = [];

    const searchWith = async (queryText: string) => {
      const endpoint = expectedType === 'movie' ? '/search/movie' : '/search/tv';
      const run = async (year?: number) => {
        try {
          const params: Record<string, string> = {
            query: queryText,
            language: 'ru-RU',
            include_adult: 'true',
          };
          if (year) {
            if (expectedType === 'movie') {
              params.year = String(year);
            } else {
              params.first_air_date_year = String(year);
            }
          }

          const data = await this.request<{ results: TMDBSearchResult[] }>(endpoint, {}, params);
          for (const hit of data.results ?? []) {
            if (!candidates.some((c) => c.id === hit.id)) {
              candidates.push({ ...hit, media_type: expectedType });
            }
          }
        } catch {
          // Continue with the next query variant.
        }
      };

      if (item.year) {
        await run(item.year);
      }
      if (candidates.length === 0) {
        await run();
      }
    };

    // 1. Original title, when enrichment supplied one — the strongest signal.
    if (item.originalTitle) {
      await searchWith(item.originalTitle);
    }

    // 2. Localized / scraped title.
    if (candidates.length === 0 && item.title) {
      await searchWith(item.title);

      // A Kinopoisk title may spell е where TMDB stores ё, and TMDB's search is
      // a literal string match that does not fold the two letters. Replacing
      // *every* е at once is wrong — "Зеленая миля" would become "Зёлёная
      // миля" and match nothing — so try one position at a time, plus the
      // all-replaced form, bounded so a pathological title cannot fan out.
      if (candidates.length === 0) {
        for (const variant of yoVariants(item.title)) {
          if (candidates.length > 0) break;
          await searchWith(variant);
        }
      }

      // Franchise items sometimes live upstream under the subtitle alone.
      if (candidates.length === 0 && item.title.includes(':')) {
        const partAfterColon = item.title.split(':').slice(1).join(':').trim();
        if (partAfterColon) {
          await searchWith(partAfterColon);
        }
      }

      if (candidates.length === 0) {
        await searchWith(item.title);
      }
    }

    if (candidates.length === 0) {
      return null;
    }

    const needles = [
      normalizeTitle(item.title),
      normalizeTitle(item.originalTitle),
      item.title.includes(':') ? normalizeTitle(item.title.split(':').slice(1).join(':')) : '',
    ].filter((n) => n.length >= 2);

    let bestMatch: TMDBSearchResult | null = null;
    let bestScore = -Infinity;

    for (const c of candidates) {
      const haystacks = [normalizeTitle(c.title || c.name), normalizeTitle(c.original_title || c.original_name)].filter(
        (h) => h.length > 0
      );
      if (haystacks.length === 0) continue;

      const releaseDate = c.release_date || c.first_air_date;
      const candYear = releaseDate ? parseInt(releaseDate.slice(0, 4), 10) : NaN;
      const yearExact = !!item.year && candYear === item.year;
      const yearNear = !!item.year && !Number.isNaN(candYear) && Math.abs(candYear - item.year) <= 1;

      const titleExact = needles.some((n) => haystacks.some((h) => h === n));
      const titlePartial = needles.some((n) =>
        haystacks.some((h) => {
          const shorter = n.length <= h.length ? n : h;
          const longer = n.length <= h.length ? h : n;
          return shorter.length >= 5 && longer.includes(shorter);
        })
      );

      // The acceptance gate. Title alone is enough when the item has no year to
      // contradict it; otherwise the year has to corroborate the title.
      const confident = titleExact ? !item.year || yearNear : titlePartial && yearExact;
      if (!confident) continue;

      let score = 0;
      if (titleExact) score += 60;
      else if (titlePartial) score += 25;
      if (yearExact) score += 30;
      else if (yearNear) score += 15;
      if (haystacks.some((h) => needles.includes(h))) score += 10;
      score += Math.min(10, (c.popularity ?? 0) / 10);

      if (score > bestScore) {
        bestScore = score;
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
