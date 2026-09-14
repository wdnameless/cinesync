export type MediaCategory = 'ratings' | 'watchlist' | 'both';

export interface KPItem {
  id: string; // Kinopoisk ID
  title: string;
  originalTitle?: string;
  imdbId?: string;
  year?: number;
  rating?: number; // 1-10 (for ratings)
  voteDate?: string;
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
  | 'error';

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
}

export type RuntimeMessage =
  | { action: 'START_SCANNING'; category: MediaCategory; delayMs?: number; targetUserId?: string }
  | { action: 'START_MIGRATION'; category: MediaCategory; delayMs?: number }
  | { action: 'STOP_SCANNING' }
  | { action: 'STOP_MIGRATION' }
  | { action: 'STOP_PROCESS' }
  | { action: 'PAUSE_MIGRATION' }
  | { action: 'RESUME_MIGRATION' }
  | { action: 'RESET_STATE' }
  | { action: 'TMDB_START_AUTH' }
  | { action: 'TMDB_COMPLETE_AUTH'; requestToken: string }
  | { action: 'SAVE_API_KEY'; apiKey: string }
  | { action: 'SAVE_KP_API_KEY'; kpApiKey: string }
  | { action: 'PING_TMDB_KEY'; apiKey?: string }
  | { action: 'PING_KP_KEY'; kpApiKey?: string }
  | { action: 'GET_STATE' };
