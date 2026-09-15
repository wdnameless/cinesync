import { KPItem } from './types';

/**
 * Checks if current page is blocked by Yandex/Kinopoisk SmartCaptcha.
 * NOTE: When injected via chrome.scripting.executeScript, functions must be self-contained!
 */
function checkCaptchaInternal(): boolean {
  return (
    window.location.href.includes('showcaptcha') ||
    document.querySelector('.CheckboxCaptcha') !== null ||
    document.querySelector('#captcha-container') !== null ||
    // Modern Yandex SmartCaptcha renders as an iframe; the legacy class names
    // above are still shipped by Kinopoisk's server-rendered pages but are not
    // what the challenge actually uses today.
    document.querySelector('iframe[src*="captcha"]') !== null ||
    document.querySelector('[class*="SmartCaptcha"]') !== null ||
    document.querySelector('[data-testid*="captcha"]') !== null ||
    document.title.toLowerCase().includes('капча') ||
    document.title.toLowerCase().includes('робот') ||
    document.title.toLowerCase().includes('antirobot')
  );
}

export function isCaptchaPage(): boolean {
  return checkCaptchaInternal();
}

/**
 * Executes inside Kinopoisk page context via chrome.scripting.executeScript.
 * Detects the logged-in user ID or profile slug from DOM, navigation links, or user avatar.
 * MUST BE COMPLETELY SELF-CONTAINED (no closure outer dependencies).
 */
