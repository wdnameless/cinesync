import type {
  CsvBundle,
  MediaServicePort,
  MovieItem,
  ServiceCapabilities,
  ServiceId,
  ServiceRef,
} from './port';

/**
 * Self-contained injected function to set a rating on a Kinopoisk film page.
 * Strictly uses stable DOM selectors:
 * - Change button: [class*=kinopoiskRatingSnippet] button with text "Изменить оценку"
 * - Form: form.film-rate-form
 * - Rating label: form.film-rate-form label[data-value="N"]
 * - Rating radio: form.film-rate-form input[name=star][value="N"]
 * - Verification: [class*=userRating] containing "Моя оценка" and the rating
 */
async function injectKinopoiskRating(
  targetRating: number
): Promise<{ success: boolean; error?: string; actualRating?: number }> {
  // If the film already has a rating, the rating form may be hidden behind "Изменить оценку"
  const snippets = Array.from(document.querySelectorAll('[class*=kinopoiskRatingSnippet] button'));
  const changeBtn = snippets.find((btn) => btn.textContent && btn.textContent.includes('Изменить оценку'));
  if (changeBtn) {
    (changeBtn as HTMLButtonElement).click();
  }

  // Find form.film-rate-form and click the radio label or radio input
  const form = document.querySelector('form.film-rate-form');
  const label = form?.querySelector(`label[data-value="${targetRating}"]`) as HTMLElement | null;
  const radio = form?.querySelector(`input[name="star"][value="${targetRating}"]`) as HTMLInputElement | null;

  if (label) {
    label.click();
  } else if (radio) {
    radio.click();
  } else {
    // Fallback: document query
    const docLabel = document.querySelector(`form.film-rate-form label[data-value="${targetRating}"]`) as HTMLElement | null;
    if (docLabel) {
      docLabel.click();
    } else {
      return {
        success: false,
        error: `Элемент оценки ${targetRating} не найден на странице`,
      };
    }
  }

  // Verification: Poll for [class*=userRating] containing "Моя оценка" and targetRating
  const maxWaitMs = 5000;
  const intervalMs = 250;
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    const userRatingEl = document.querySelector('[class*=userRating]');
    if (userRatingEl && userRatingEl.textContent && userRatingEl.textContent.includes('Моя оценка')) {
      const match = userRatingEl.textContent.match(/Моя оценка\D*(\d+)/i);
      if (match && parseInt(match[1], 10) === targetRating) {
        return { success: true, actualRating: targetRating };
      }
      if (userRatingEl.textContent.includes(String(targetRating))) {
        return { success: true, actualRating: targetRating };
      }
    }
  }

  const userRatingEl = document.querySelector('[class*=userRating]');
  const text = userRatingEl ? (userRatingEl.textContent || '').trim() : 'отсутствует';
  return {
    success: false,
    error: `Не удалось верифицировать оценку ${targetRating}. Текущее значение: "${text}"`,
  };
}

/**
 * Self-contained injected function to add a film to Kinopoisk watchlist.
 * Stable selector: a button whose text contains "Буду смотреть".
 * Verification: the button state changes (e.g., text changes to "В планах", aria-pressed changes, etc.)
 */
async function injectKinopoiskWatchlist(): Promise<{ success: boolean; error?: string }> {
  const buttons = Array.from(document.querySelectorAll('button'));
  const watchlistBtn = buttons.find(
    (b) => b.textContent && b.textContent.trim().includes('Буду смотреть')
  );

  if (!watchlistBtn) {
    // If button doesn't say "Буду смотреть", user might already have it in watchlist
    const isAlreadyInWatchlist = buttons.some(
      (b) => b.textContent && (b.textContent.includes('В планах') || b.textContent.includes('Смотрите'))
    );
    if (isAlreadyInWatchlist) {
      return { success: true };
    }
    return {
      success: false,
      error: 'Кнопка "Буду смотреть" не найдена на странице',
    };
  }

  const initialText = watchlistBtn.textContent || '';
  watchlistBtn.click();

  // Verification: wait for state change
  const maxWaitMs = 4000;
  const intervalMs = 250;
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    const currentBtn = Array.from(document.querySelectorAll('button')).find(
      (b) => b.textContent && b.textContent.trim().includes('Буду смотреть')
    );
    if (!currentBtn || currentBtn.textContent !== initialText) {
      return { success: true };
    }
    if (watchlistBtn.getAttribute('aria-pressed') === 'true') {
      return { success: true };
    }
  }

  return {
    success: false,
    error: 'Состояние кнопки "Буду смотреть" не изменилось после клика',
  };
}

