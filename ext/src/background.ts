import {
  KPItem,
  MediaCategory,
  MigrationState,
  MovieItem,
  RuntimeMessage,
  ServiceId,
  TargetProgress,
  TargetStatus,
  TMDBAuth,
} from './types';
import { TMDBClient } from './tmdb';
import { KPClient } from './kpClient';
import { KinopoiskPort } from './services/kinopoiskPort';
import { MediaServicePort, ServiceRef } from './services/port';
import { loadCredentials, saveCredentials, ServiceCredentials } from './services/credentials';
import { createTmdbPort } from './services/tmdbPort';
import { TraktPort } from './services/traktPort';
import { SimklPort } from './services/simklPort';
import { letterboxdPort, imdbPort, movieLensPort } from './services/csvPorts';
import { detectKinopoiskUserId, parseKinopoiskPage } from './scraper';
const DEFAULT_STATE: MigrationState = {
  status: 'idle',
  category: 'both',
  totalFound: 0,
  scrapedCount: 0,
  syncedCount: 0,
  skippedCount: 0,
  failedCount: 0,
  logs: [],
  targets: [],
};

let currentState: MigrationState = { ...DEFAULT_STATE };
chrome.storage.local.get(['migrationState'], (res) => {
  if (res.migrationState) {
    currentState = { ...DEFAULT_STATE, ...res.migrationState };
  }
});

let kpClient: KPClient | null = null;
let isPaused = false;
let isScanAborted = false;
let isSyncAborted = false;
let isScanRunning = false;
let isSyncRunning = false;
let isAborted = false;

function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

function navigateTabAndWait(tabId: number, url: string, timeoutMs: number = 15000): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  let timer: number | null = null;
  const listener = (tid: number, changeInfo: chrome.tabs.TabChangeInfo) => {
    if (tid === tabId && changeInfo.status === 'complete') {
      chrome.tabs.onUpdated.removeListener(listener);
      if (timer) clearTimeout(timer);
      resolve();
    }
  };
  timer = setTimeout(() => {
    chrome.tabs.onUpdated.removeListener(listener);
    resolve(); // resolve anyway on timeout so we can attempt scraping
  }, timeoutMs) as unknown as number;
  chrome.tabs.onUpdated.addListener(listener);
  chrome.tabs.update(tabId, { url }).catch(reject);
  return promise;
}

async function logMessage(message: string, type: 'info' | 'warn' | 'error' | 'success' = 'info') {
  const entry = { timestamp: Date.now(), message, type };
  currentState.logs.push(entry);
  if (currentState.logs.length > 200) {
    currentState.logs.shift();
  }
  await chrome.storage.local.set({ migrationState: currentState });
}

async function updateState(partial: Partial<MigrationState>) {
  currentState = { ...currentState, ...partial };
  await chrome.storage.local.set({ migrationState: currentState });
}

async function initFromStorage() {
  const data = await chrome.storage.local.get(['migrationState', 'kpApiKey']);
  if (data.migrationState) {
    currentState = { ...DEFAULT_STATE, ...data.migrationState };
  }
  if (data.kpApiKey) {
    kpClient = new KPClient(data.kpApiKey);
  }
}

// Load persisted state & credentials on startup
chrome.runtime.onInstalled.addListener(async () => {
  await initFromStorage();
});

chrome.runtime.onStartup.addListener(async () => {
  await initFromStorage();
});

function isAuthExpiredError(err: unknown): boolean {
  if (!err) return false;
  if (typeof err === 'object') {
    const rec = err as Record<string, unknown>;
    if (rec.name === 'AuthExpiredError' || rec.code === 'AUTH_EXPIRED') {
      return true;
    }
  }
  if (err instanceof Error && (err.name === 'AuthExpiredError' || (err as { code?: string }).code === 'AUTH_EXPIRED')) {
    return true;
  }
  return false;
}

let cachedKinopoiskTabId: number | null = null;

/**
 * Finds an existing Kinopoisk tab or creates a new one and reuses it for the run.
 */
