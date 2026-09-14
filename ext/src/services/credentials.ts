import { ServiceId } from './port';

export interface ServiceCredentials {
  clientId?: string;
  clientSecret?: string;
  accessToken?: string;
  apiKey?: string;
  sessionId?: string;
  accountId?: string;
  username?: string;
  userId?: string;
}

/** Fixed per-service storage keys. Missing fields stay `undefined` — never a placeholder. */
export const STORAGE_KEYS: Record<ServiceId, string> = {
  tmdb: 'tmdbAuth', // { apiKey, sessionId, accountId, username } — unchanged
  trakt: 'traktAuth', // { clientId, clientSecret, accessToken }
  simkl: 'simklAuth', // { clientId, accessToken }
  letterboxd: 'letterboxdAuth', // { userId }
  imdb: 'imdbAuth', // { userId }
  movielens: 'movielensAuth', // { userId }
  kinopoisk: 'kinopoiskAuth', // { userId }
};

export function storageKeyFor(service: ServiceId): string {
  return STORAGE_KEYS[service];
}

export async function loadCredentials(service: ServiceId): Promise<ServiceCredentials> {
  const key = storageKeyFor(service);
  const result = await chrome.storage.local.get([key]);
  const stored = result[key];
  if (stored && typeof stored === 'object') {
    return stored as ServiceCredentials;
  }
  return {};
}

export async function saveCredentials(service: ServiceId, creds: ServiceCredentials): Promise<void> {
  const key = storageKeyFor(service);
  await chrome.storage.local.set({ [key]: creds });
}