/**
 * Self-contained injected function to read rating and watchlist status from the current film page.
 */
function injectKinopoiskPageStatus(): {
  filmId: string | null;
  rating: number | null;
  inWatchlist: boolean;
} {
  const match = window.location.pathname.match(/\/(?:film|series)\/(\d+)/);
  const filmId = match ? match[1] : null;

  let rating: number | null = null;
  const userRatingEl = document.querySelector('[class*=userRating]');
  if (userRatingEl && userRatingEl.textContent && userRatingEl.textContent.includes('Моя оценка')) {
    const rateMatch = userRatingEl.textContent.match(/Моя оценка\D*(\d+)/i);
    if (rateMatch) {
      rating = parseInt(rateMatch[1], 10);
    }
  }

  const hasWatchlistBtn = Array.from(document.querySelectorAll('button')).some(
    (b) => b.textContent && b.textContent.trim() === 'Буду смотреть'
  );
  const inWatchlist = !hasWatchlistBtn && !!filmId;

  return { filmId, rating, inWatchlist };
}

/**
 * Helper to navigate a tab and wait until loading is complete.
 */
async function navigateTabAndWait(tabId: number, targetUrl: string): Promise<void> {
  const tab = await chrome.tabs.get(tabId);
  if (tab.url && (tab.url === targetUrl || tab.url.startsWith(targetUrl))) {
    return;
  }

  await chrome.tabs.update(tabId, { url: targetUrl });
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, 15000);

    function listener(updatedTabId: number, info: chrome.tabs.TabChangeInfo) {
      if (updatedTabId === tabId && info.status === 'complete') {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }

    chrome.tabs.onUpdated.addListener(listener);
  });
}

export interface KinopoiskPortOptions {
  tabId?: number;
}

/**
 * Kinopoisk browser-automation write target adapter.
 * Interacts with a live Kinopoisk tab via chrome.scripting.executeScript.
 */
export class KinopoiskPort implements MediaServicePort {
  readonly id: ServiceId = 'kinopoisk';
  readonly label: string = 'Кинопоиск';

  readonly capabilities: ServiceCapabilities = {
    canRate: true,
    canWatchlist: true,
    requiresAuth: true,
    writeMode: 'api',
  };

  /** Marker indicating this port performs browser-automation rather than direct HTTP requests */
  readonly automation: boolean = true;

  private tabId?: number;

  constructor(options?: KinopoiskPortOptions) {
    this.tabId = options?.tabId;
  }

  setTabId(tabId: number): void {
    this.tabId = tabId;
  }

  private async getTabId(): Promise<number> {
    if (this.tabId !== undefined) {
      try {
        const tab = await chrome.tabs.get(this.tabId);
        if (tab?.id) return tab.id;
      } catch {
        // Tab closed or invalid; discover another tab
      }
    }

    const tabs = await chrome.tabs.query({ url: ['*://*.kinopoisk.ru/*'] });
    if (tabs.length > 0 && tabs[0].id) {
      this.tabId = tabs[0].id;
      return tabs[0].id;
    }

    throw new Error('Не найдена открытая вкладка Кинопоиска. Пожалуйста, откройте Кинопоиск.');
  }