async function ensureKinopoiskTab(): Promise<number> {
  if (cachedKinopoiskTabId !== null) {
    try {
      const tab = await chrome.tabs.get(cachedKinopoiskTabId);
      if (tab?.id) return tab.id;
    } catch {
      cachedKinopoiskTabId = null;
    }
  }

  const tabs = await chrome.tabs.query({ url: ['*://*.kinopoisk.ru/*'] });
  if (tabs.length > 0 && tabs[0].id) {
    cachedKinopoiskTabId = tabs[0].id;
    return tabs[0].id;
  }

  const newTab = await chrome.tabs.create({
    url: 'https://www.kinopoisk.ru/',
    active: false,
  });
  if (!newTab.id) {
    throw new Error('Не удалось создать вкладку Кинопоиска');
  }
  cachedKinopoiskTabId = newTab.id;

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, 15000);
    function listener(updatedTabId: number, info: chrome.tabs.TabChangeInfo) {
      if (updatedTabId === newTab.id && info.status === 'complete') {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });

  return newTab.id;
}

async function getPortForService(
  serviceId: ServiceId,
  customCreds?: ServiceCredentials,
  options?: { probeOnly?: boolean }
): Promise<MediaServicePort> {
  const creds = customCreds ?? (await loadCredentials(serviceId));

  switch (serviceId) {
    case 'tmdb': {
      if (!creds?.apiKey) {
        throw new Error('TMDB API Key не настроен. Настройте ключ в секции API.');
      }
      return createTmdbPort(creds);
    }
    case 'trakt': {
      if (!creds?.clientId) {
        throw new Error('Trakt client_id не настроен. Зарегистрируйте приложение в настройках Trakt.');
      }
      return new TraktPort(
        {
          clientId: creds.clientId,
          clientSecret: creds.clientSecret,
          accessToken: creds.accessToken,
        },
        {
          onLog: (msg) => {
            logMessage(`[Trakt] ${msg}`, 'warn').catch(() => {});
          },
        }
      );
    }
    case 'simkl': {
      if (!creds?.clientId) {
        throw new Error('Simkl client_id не настроен. Зарегистрируйте приложение в настройках Simkl.');
      }
      return new SimklPort(
        {
          clientId: creds.clientId,
          accessToken: creds.accessToken,
        },
        {
          onLog: (msg) => {
            logMessage(`[Simkl] ${msg}`, 'warn').catch(() => {});
          },
        }
      );
    }
    case 'kinopoisk': {
      // Ping must never create or wait for a tab: it only reports whether a
      // Kinopoisk tab is already open. Waiting here would stall the message
      // channel for the full tab-load timeout.
      if (options?.probeOnly) {
        return new KinopoiskPort();
      }
      const tabId = await ensureKinopoiskTab();
      return new KinopoiskPort({ tabId });
    }
    case 'letterboxd':
      return letterboxdPort;
    case 'imdb':
      return imdbPort;
    case 'movielens':
      return movieLensPort;
    default: {
      const _exhaustive: never = serviceId;
      throw new Error(`Неизвестный сервис: ${_exhaustive}`);
    }
  }
}