export function detectKinopoiskUserId(): string | null {
  try {
    // 1. Check current location first if user is already on their profile or movies list
    const locMatch = window.location.href.match(/\/user\/([^\/\?#]+)/);
    if (locMatch && locMatch[1] && locMatch[1] !== 'undefined' && locMatch[1] !== 'null') {
      return locMatch[1];
    }

    // 2. Check user avatar / profile link
    const profileLinks = document.querySelectorAll<HTMLAnchorElement>(
      'a[href*="/user/"], a[href*="/profile/"]'
    );

    for (const a of profileLinks) {
      const match = a.href.match(/\/user\/([^\/\?#]+)/);
      if (match && match[1] && match[1] !== 'undefined' && match[1] !== 'null') {
        return match[1];
      }
    }

    // 3. Check scripts / state
    const scripts = document.querySelectorAll('script');
    for (const s of scripts) {
      const text = s.textContent || '';
      const m = text.match(/"userId":\s*"?(\d+)"?/);
      if (m && m[1]) return m[1];
      const m2 = text.match(/user\/([^\/\?#]+)\//);
      if (m2 && m2[1] && m2[1] !== 'undefined') return m2[1];
    }
  } catch {
    // Ignore errors
  }

  return null;
}

/**
 * Injected scraper function to extract items from the current page of voted or planned movies.
 * MUST BE COMPLETELY SELF-CONTAINED (no closure outer dependencies).
 */
export function parseKinopoiskPage(category: 'ratings' | 'watchlist'): {
  items: KPItem[];
  hasCaptcha: boolean;
  totalCountOnPage: number;
} {
  // Check captcha inlined
  const hasCaptcha =
    window.location.href.includes('showcaptcha') ||
    document.querySelector('.CheckboxCaptcha') !== null ||
    document.querySelector('#captcha-container') !== null ||
    document.querySelector('iframe[src*="captcha"]') !== null ||
    document.querySelector('[class*="SmartCaptcha"]') !== null ||
    document.querySelector('[data-testid*="captcha"]') !== null ||
    document.title.toLowerCase().includes('капча') ||
    document.title.toLowerCase().includes('робот') ||
    document.title.toLowerCase().includes('antirobot');

  if (hasCaptcha) {
    return { items: [], hasCaptcha: true, totalCountOnPage: 0 };
  }

  const items: KPItem[] = [];
  const seenIds = new Set<string>();

  // 1. Modern selector: look for film / series links directly
  const filmAnchors = document.querySelectorAll<HTMLAnchorElement>('a[href*="/film/"], a[href*="/series/"]');

  filmAnchors.forEach((a) => {
    try {
      const m = a.href.match(/\/(film|series)\/(\d+)/);
      if (!m || !m[2]) return;
      const kpId = m[2];
      if (kpId === '0' || seenIds.has(kpId)) return;

      // Find the card container
      const card =
        a.closest<HTMLElement>('div[class*="styles_item__"], div[class*="styles_poster__"], div[class*="styles_contentItem__"], div[class*="styles_root__"], .item, [data-tid="film-item"]') ||
        a.parentElement;
      if (!card) return;

      let title = '';
      let originalTitle: string | undefined = undefined;
      let year: number | undefined = undefined;

      // Try image alt (Kinopoisk standard: "Бьютифул. 2009, драма")
      const img = card.querySelector<HTMLImageElement>('img');
      const altText = img?.getAttribute('alt')?.trim();

      if (altText && altText.includes('.')) {
        const parts = altText.split('.');
        title = parts[0].trim();
        const yearMatch = parts.slice(1).join('.').match(/(19\d\d|20\d\d)/);
        if (yearMatch) year = parseInt(yearMatch[1], 10);
      } else if (altText) {
        const matchYear = altText.match(/\((\d{4})\)/);
        if (matchYear) year = parseInt(matchYear[1], 10);
        title = altText.replace(/\s*\(\d{4}\).*$/, '').replace(/\.$/, '').trim();
      }

      // If still no title, parse card text lines
      if (!title || title.length < 2) {
        const cardText = card.innerText || '';
        const lines = cardText.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
        for (const line of lines) {
          if (!isNaN(Number(line)) && line.length <= 2) continue; // skip rating number
          if (!title) {
            title = line;
          } else if (!year) {
            const ym = line.match(/(19\d\d|20\d\d)/);
            if (ym) year = parseInt(ym[1], 10);
          }
        }
      }

      // The original (usually English) title, when the card carries it. This is
      // the single strongest matching signal downstream, so it is worth the
      // extra query — but only text that is actually Latin script qualifies,
      // because a second Russian line is a subtitle, not an original title.
      if (!originalTitle) {
        const originalNode = card.querySelector(
          '[class*="styles_originalTitle"], [class*="originalTitle"], [class*="subtitle"]'
        );
        const candidate = originalNode?.textContent?.trim() ?? '';
        if (candidate.length >= 2 && /[A-Za-z]/.test(candidate) && !/[А-Яа-яЁё]/.test(candidate)) {
          originalTitle = candidate.replace(/\s*\(\d{4}\).*$/, '').trim() || undefined;
        }
      }

      if (!title || title.length < 2 || title.includes('VPN')) return;
      seenIds.add(kpId);

      // Extract rating if ratings category.
      //
      // Only a node that *declares itself* the user's rating is trusted. On the
      // desktop votes page the card's first text line is the table row number
      // (1..25), so a positional "first number in the card" fallback invents a
      // rating for every unparsed card — and the scraper runs on exactly that
      // page. Wrong ratings are worse than missing ones here: a wrong rating is
      // pushed to a real account, a missing one just shows up as unrated.
      let rating: number | undefined = undefined;
      if (category === 'ratings') {
        const ratingNode = card.querySelector(
          '[class*="myVote"], [class*="userRating"], [data-tid="user-rating"], [class*="styles_userRating"]'
        );
        const rawRating = ratingNode?.textContent?.trim() ?? '';
        const parsed = parseInt(rawRating.replace(/[^\d]/g, ''), 10);
        if (!Number.isNaN(parsed) && parsed >= 1 && parsed <= 10) {
          rating = parsed;
        }
      }

      items.push({
        id: kpId,
        kpId,
        title,
        originalTitle,
        year,
        rating,
        category,
        url: a.href,
        type: a.href.includes('/series/') ? 'series' : 'film'
      });
    } catch {
      // Ignore individual card parse errors
    }
  });

  return {
    items,
    hasCaptcha: false,
    totalCountOnPage: items.length
  };
}
