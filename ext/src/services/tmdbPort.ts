import {
  MediaServicePort,
  ServiceCapabilities,
  ServiceId,
  ServiceRef,
  CsvBundle,
  MovieItem,
} from './port';
import { ServiceCredentials } from './credentials';
import { TMDBClient } from '../tmdb';
import { KPItem } from '../types';

export class AuthExpiredError extends Error {
  readonly code = 'AUTH_EXPIRED' as const;
  readonly service: ServiceId = 'tmdb';

  constructor(message = 'TMDB authentication expired or invalid') {
    super(message);
    this.name = 'AuthExpiredError';
    Object.setPrototypeOf(this, AuthExpiredError.prototype);
  }
}

function isAuthExpired(err: unknown): boolean {
  if (!err) return false;
  if (typeof err === 'object') {
    const record = err as Record<string, unknown>;
    if (record.code === 'AUTH_EXPIRED') return true;
    if (record.status === 401 || record.status === 403) return true;
  }
  if (err instanceof Error) {
    const msg = err.message;
    if (
      msg.includes('[401]') ||
      msg.includes('[403]') ||
      msg.includes('Session ID is missing')
    ) {
      return true;
    }
  }
  return false;
}

export class TmdbPort implements MediaServicePort {
  readonly id: ServiceId = 'tmdb';
  readonly label = 'TMDB';
  readonly capabilities: ServiceCapabilities = {
    canRate: true,
    canWatchlist: true,
    requiresAuth: true,
    writeMode: 'api',
  };

  private readonly client: TMDBClient;

  constructor(client: TMDBClient) {
    this.client = client;
  }

  async ping(): Promise<boolean> {
    return this.client.pingKey();
  }

  async resolve(item: MovieItem): Promise<ServiceRef | null> {
    const kpItem: KPItem = {
      id: item.kpId || item.id || '',
      title: item.title,
      originalTitle: item.originalTitle,
      imdbId: item.imdbId,
      year: item.year,
      rating: item.rating,
      voteDate: item.voteDate,
      category: item.category ?? 'ratings',
    };

    try {
      const match = await this.client.findBestMatch(kpItem);
      if (!match) {
        return null;
      }

      return {
        service: 'tmdb',
        id: String(match.id),
        mediaType: match.media_type,
        label: match.title || match.name,
      };
    } catch (err: unknown) {
      if (isAuthExpired(err)) {
        throw new AuthExpiredError(
          err instanceof Error ? err.message : 'TMDB authentication expired'
        );
      }
      throw err;
    }
  }

  async pushRating(ref: ServiceRef, rating: number): Promise<void> {
    const mediaId = Number(ref.id);
    if (Number.isNaN(mediaId)) {
      throw new Error(`Invalid TMDB media ID: ${ref.id}`);
    }

    try {
      await this.client.rateMedia(mediaId, ref.mediaType, rating);
    } catch (err: unknown) {
      if (isAuthExpired(err)) {
        throw new AuthExpiredError(
          err instanceof Error ? err.message : 'TMDB authentication expired'
        );
      }
      throw err;
    }
  }

  async pushWatchlist(ref: ServiceRef): Promise<void> {
    const mediaId = Number(ref.id);
    if (Number.isNaN(mediaId)) {
      throw new Error(`Invalid TMDB media ID: ${ref.id}`);
    }

    try {
      await this.client.addToWatchlist(mediaId, ref.mediaType);
    } catch (err: unknown) {
      if (isAuthExpired(err)) {
        throw new AuthExpiredError(
          err instanceof Error ? err.message : 'TMDB authentication expired'
        );
      }
      throw err;
    }
  }

  async fetchExistingRatings(): Promise<Map<string, number>> {
    try {
      return await this.client.getAllRatedIds();
    } catch (err: unknown) {
      if (isAuthExpired(err)) {
        throw new AuthExpiredError(
          err instanceof Error ? err.message : 'TMDB authentication expired'
        );
      }
      throw err;
    }
  }

  async fetchExistingWatchlist(): Promise<Set<string>> {
    try {
      return await this.client.getAllWatchlistIds();
    } catch (err: unknown) {
      if (isAuthExpired(err)) {
        throw new AuthExpiredError(
          err instanceof Error ? err.message : 'TMDB authentication expired'
        );
      }
      throw err;
    }
  }

  exportCsv(_items: MovieItem[]): CsvBundle[] {
    throw new Error('TMDB does not support CSV export');
  }
}

export function createTmdbPort(
  clientOrCreds: TMDBClient | ServiceCredentials
): MediaServicePort {
  if (clientOrCreds instanceof TMDBClient) {
    return new TmdbPort(clientOrCreds);
  }
  const auth = {
    apiKey: clientOrCreds.apiKey ?? '',
    sessionId: clientOrCreds.sessionId,
    accountId: clientOrCreds.accountId,
    username: clientOrCreds.username,
  };
  return new TmdbPort(new TMDBClient(auth));
}