// Handle runtime messages from popup
chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
  (async () => {
    try {
      switch (message.action) {
        case 'GET_STATE': {
          sendResponse({ state: currentState });
          break;
        }

        case 'SAVE_API_KEY': {
          const auth: TMDBAuth = { apiKey: message.apiKey };
          await chrome.storage.local.set({ tmdbAuth: auth });
          await logMessage('TMDB API Key сохранен', 'success');
          sendResponse({ success: true });
          break;
        }

        case 'SAVE_KP_API_KEY': {
          await chrome.storage.local.set({ kpApiKey: message.kpApiKey });
          kpClient = new KPClient(message.kpApiKey);
          await logMessage('Kinopoisk Unofficial API Key сохранен', 'success');
          sendResponse({ success: true });
          break;
        }

        case 'PING_TMDB_KEY': {
          const key = message.apiKey;
          if (!key) {
            sendResponse({ success: false, valid: false, error: 'API Key не указан' });
            break;
          }
          const client = new TMDBClient({ apiKey: key });
          const valid = await client.pingKey();
          sendResponse({ success: true, valid });
          break;
        }

        case 'PING_KP_KEY': {
          const key = message.kpApiKey;
          if (!key) {
            sendResponse({ success: false, valid: false, error: 'API Key не указан' });
            break;
          }
          const client = new KPClient(key);
          const valid = await client.pingKey();
          sendResponse({ success: true, valid });
          break;
        }

        case 'TMDB_START_AUTH': {
          const data = await chrome.storage.local.get('tmdbAuth');
          if (!data.tmdbAuth?.apiKey) {
            sendResponse({ success: false, error: 'Сначала укажите API Key TMDB.' });
            break;
          }
          const client = new TMDBClient(data.tmdbAuth);
          const requestToken = await client.createRequestToken();
          await chrome.storage.local.set({ tmdbRequestToken: requestToken });
          const authUrl = `https://www.themoviedb.org/authenticate/${requestToken}`;
          await chrome.tabs.create({ url: authUrl });
          sendResponse({ success: true, requestToken });
          break;
        }

        case 'TMDB_COMPLETE_AUTH': {
          const data = await chrome.storage.local.get('tmdbAuth');
          if (!data.tmdbAuth?.apiKey) {
            sendResponse({ success: false, error: 'API key not configured' });
            break;
          }
          const client = new TMDBClient(data.tmdbAuth);
          const sessionId = await client.createSession(message.requestToken);
          client.setSessionId(sessionId);
          const account = await client.getAccountDetails();

          const updatedAuth: TMDBAuth = {
            ...data.tmdbAuth,
            sessionId,
            accountId: String(account.id),
            username: account.username,
          };
          await chrome.storage.local.set({ tmdbAuth: updatedAuth });
          await logMessage(`TMDB авторизован: @${account.username}`, 'success');
          sendResponse({ success: true, username: account.username });
          break;
        }

        case 'SAVE_SERVICE_CREDENTIALS': {
          await saveCredentials(message.service, message.credentials);
          await logMessage(`Учетные данные для ${message.service} сохранены`, 'success');
          sendResponse({ success: true });
          break;
        }

        case 'PING_SERVICE': {
          try {
            // Probe-only: never create a tab or wait on tab load for a ping.
            const port = await getPortForService(message.service, undefined, { probeOnly: true });
            const valid = await port.ping();
            sendResponse({ success: true, valid });
          } catch (err: unknown) {
            const errMsg = err instanceof Error ? err.message : String(err);
            sendResponse({ success: false, valid: false, error: errMsg });
          }
          break;
        }

        case 'TOGGLE_TARGET': {
          const targetMap = new Map<ServiceId, TargetProgress>();
          for (const t of currentState.targets ?? []) {
            targetMap.set(t.service, { ...t });
          }

          if (message.enabled) {
            if (!targetMap.has(message.service)) {
              targetMap.set(message.service, {
                service: message.service,
                synced: 0,
                skipped: 0,
                failed: 0,
                total: 0,
                status: 'pending',
              });
            }
          } else {
            targetMap.delete(message.service);
          }

          const updatedTargets = Array.from(targetMap.values());
          await updateState({ targets: updatedTargets });
          sendResponse({ success: true });
          break;
        }

        case 'EXPORT_SERVICE_CSV': {
          try {
            const stored = await chrome.storage.local.get(['lastScrapedItems', 'scrapedItems']);
            const items: MovieItem[] = stored.lastScrapedItems || stored.scrapedItems || [];
            if (!Array.isArray(items) || items.length === 0) {
              sendResponse({ success: false, error: 'Нет собранных данных для экспорта' });
              break;
            }

            const port = await getPortForService(message.service);
            const files = port.exportCsv(items);
            sendResponse({ success: true, files });
          } catch (err: unknown) {
            const errMsg = err instanceof Error ? err.message : String(err);
            sendResponse({ success: false, error: errMsg });
          }
          break;
        }

        case 'START_SCANNING': {
          isScanAborted = false;
          isPaused = false;
          isScanRunning = true;
          runScanningOnly(message.category, message.delayMs || 2500, message.targetUserId).catch(async (err: unknown) => {
            const errMsg = err instanceof Error ? err.message : String(err);
            await logMessage(`Ошибка сбора данных: ${errMsg}`, 'error');
            await updateState({ status: 'error', errorMessage: errMsg });
          }).finally(() => {
            isScanRunning = false;
          });
          sendResponse({ success: true });
          break;
        }

        case 'START_SYNC': {
          isSyncAborted = false;
          isAborted = false;
          isPaused = false;
          isSyncRunning = true;
          runSync(message.targets, message.category, message.delayMs || 2500).catch(async (err: unknown) => {
            const errMsg = err instanceof Error ? err.message : String(err);
            await logMessage(`Критическая ошибка синхронизации: ${errMsg}`, 'error');
            await updateState({ status: 'error', errorMessage: errMsg });
          }).finally(() => {
            isSyncRunning = false;
          });
          sendResponse({ success: true });
          break;
        }

        case 'STOP_PROCESS': {
          isScanAborted = true;
          isSyncAborted = true;
          isAborted = true;
          isPaused = false;
          isScanRunning = false;
          isSyncRunning = false;
          // A target left mid-flight must not stay 'running' after the user
          // stops: finalize it as 'skipped' so the UI does not show a stopped
          // run as still in progress.
          const stoppedTargets = (currentState.targets ?? []).map((t) =>
            t.status === 'running' || t.status === 'pending'
              ? { ...t, status: 'skipped' as TargetStatus }
              : t
          );
          await updateState({ status: 'idle', currentTitle: undefined, targets: stoppedTargets });
          await logMessage('Все активные процессы остановлены пользователем', 'warn');
          sendResponse({ success: true });
          break;
        }

        case 'PAUSE_MIGRATION': {
          isPaused = true;
          await updateState({ status: 'paused_captcha' });
          await logMessage('Миграция приостановлена пользователем', 'warn');
          sendResponse({ success: true });
          break;
        }

        case 'RESUME_MIGRATION': {
          isPaused = false;
          await logMessage('Возобновление миграции...', 'info');
          sendResponse({ success: true });
          break;
        }

        case 'RESET_STATE': {
          isAborted = true;
          isScanAborted = true;
          isSyncAborted = true;
          isPaused = false;
          currentState = { ...DEFAULT_STATE };
          await chrome.storage.local.set({ migrationState: currentState });
          sendResponse({ success: true });
          break;
        }

        default: {
          const _unknown: { action: string } = message;
          sendResponse({ success: false, error: `Неизвестное действие: ${_unknown.action}` });
          break;
        }
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      await logMessage(`Ошибка: ${errMsg}`, 'error');
      sendResponse({ success: false, error: errMsg });
    }
  })();

  return true; // Keep message channel open for async sendResponse
});

