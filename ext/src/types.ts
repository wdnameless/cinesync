import type { CsvBundle, MovieItem, ServiceId } from './services/port';
import type { ServiceCredentials } from './services/credentials';

export type { MovieItem, ServiceId, CsvBundle };

export type MediaCategory = 'ratings' | 'watchlist' | 'both';

/**
 * Kinopoisk-scraped item. Extends the canonical `MovieItem` with the fields the
 * scraper always fills, so the two shapes cannot drift apart.
 */
export interface KPItem extends MovieItem {
  id: string; // Kinopoisk ID
  category: 'ratings' | 'watchlist';
}

export interface TMDBSearchResult {
  id: number;
  media_type: 'movie' | 'tv';
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  release_date?: string;
  first_air_date?: string;
  vote_average?: number;
  popularity?: number;
}

export interface TMDBAuth {
  apiKey: string;
  sessionId?: string;
  accountId?: string;
  username?: string;
}

export type MigrationStatus =
  | 'idle'
  | 'detecting'
  | 'scraping'
  | 'paused_captcha'
  | 'migrating'
  | 'completed'
  | 'partial'
  | 'error';

export type TargetStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface TargetProgress {
  service: ServiceId;
  synced: number;
  skipped: number;
  failed: number;
  total: number;
  status: TargetStatus;
  error?: string;
}

export interface MigrationLog {
  timestamp: number;
  message: string;
  type: 'info' | 'warn' | 'error' | 'success';
}

export interface TaskState {
  status: 'idle' | 'running' | 'paused' | 'completed' | 'error';
  progress: number;
  count: number;
  currentTitle?: string;
  targetUser?: string;
}

export interface MigrationState {
  status: MigrationStatus;
  userId?: string;
  category: MediaCategory;
  totalFound: number;
  scrapedCount: number;
  syncedCount: number;
  skippedCount?: number;
  failedCount: number;
  currentTitle?: string;
  logs: MigrationLog[];
  errorMessage?: string;
  // Parallel worker statuses
  scrapeWorker?: TaskState;
  syncWorker?: TaskState;
  targets?: TargetProgress[];
}

export type RuntimeMessage =
  | { action: 'START_SCANNING'; category: MediaCategory; delayMs?: number; targetUserId?: string }
  | { action: 'START_SYNC'; targets: ServiceId[]; category: MediaCategory; delayMs?: number }
  | { action: 'STOP_PROCESS' }
  | { action: 'PAUSE_MIGRATION' }
  | { action: 'RESUME_MIGRATION' }
  | { action: 'RESET_STATE' }
  | { action: 'SAVE_SERVICE_CREDENTIALS'; service: ServiceId; credentials: ServiceCredentials }
  | { action: 'PING_SERVICE'; service: ServiceId }
  | { action: 'SIMKL_START_AUTH' }
  | { action: 'SIMKL_COMPLETE_AUTH'; userCode: string }
  | { action: 'TOGGLE_TARGET'; service: ServiceId; enabled: boolean }
  | { action: 'EXPORT_SERVICE_CSV'; service: ServiceId }
  | { action: 'TMDB_START_AUTH' }
  | { action: 'TMDB_COMPLETE_AUTH'; requestToken: string }
  | { action: 'SAVE_API_KEY'; apiKey: string }
  | { action: 'SAVE_KP_API_KEY'; kpApiKey: string }
  | { action: 'PING_TMDB_KEY'; apiKey?: string }
  | { action: 'PING_KP_KEY'; kpApiKey?: string }
  | { action: 'GET_STATE' };