  /**
   * Resolves true when a Kinopoisk tab exists in the browser, else false.
   * No network call is made.
   */
  async ping(): Promise<boolean> {
    const tabs = await chrome.tabs.query({ url: ['*://*.kinopoisk.ru/*'] });
    return tabs.length > 0;
  }

  /**
   * Resolves a Kinopoisk item to a ServiceRef using its existing kpId / id.
   */
  async resolve(item: MovieItem): Promise<ServiceRef | null> {
    const rawId = item.kpId ?? item.id;
    if (!rawId) return null;

    const mediaType: 'movie' | 'tv' = item.type === 'series' ? 'tv' : 'movie';
    return {
      service: 'kinopoisk',
      id: String(rawId),
      mediaType,
      label: item.title,
    };
  }

  /**
   * Injects rating automation into the Kinopoisk tab and verifies persistence.
   */
  async pushRating(ref: ServiceRef, rating: number): Promise<void> {
    const tabId = await this.getTabId();
    const filmUrl = `https://www.kinopoisk.ru/film/${ref.id}/`;
    await navigateTabAndWait(tabId, filmUrl);

    const injectionResults = await chrome.scripting.executeScript({
      target: { tabId },
      func: injectKinopoiskRating,
      args: [rating],
    });

    const result = injectionResults[0]?.result;
    if (!result?.success) {
      throw new Error(
        result?.error || `Не удалось выставить оценку ${rating} для Кинопоиск ID ${ref.id}`
      );
    }
  }

  /**
   * Injects watchlist automation into the Kinopoisk tab and verifies state change.
   */
  async pushWatchlist(ref: ServiceRef): Promise<void> {
    const tabId = await this.getTabId();
    const filmUrl = `https://www.kinopoisk.ru/film/${ref.id}/`;
    await navigateTabAndWait(tabId, filmUrl);

    const injectionResults = await chrome.scripting.executeScript({
      target: { tabId },
      func: injectKinopoiskWatchlist,
    });

    const result = injectionResults[0]?.result;
    if (!result?.success) {
      throw new Error(
        result?.error || `Не удалось добавить фильм ${ref.id} в "Буду смотреть"`
      );
    }
  }

  /**
   * Injects a status reader to inspect current page ratings.
   */
  async fetchExistingRatings(): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    try {
      const tabId = await this.getTabId();
      const injectionResults = await chrome.scripting.executeScript({
        target: { tabId },
        func: injectKinopoiskPageStatus,
      });
      const data = injectionResults[0]?.result;
      if (data?.filmId && data.rating) {
        map.set(data.filmId, data.rating);
        map.set(`movie_${data.filmId}`, data.rating);
        map.set(`movie:${data.filmId}`, data.rating);
        map.set(`tv_${data.filmId}`, data.rating);
        map.set(`tv:${data.filmId}`, data.rating);
      }
    } catch {
      // Tab unavailable or not on a film page
    }
    return map;
  }

  /**
   * Injects a status reader to inspect current page watchlist state.
   */
  async fetchExistingWatchlist(): Promise<Set<string>> {
    const set = new Set<string>();
    try {
      const tabId = await this.getTabId();
      const injectionResults = await chrome.scripting.executeScript({
        target: { tabId },
        func: injectKinopoiskPageStatus,
      });
      const data = injectionResults[0]?.result;
      if (data?.filmId && data.inWatchlist) {
        set.add(data.filmId);
        set.add(`movie_${data.filmId}`);
        set.add(`movie:${data.filmId}`);
        set.add(`tv_${data.filmId}`);
        set.add(`tv:${data.filmId}`);
      }
    } catch {
      // Tab unavailable or not on a film page
    }
    return set;
  }

  /**
   * Kinopoisk does not support CSV export.
   */
  exportCsv(_items: MovieItem[]): CsvBundle[] {
    throw new Error('Kinopoisk does not support CSV export');
  }
}