async function collectKinopoiskItems(
  category: MediaCategory,
  delayMs: number,
  targetUserId?: string
): Promise<MovieItem[]> {
  await updateState({
    status: 'detecting',
    category,
    errorMessage: undefined,
  });

  const tabs = await chrome.tabs.query({ url: '*://*.kinopoisk.ru/*' });
  const kpTab = tabs[0];
  let tabId = kpTab?.id;

  if (!tabId) {
    const newTab = await chrome.tabs.create({
      url: 'https://www.kinopoisk.ru/',
      active: false,
    });
    tabId = newTab.id!;
    await navigateTabAndWait(tabId, 'https://www.kinopoisk.ru/');
    await sleep(2000);
  }

  let userId: string | null = targetUserId || null;
  if (!userId) {
    try {
      const uidResults = await chrome.scripting.executeScript({
        target: { tabId },
        func: detectKinopoiskUserId,
      });
      const rawUid = uidResults?.[0]?.result;
      userId = typeof rawUid === 'string' ? rawUid : null;
    } catch {
      userId = null;
    }
  }

  if (!userId) {
    await updateState({ status: 'error', errorMessage: 'Не удалось определить ID пользователя Кинопоиска' });
    throw new Error('ID пользователя Кинопоиска не найден. Войдите в профиль Кинопоиска в соседней вкладке.');
  }

  await updateState({ userId, status: 'scraping' });
  await logMessage(`Обнаружен пользователь Кинопоиска ID: ${userId}`, 'info');

  const categoriesToScrape: ('ratings' | 'watchlist')[] =
    category === 'both' ? ['ratings', 'watchlist'] : [category];

  const scrapedItems: MovieItem[] = [];

  for (const cat of categoriesToScrape) {
    if (isAborted || isScanAborted) {
      await logMessage('Сбор данных отменен пользователем.', 'warn');
      await updateState({ status: 'idle', currentTitle: undefined });
      return scrapedItems;
    }

    const catLabel = cat === 'ratings' ? 'оценок' : 'списка "Буду смотреть"';
    await logMessage(`Начало сбора ${catLabel}...`, 'info');

    let page = 1;
    let hasMorePages = true;

    while (hasMorePages && !isAborted && !isScanAborted) {
      if (isPaused) {
        await logMessage('Сбор приостановлен...', 'warn');
        while (isPaused && !isAborted && !isScanAborted) {
          await sleep(1000);
        }
        if (isAborted || isScanAborted) break;
      }

      const pageUrl =
        cat === 'ratings'
          ? `https://www.kinopoisk.ru/user/${userId}/votes/list/vs/vote/page/${page}/#list`
          : `https://www.kinopoisk.ru/user/${userId}/movies/list/type/3554/sort/default/vector/desc/page/${page}/#list`;

      await updateState({
        currentTitle: `Страница ${page} (${cat === 'ratings' ? 'Оценки' : 'Буду смотреть'})`,
      });

      try {
        await navigateTabAndWait(tabId, pageUrl);
        await sleep(delayMs);
      } catch (navErr) {
        await logMessage(`Ошибка перехода на страницу ${page}: ${navErr}`, 'warn');
      }

      let pageRes;
      try {
        pageRes = await chrome.scripting.executeScript({
          target: { tabId },
          func: parseKinopoiskPage,
          args: [cat],
        });
      } catch (execErr) {
        await logMessage(`Ошибка скрипта на стр. ${page}: ${execErr}`, 'error');
        break;
      }

      const res = pageRes?.[0]?.result as
        | { items: KPItem[]; hasCaptcha: boolean; totalCountOnPage: number }
        | undefined;

      if (!res) {
        page++;
        continue;
      }

      if (res.hasCaptcha) {
        isPaused = true;
        await updateState({ status: 'paused_captcha' });
        await logMessage(`Капча на странице ${page}! Пройдите капчу в открытой вкладке и нажмите "Возобновить"`, 'warn');
        while (isPaused && !isAborted && !isScanAborted) {
          await sleep(2000);
        }
        if (isAborted || isScanAborted) break;
        continue;
      }

      if (res.items.length === 0) {
        hasMorePages = false;
        break;
      }

      const movieItems: MovieItem[] = res.items.map((it) => ({
        id: it.id,
        kpId: it.id,
        title: it.title,
        originalTitle: it.originalTitle,
        year: it.year,
        rating: it.rating,
        category: it.category,
      }));

      scrapedItems.push(...movieItems);
      await updateState({
        scrapedCount: scrapedItems.length,
        totalFound: scrapedItems.length,
      });

      await logMessage(`Стр. ${page}: найдено ${res.items.length} элементов (всего: ${scrapedItems.length})`, 'info');

      if (res.items.length < 25) {
        hasMorePages = false;
      } else {
        page++;
      }
    }
  }

  await chrome.storage.local.set({ lastScrapedItems: scrapedItems, scrapedItems });
  return scrapedItems;
}

