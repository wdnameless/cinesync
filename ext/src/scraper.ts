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
    document.title.toLowerCase().includes('капча') ||
    document.title.toLowerCase().includes('робот')
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
    document.title.toLowerCase().includes('капча') ||
    document.title.toLowerCase().includes('робот');

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

      if (!title || title.length < 2 || title.includes('VPN')) return;
      seenIds.add(kpId);

      // Extract rating if ratings category
      let rating: number | undefined = undefined;
      if (category === 'ratings') {
        const ratingNode = card.querySelector(
          'span[class*="styles_value__"], div[class*="styles_overlaySlot"] span, div[class*="vote_"], span[class*="rating"], [class*="myVote"], div[class*="userRating"], [data-tid="user-rating"]'
        );
        if (ratingNode) {
          const parsed = parseInt(ratingNode.textContent?.trim() || '', 10);
          if (!isNaN(parsed) && parsed >= 1 && parsed <= 10) {
            rating = parsed;
          }
        }
        // Fallback: check first numeric word in card text
        if (rating === undefined) {
          const lines = (card.innerText || '').split('\n').map((l) => l.trim()).filter(Boolean);
          if (lines.length > 0) {
            const num = parseInt(lines[0], 10);
            if (!isNaN(num) && num >= 1 && num <= 10) {
              rating = num;
            }
          }
        }
      }

      items.push({
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
