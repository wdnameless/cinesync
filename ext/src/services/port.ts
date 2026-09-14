export type ServiceId = 'tmdb' | 'trakt' | 'simkl' | 'letterboxd' | 'imdb' | 'movielens';

export type WriteMode = 'api' | 'csv';

export interface ServiceCapabilities {
  canRate: boolean;
  canWatchlist: boolean;
  requiresAuth: boolean;
  writeMode: WriteMode;
  /** true when the service documents no import path at all — UI must say so plainly */
  exportOnly?: boolean;
  /** documented per-file byte ceiling for CSV services, when one exists */
  maxFileBytes?: number;
}

/** A resolved id in the target service's own namespace */
export interface ServiceRef {
  service: ServiceId;
  id: string;
  mediaType: 'movie' | 'tv';
  label?: string;
}

/** Return shape for CSV adapters so one export can yield several files (e.g. Letterboxd 1 MB limit) */
export interface CsvBundle {
  filename: string;
  content: string; // UTF-8, BOM prepended by the caller
}

/** Canonical movie/series item across sources and ports */
export interface MovieItem {
  id?: string;
  kpId?: string;
  imdbId?: string;
  tmdbId?: number;
  title: string;
  originalTitle?: string;
  year?: number;
  rating?: number; // 1-10 (for ratings)
  voteDate?: string;
  category?: 'ratings' | 'watchlist';
  type?: 'film' | 'series' | 'movie' | 'tv';
  url?: string;
}

export interface MediaServicePort {
  readonly id: ServiceId;
  readonly label: string;
  readonly capabilities: ServiceCapabilities;

  ping(): Promise<boolean>;
  resolve(item: MovieItem): Promise<ServiceRef | null>;
  pushRating(ref: ServiceRef, rating: number): Promise<void>;
  pushWatchlist(ref: ServiceRef): Promise<void>;
  fetchExistingRatings(): Promise<Map<string, number>>;
  fetchExistingWatchlist(): Promise<Set<string>>;
  exportCsv(items: MovieItem[]): CsvBundle[];
}