async function runScanningOnly(category: MediaCategory, delayMs: number, targetUserId?: string) {
  const items = await collectKinopoiskItems(category, delayMs, targetUserId);
  await updateState({
    status: 'completed',
    currentTitle: undefined,
  });
  await logMessage(`Сканирование завершено! Собрано ${items.length} элементов Кинопоиска. Теперь доступен экспорт и синхронизация!`, 'success');
}

function dedupeKey(ref: ServiceRef): string[] {
  const keys: string[] = [];
  keys.push(ref.id);
  keys.push(`${ref.mediaType}_${ref.id}`);
  keys.push(`${ref.mediaType}:${ref.id}`);
  return keys;
}

async function runSync(
  targets: ServiceId[],
  category: MediaCategory,
  delayMs: number
) {
  let scrapedItems: MovieItem[] = [];

  const stored = await chrome.storage.local.get(['lastScrapedItems', 'scrapedItems']);
  const existingItems = stored.lastScrapedItems || stored.scrapedItems;
  if (Array.isArray(existingItems) && existingItems.length > 0) {
    scrapedItems = existingItems;
    await logMessage(`Используем ранее собранную базу: ${scrapedItems.length} элементов`, 'info');
  } else {
    scrapedItems = await collectKinopoiskItems(category, delayMs);
  }

  if (scrapedItems.length === 0) {
    await updateState({ status: 'completed', currentTitle: undefined });
    await logMessage('Нет элементов для синхронизации.', 'info');
    return;
  }

  const enabledTargets = targets.filter(
    (t) => t === 'tmdb' || t === 'trakt' || t === 'simkl' || t === 'kinopoisk'
  );

  if (enabledTargets.length === 0) {
    await updateState({ status: 'idle', currentTitle: undefined });
    await logMessage('Нет активных API-сервисов для синхронизации.', 'warn');
    return;
  }

  // Initialize per-target progress in state
  const targetProgressMap = new Map<ServiceId, TargetProgress>();
  for (const t of enabledTargets) {
    targetProgressMap.set(t, {
      service: t,
      synced: 0,
      skipped: 0,
      failed: 0,
      total: 0,
      status: 'running',
    });
  }

  await updateState({
    status: 'migrating',
    targets: Array.from(targetProgressMap.values()),
    syncedCount: 0,
    skippedCount: 0,
    failedCount: 0,
  });

  const aggregateProgress = async () => {
    let sumSynced = 0;
    let sumSkipped = 0;
    let sumFailed = 0;
    const progressList = Array.from(targetProgressMap.values());
    for (const p of progressList) {
      sumSynced += p.synced;
      sumSkipped += p.skipped;
      sumFailed += p.failed;
    }
    await updateState({
      targets: progressList,
      syncedCount: sumSynced,
      skippedCount: sumSkipped,
      failedCount: sumFailed,
    });
  };
  /**
   * Spacing delay for Kinopoisk DOM automation writes (3500ms base + 1500ms jitter).
   * Kinopoisk employs bot detection and GraphQL rate limits (SmartCaptcha and Cloudflare/Yandex shields).
   * Firing consecutive ratings or watchlist mutations too quickly triggers captcha verification
   * or account restrictions. This spacing ensures operations look human and stay within limits.
   */
  const KINOPOISK_WRITE_DELAY_BASE_MS = 3500;
  const KINOPOISK_WRITE_DELAY_JITTER_MS = 1500;

  const getKinopoiskDelay = (): number => {
    return KINOPOISK_WRITE_DELAY_BASE_MS + Math.floor(Math.random() * KINOPOISK_WRITE_DELAY_JITTER_MS);
  };


  // Run per-target independently
  const runTarget = async (serviceId: ServiceId) => {
    const progress = targetProgressMap.get(serviceId)!;

    let port: MediaServicePort;
    try {
      port = await getPortForService(serviceId);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      progress.status = 'failed';
      progress.error = errMsg;
      await logMessage(`[${serviceId}] Ошибка инициализации сервиса: ${errMsg}`, 'error');
      await aggregateProgress();
      return;
    }
    if (serviceId === 'kinopoisk') {
      try {
        const tabId = await ensureKinopoiskTab();
        const authResults = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => {
            // Self-contained check for Kinopoisk logged-in status
            const avatar = document.querySelector(
              '[class*=avatar], [class*=user-dropdown], [class*=user_profile], a[href*="/user/"]'
            );
            const loginBtn = Array.from(document.querySelectorAll('button, a')).find(
              (el) => el.textContent && el.textContent.trim().toLowerCase() === 'войти'
            );
            return { isLoggedIn: !loginBtn || !!avatar };
          },
        });
        const auth = authResults[0]?.result;
        if (auth && !auth.isLoggedIn) {
          progress.status = 'failed';
          progress.error = 'AUTH_EXPIRED';
          await logMessage('[kinopoisk] Пользователь не авторизован на Кинопоиске (AUTH_EXPIRED)', 'error');
          await aggregateProgress();
          return;
        }
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        progress.status = 'failed';
        progress.error = errMsg;
        await logMessage(`[kinopoisk] Вкладка Кинопоиска недоступна: ${errMsg}`, 'error');
        await aggregateProgress();
        return;
      }
    }


    let existingRatings = new Map<string, number>();
    let existingWatchlist = new Set<string>();

    try {
      await logMessage(`[${serviceId}] Загрузка существующих оценок и списка "Буду смотреть"...`, 'info');
      const [ratings, watchlist] = await Promise.all([
        port.fetchExistingRatings().catch((err: unknown) => {
          if (isAuthExpiredError(err)) throw err;
          logMessage(`[${serviceId}] Не удалось загрузить существующие оценки: ${err}`, 'warn');
          return new Map<string, number>();
        }),
        port.fetchExistingWatchlist().catch((err: unknown) => {
          if (isAuthExpiredError(err)) throw err;
          logMessage(`[${serviceId}] Не удалось загрузить существующий Watchlist: ${err}`, 'warn');
          return new Set<string>();
        }),
      ]);
      existingRatings = ratings;
      existingWatchlist = watchlist;
      await logMessage(
        `[${serviceId}] Найдено: ${existingRatings.size} оценок, ${existingWatchlist.size} в Watchlist`,
        'info'
      );
    } catch (err: unknown) {
      if (isAuthExpiredError(err)) {
        progress.status = 'failed';
        progress.error = 'AUTH_EXPIRED';
        await logMessage(`[${serviceId}] Авторизация истекла (AUTH_EXPIRED)`, 'error');
        await aggregateProgress();
        return;
      }
      const errMsg = err instanceof Error ? err.message : String(err);
      await logMessage(`[${serviceId}] Ошибка загрузки существующих данных: ${errMsg}`, 'warn');
    }

    for (const item of scrapedItems) {
      if (isAborted || isSyncAborted) {
        await logMessage(`[${serviceId}] Синхронизация прервана пользователем.`, 'warn');
        progress.status = 'skipped';
        await aggregateProgress();
        return;
      }

      if (isPaused) {
        while (isPaused && !isAborted && !isSyncAborted) {
          await sleep(1000);
        }
        if (isAborted || isSyncAborted) {
          await logMessage(`[${serviceId}] Синхронизация прервана пользователем.`, 'warn');
          progress.status = 'skipped';
          await aggregateProgress();
          return;
        }
      }

      await updateState({ currentTitle: `[${serviceId}] ${item.title} (${item.year || '?'})` });

      // Kinopoisk Unofficial enrichment if needed
      const kinopoiskId = item.kpId || item.id;
      if (kpClient && kinopoiskId && !item.imdbId) {
        try {
          const details = await kpClient.getFilmDetails(kinopoiskId);
          if (details) {
            if (details.imdbId) item.imdbId = details.imdbId;
            if (details.nameOriginal && !item.originalTitle) item.originalTitle = details.nameOriginal;
          }
        } catch {
          // ignore enrichment error
        }
      }

      let ref: ServiceRef | null = null;
      try {
        ref = await port.resolve(item);
      } catch (err: unknown) {
        if (isAuthExpiredError(err)) {
          progress.status = 'failed';
          progress.error = 'AUTH_EXPIRED';
          await logMessage(`[${serviceId}] Авторизация истекла при поиске "${item.title}"`, 'error');
          await aggregateProgress();
          return;
        }
        progress.failed++;
        await aggregateProgress();
        const errMsg = err instanceof Error ? err.message : String(err);
        await logMessage(`[${serviceId}] Ошибка поиска "${item.title}": ${errMsg}`, 'warn');
        continue;
      }

      if (!ref) {
        progress.failed++;
        await aggregateProgress();
        await logMessage(`[${serviceId}] Не найден: "${item.title}" (${item.year || '?'})`, 'warn');
        continue;
      }

      const keys = dedupeKey(ref);
      if (item.category === 'ratings' && item.rating) {
        let isExisting = false;
        let existingVal: number | undefined;
        for (const k of keys) {
          if (existingRatings.has(k)) {
            isExisting = true;
            existingVal = existingRatings.get(k);
            break;
          }
        }

        if (isExisting) {
          progress.skipped++;
          await aggregateProgress();
          await logMessage(
            `[${serviceId}] Пропуск: "${item.title}" уже имеет оценку (${existingVal ?? '?'})`,
            'info'
          );
          continue;
        }

        try {
          await port.pushRating(ref, item.rating);
          for (const k of keys) {
            existingRatings.set(k, item.rating);
          }
          progress.synced++;
          await aggregateProgress();
          await logMessage(
            `[${serviceId}] Оценка выставлена: "${item.title}" -> ${ref.label || ref.id} (${item.rating})`,
            'success'
          );
        } catch (err: unknown) {
          if (isAuthExpiredError(err)) {
            progress.status = 'failed';
            progress.error = 'AUTH_EXPIRED';
            await logMessage(`[${serviceId}] Авторизация истекла при выставлении оценки`, 'error');
            await aggregateProgress();
            return;
          }
          progress.failed++;
          await aggregateProgress();
          const errMsg = err instanceof Error ? err.message : String(err);
          await logMessage(`[${serviceId}] Ошибка выставления оценки "${item.title}": ${errMsg}`, 'error');
        }
      } else if (item.category === 'watchlist') {
        let isExisting = false;
        for (const k of keys) {
          if (existingWatchlist.has(k)) {
            isExisting = true;
            break;
          }
        }

        if (isExisting) {
          progress.skipped++;
          await aggregateProgress();
          await logMessage(
            `[${serviceId}] Пропуск: "${item.title}" уже находится в Watchlist`,
            'info'
          );
          continue;
        }

        try {
          await port.pushWatchlist(ref);
          for (const k of keys) {
            existingWatchlist.add(k);
          }
          progress.synced++;
          await aggregateProgress();
          await logMessage(
            `[${serviceId}] Добавлено в Watchlist: "${item.title}" -> ${ref.label || ref.id}`,
            'success'
          );
        } catch (err: unknown) {
          if (isAuthExpiredError(err)) {
            progress.status = 'failed';
            progress.error = 'AUTH_EXPIRED';
            await logMessage(`[${serviceId}] Авторизация истекла при добавлении в Watchlist`, 'error');
            await aggregateProgress();
            return;
          }
          progress.failed++;
          await aggregateProgress();
          const errMsg = err instanceof Error ? err.message : String(err);
          await logMessage(`[${serviceId}] Ошибка добавления в Watchlist "${item.title}": ${errMsg}`, 'error');
        }
      }

      if (isAborted || isSyncAborted) {
        await logMessage(`[${serviceId}] Синхронизация прервана пользователем.`, 'warn');
        progress.status = 'skipped';
        await aggregateProgress();
        return;
      }

      const itemDelay = serviceId === 'kinopoisk' ? getKinopoiskDelay() : delayMs;
      await sleep(itemDelay);
    }

    progress.status = 'completed';
    await aggregateProgress();
    await logMessage(
      `[${serviceId}] Синхронизация завершена. Успешно: ${progress.synced}, пропущено: ${progress.skipped}, ошибок: ${progress.failed}`,
      'success'
    );
  };

  // Run all targets concurrently/independently
  await Promise.all(enabledTargets.map((t) => runTarget(t)));

  await chrome.storage.local.set({ lastScrapedItems: scrapedItems, scrapedItems });

  // Terminal status calculation
  if (isAborted || isSyncAborted) {
    await updateState({ status: 'idle', currentTitle: undefined });
    return;
  }

  const targetResults = Array.from(targetProgressMap.values());
  const anyCompleted = targetResults.some((t) => t.status === 'completed');
  const anyFailed = targetResults.some((t) => t.status === 'failed');

  let finalStatus: 'completed' | 'partial' | 'error' = 'completed';
  if (anyFailed && anyCompleted) {
    finalStatus = 'partial';
  } else if (anyFailed && !anyCompleted) {
    finalStatus = 'error';
  } else {
    finalStatus = 'completed';
  }

  await updateState({
    status: finalStatus,
    currentTitle: undefined,
  });

  await logMessage(
    `Все задачи синхронизации завершены со статусом: ${finalStatus}.`,
    finalStatus === 'completed' ? 'success' : finalStatus === 'partial' ? 'warn' : 'error'
  );
}
