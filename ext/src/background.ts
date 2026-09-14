import {
  KPItem,
  MediaCategory,
  MigrationState,
  RuntimeMessage,
  TMDBAuth,
} from './types';
import { TMDBClient } from './tmdb';
import { KPClient } from './kpClient';
import { detectKinopoiskUserId, parseKinopoiskPage } from './scraper';

const DEFAULT_STATE: MigrationState = {
  status: 'idle',
  category: 'both',
  totalFound: 0,
  scrapedCount: 0,
  syncedCount: 0,
  failedCount: 0,
  logs: [],
};

let currentState: MigrationState = { ...DEFAULT_STATE };
chrome.storage.local.get(['migrationState'], (res) => {
  if (res.migrationState) {
    currentState = { ...DEFAULT_STATE, ...res.migrationState };
  }
});
let tmdbClient: TMDBClient | null = null;
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

// Load persisted state & credentials on startup
chrome.runtime.onInstalled.addListener(async () => {
  await initFromStorage();
});

chrome.runtime.onStartup.addListener(async () => {
  await initFromStorage();
});

async function initFromStorage() {
  const data = await chrome.storage.local.get(['migrationState', 'tmdbAuth', 'kpApiKey']);
  if (data.migrationState) {
    currentState = data.migrationState;
  }
  if (data.tmdbAuth?.apiKey) {
    tmdbClient = new TMDBClient(data.tmdbAuth);
  }
  if (data.kpApiKey) {
    kpClient = new KPClient(data.kpApiKey);
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
          tmdbClient = new TMDBClient(auth);
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
          const client = new TMDBClient({ apiKey: key });
          const valid = await client.pingKey();
          sendResponse({ success: true, valid });
          break;
        }

        case 'PING_KP_KEY': {
          const key = message.kpApiKey;
          const client = new KPClient(key);
          const valid = await client.pingKey();
          sendResponse({ success: true, valid });
          break;
        }

        case 'TMDB_START_AUTH': {
          if (!tmdbClient) {
            const data = await chrome.storage.local.get('tmdbAuth');
            if (data.tmdbAuth?.apiKey) {
              tmdbClient = new TMDBClient(data.tmdbAuth);
            } else {
              throw new Error('Сначала укажите API Key TMDB.');
            }
          }
          const requestToken = await tmdbClient.createRequestToken();
          await chrome.storage.local.set({ tmdbPendingToken: requestToken });
          const authUrl = `https://www.themoviedb.org/authenticate/${requestToken}`;
          await chrome.tabs.create({ url: authUrl });
          await logMessage('Открыта страница авторизации TMDB', 'info');
          sendResponse({ success: true, requestToken });
          break;
        }

        case 'TMDB_COMPLETE_AUTH': {
          if (!tmdbClient) {
            const data = await chrome.storage.local.get('tmdbAuth');
            if (data.tmdbAuth?.apiKey) {
              tmdbClient = new TMDBClient(data.tmdbAuth);
            } else {
              throw new Error('Клиент TMDB не инициализирован.');
            }
          }
          let token = message.requestToken;
          if (!token) {
            const pending = await chrome.storage.local.get('tmdbPendingToken');
            token = pending.tmdbPendingToken;
          }
          if (!token) {
            throw new Error('Отсутствует request_token для подтверждения.');
          }
          const sessionId = await tmdbClient.createSession(token);
          const data = await chrome.storage.local.get('tmdbAuth');
          const auth: TMDBAuth = { ...data.tmdbAuth, sessionId };
          await chrome.storage.local.set({ tmdbAuth: auth });
          
          let username = 'TMDB User';
          try {
            const acc = await tmdbClient.getAccountDetails(sessionId);
            if (acc?.username) username = acc.username;
          } catch {
            // ignore
          }
          await logMessage(`Авторизация TMDB успешно завершена! Пользователь: ${username}`, 'success');
          sendResponse({ success: true, sessionId, username });
          break;
        }

        case 'START_SCANNING': {
          isScanAborted = false;
          isPaused = false;
          runScanningOnly(message.category, message.delayMs || 2500).catch(async (err: unknown) => {
            const errMsg = err instanceof Error ? err.message : String(err);
            await logMessage(`Ошибка сбора данных: ${errMsg}`, 'error');
            await updateState({ status: 'error', errorMessage: errMsg });
          });
          sendResponse({ success: true });
          break;
        }

        case 'START_MIGRATION': {
          isSyncAborted = false;
          isAborted = false;
          isPaused = false;
          isSyncRunning = true;
          runMigration(message.category, message.delayMs || 2500).catch(async (err: unknown) => {
            const errMsg = err instanceof Error ? err.message : String(err);
            await logMessage(`Критическая ошибка миграции: ${errMsg}`, 'error');
            await updateState({ status: 'error', errorMessage: errMsg });
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
          await updateState({ status: 'idle', currentTitle: undefined });
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
          isPaused = false;
          currentState = { ...DEFAULT_STATE };
          await chrome.storage.local.set({ migrationState: currentState });
          sendResponse({ success: true });
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

async function collectKinopoiskItems(category: MediaCategory, delayMs: number): Promise<MovieItem[]> {
  await updateState({
    status: 'detecting',
    category,
    errorMessage: undefined,
  });

  const tabs = await chrome.tabs.query({ url: '*://*.kinopoisk.ru/*' });
  if (tabs.length === 0 || !tabs[0].id) {
    throw new Error('Откройте вкладку Кинопоиска в браузере.');
  }

  const kpTabId = tabs[0].id;
  await logMessage('Поиск профиля Кинопоиска...', 'info');

  const execRes = await chrome.scripting.executeScript({
    target: { tabId: kpTabId },
    func: detectKinopoiskUserId,
  });

  let userId = execRes?.[0]?.result;
  if (!userId) {
    await logMessage('ID пользователя не найден в DOM. Переход на профиль...', 'warn');
    await navigateTabAndWait(kpTabId, 'https://www.kinopoisk.ru/');
    await sleep(2000);
    const retryRes = await chrome.scripting.executeScript({
      target: { tabId: kpTabId },
      func: detectKinopoiskUserId,
    });
    userId = retryRes?.[0]?.result;
  }

  if (!userId) {
    throw new Error('Не удалось определить ID пользователя Кинопоиска. Убедитесь, что вы авторизованы.');
  }

  await updateState({ userId, status: 'scraping' });
  await logMessage(`Определен профиль Кинопоиска: ID ${userId}`, 'success');

  const categoriesToScrape: Array<'ratings' | 'watchlist'> =
    category === 'both' ? ['ratings', 'watchlist'] : [category];

  const scrapedItems: MovieItem[] = [];

  for (const cat of categoriesToScrape) {
    const catName = cat === 'ratings' ? 'Оценки' : 'Буду смотреть';
    await logMessage(`Начало сбора категории: ${catName}`, 'info');

    let page = 1;
    let consecutiveEmptyPages = 0;

    while (page <= 200) {
      if (isScanAborted) {
        await logMessage(`Сбор категории "${catName}" отменен пользователем.`, 'warn');
        isScanRunning = false;
        return scrapedItems;
      }
      if (isPaused) {
        while (isPaused && !isScanAborted) {
          await sleep(1000);
        }
        if (isScanAborted) {
          isScanRunning = false;
          return scrapedItems;
        }
      }
      const pageUrl =
        cat === 'ratings'
          ? `https://www.kinopoisk.ru/user/${userId}/movies/voted-watched/?page=${page}`
          : `https://www.kinopoisk.ru/user/${userId}/movies/planned-to-watch/?page=${page}`;

      await navigateTabAndWait(kpTabId, pageUrl);
      await sleep(delayMs);

      const pageRes = await chrome.scripting.executeScript({
        target: { tabId: kpTabId },
        func: parseKinopoiskPage,
        args: [cat],
      });

      const res = pageRes?.[0]?.result as ScrapedPageResult | undefined;

      if (!res) {
        page++;
        continue;
      }

      if (res.hasCaptcha) {
        isPaused = true;
        await updateState({ status: 'paused_captcha' });
        await logMessage(`Обнаружена капча Кинопоиска на странице ${page}! Решите её в браузере и нажмите "Продолжить".`, 'warn');
        while (isPaused) {
          await sleep(1000);
        }
        continue;
      }

      if (res.items.length === 0) {
        await logMessage(`Страница ${page} пуста (найдено 0 карточек, URL: ${res.url})`, 'info');
        consecutiveEmptyPages++;
        if (consecutiveEmptyPages >= 2) {
          await logMessage(`Категория "${catName}" завершена на странице ${page}`, 'info');
          break;
        }
      } else {
        consecutiveEmptyPages = 0;
        scrapedItems.push(...res.items);
        await updateState({
          scrapedCount: scrapedItems.length,
          totalFound: scrapedItems.length,
        });
        await logMessage(`Страница ${page}: собрано ${res.items.length} элементов (всего: ${scrapedItems.length})`, 'info');
      }

      page++;
    }
  }

  // Store all scraped items in storage so user can export CSV anytime
  await chrome.storage.local.set({ lastScrapedItems: scrapedItems, scrapedItems });
  return scrapedItems;
}

async function runScanningOnly(category: MediaCategory, delayMs: number) {
  const items = await collectKinopoiskItems(category, delayMs);
  await updateState({
    status: 'completed',
    currentTitle: undefined,
  });
  await logMessage(`Сканирование завершено! Собрано ${items.length} элементов Кинопоиска. Теперь доступен экспорт!`, 'success');
}

async function runMigration(category: MediaCategory, delayMs: number) {
  let scrapedItems: MovieItem[] = [];
  
  // If we already have items in storage from scanning, reuse them
  const stored = await chrome.storage.local.get(['lastScrapedItems', 'scrapedItems']);
  const existingItems = stored.lastScrapedItems || stored.scrapedItems;
  if (Array.isArray(existingItems) && existingItems.length > 0) {
    scrapedItems = existingItems;
    await logMessage(`Используем ранее собранную базу: ${scrapedItems.length} элементов`, 'info');
  } else {
    scrapedItems = await collectKinopoiskItems(category, delayMs);
  }

  if (!tmdbClient) {
    const data = await chrome.storage.local.get('tmdbAuth');
    if (data.tmdbAuth?.apiKey) {
      tmdbClient = new TMDBClient(data.tmdbAuth);
    } else {
      throw new Error('TMDB API Key не настроен. Настройте ключ в секции API.');
    }
  }

  // Step 2: TMDB Migration
  await updateState({ status: 'migrating' });
  await logMessage(`Начало переноса в TMDB. Всего к обработке: ${scrapedItems.length}`, 'info');
  let synced = 0;
  let failed = 0;
  let skipped = 0;

  // Preload existing ratings and watchlist from TMDB account to avoid duplicates
  await logMessage('Загрузка существующих оценок и списка отложенного из TMDB для сверки...', 'info');
  const [existingRatings, existingWatchlist] = await Promise.all([
    tmdbClient.getAllRatedIds().catch(() => new Map<string, number>()),
    tmdbClient.getAllWatchlistIds().catch(() => new Set<string>()),
  ]);
  await logMessage(`Найдено на TMDB: ${existingRatings.size} уже оцененных, ${existingWatchlist.size} в Watchlist. Дублей не будет.`, 'info');
  for (const item of scrapedItems) {
    if (isAborted) {
      await logMessage('Перенос в TMDB прерван пользователем.', 'warn');
      await updateState({ status: 'idle', currentTitle: undefined });
      return;
    }
    if (isPaused) {
      while (isPaused && !isAborted) {
        await sleep(1000);
      }
      if (isAborted) {
        await logMessage('Перенос в TMDB прерван пользователем.', 'warn');
        await updateState({ status: 'idle', currentTitle: undefined });
        return;
      }
    }
    await updateState({ currentTitle: `${item.title} (${item.year || '?'})` });

    const kinopoiskId = item.kpId || item.id;
    if (kpClient && kinopoiskId && !item.imdbId) {
      try {
        const details = await kpClient.getFilmDetails(kinopoiskId);
        if (details) {
          if (details.imdbId) item.imdbId = details.imdbId;
          if (details.nameOriginal && !item.originalTitle) item.originalTitle = details.nameOriginal;
        }
      } catch {
        // ignore enrichment error, proceed with normal search
      }
    }
    try {
      const match = await tmdbClient.findBestMatch(item);
      if (!match) {
        failed++;
        await updateState({ failedCount: failed });
        await logMessage(`Не найден в TMDB: "${item.title}" (${item.year || '?'})`, 'warn');
        continue;
      }

      const mediaKey = `${match.media_type}_${match.id}`;
      if (item.category === 'ratings' && item.rating) {
        const existingRating = existingRatings.get(mediaKey);
        if (existingRating !== undefined) {
          skipped++;
          await logMessage(`Пропуск: "${item.title}" уже имеет оценку на TMDB (${existingRating}/10)`, 'info');
          continue;
        }
        await tmdbClient.rateMedia(match.id, match.media_type, item.rating);
        existingRatings.set(mediaKey, item.rating);
        synced++;
        await updateState({ syncedCount: synced });
        await logMessage(`Оценка выставлена: "${item.title}" -> ${match.title || match.name} (${item.rating}/10)`, 'success');
      } else if (item.category === 'watchlist') {
        if (existingWatchlist.has(mediaKey)) {
          skipped++;
          await logMessage(`Пропуск: "${item.title}" уже находится в Watchlist TMDB`, 'info');
          continue;
        }
        await tmdbClient.addToWatchlist(match.id, match.media_type);
        existingWatchlist.add(mediaKey);
        synced++;
        await updateState({ syncedCount: synced });
        await logMessage(`Добавлено в Watchlist: "${item.title}" -> ${match.title || match.name}`, 'success');
      }
    } catch (err: unknown) {
      failed++;
      await updateState({ failedCount: failed });
      const errMsg = err instanceof Error ? err.message : String(err);
      await logMessage(`Ошибка отправки "${item.title}": ${errMsg}`, 'error');
    }

    if (isAborted) {
      await logMessage('Перенос в TMDB прерван пользователем.', 'warn');
      await updateState({ status: 'idle', currentTitle: undefined });
      return;
    }
    await sleep(delayMs);
  }

  await chrome.storage.local.set({ lastScrapedItems: scrapedItems, scrapedItems });

  await updateState({
    status: 'completed',
    currentTitle: undefined,
  });
  await logMessage(`Миграция завершена! Успешно: ${synced}, пропущено (уже есть): ${skipped}, ошибок/не найдено: ${failed}. Доступен экспорт!`, 'success');
}
