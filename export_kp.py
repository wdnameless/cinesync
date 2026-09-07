"""Стадия 1. Выгрузка оценок и списков из Кинопоиска через Playwright.

Запуск:
    python export_kp.py --user-id <ID>

Логин: скрипт открывает окно Кинопоиска; если вы не залогинены — войдите
вручную (Yandex ID), скрипт дождётся и продолжит. Сессия живёт в .pw-profile/
(повторный запуск не потребует входа, пока cookies живы).

Результат:
    data/kp_votes.json — все оценки
    data/kp_lists.json — папки/списки профиля
"""
from __future__ import annotations

import argparse
import json
import re
import sys

from playwright.sync_api import sync_playwright, Page, TimeoutError as PWTimeout

from common import RAW_VOTES, RAW_LISTS, UA, human_delay, save_json, load_json

BASE = "https://www.kinopoisk.ru"
CAPTCHA_MARKERS = ("SmartCaptcha", "captcha-redirect", "showcaptcha")


def captcha_hit(resp) -> bool:
    return resp.status in (302, 403) or any(
        m in (resp.url or "") for m in CAPTCHA_MARKERS
    )


def goto(page: Page, url: str, attempts: int = 3):
    """Навигация с детекцией капчи/редиректов. Возвращает True при успехе."""
    for i in range(attempts):
        try:
            resp = page.goto(url, wait_until="domcontentloaded", timeout=60_000)
        except PWTimeout:
            print(f"  timeout, retry {i + 1}/{attempts}: {url}")
            continue
        if resp is None:
            continue
        if captcha_hit(resp):
            if i == attempts - 1:
                print("  !! Похоже на капчу/403. Откройте страницу в окне браузера, "
                      "решите капчу вручную и перезапустите — прогресс сохранён.")
                return False
            human_delay(15, 30)
            continue
        return True
    return False


def extract_uid(page: Page) -> str | None:
    m = re.search(r"/user/(\d+)", page.url)
    return m.group(1) if m else None


def wait_login(page: Page, start_url: str, user_id: str) -> bool:
    """Открывает страницу оценок; если нас редиректит на SSO — ждём ручной вход."""
    goto(page, start_url)
    if f"/user/{user_id}/" in page.url:
        return True
    print("\n>>> Не залогинены. В открывшемся окне браузера войдите в Кинопоиск")
    print(">>> (Yandex ID). Скрипт ждёт до 10 минут...\n")
    for _ in range(600):
        page.wait_for_timeout(1_000)
        if f"/user/{user_id}/" in page.url:
            return True
    print(">> Таймаут ожидания входа.")
    return False


# ---------------------------------------------------------------- network hook

JSON_URL_RE = re.compile(r"/user/\d+/(movies/voted-watched|movies/planned-to-watch|lists|votes)")


def install_collector(page: Page, bucket: dict):
    """Перехватываем JSON-ответы SPA: страницы оценок/списков отдают данные
    и через сетевые API, и в серверном рендере. Всё складываем в bucket."""

    def on_response(resp):
        url = resp.url
        if "kinopoisk.ru" not in url:
            return
        ctype = resp.headers.get("content-type", "")
        if "json" not in ctype:
            return
        if not (JSON_URL_RE.search(url) or "/web-api/" in url or "voted-watched" in url):
            return
        try:
            body = resp.json()
        except Exception:
            return
        bucket.setdefault("responses", []).append({"url": url, "body": body})

    page.on("response", on_response)


def normalize_item(it: dict, media: str) -> dict | None:
    """Приводим элемент к общему виду из разных форматов ответа Кинопоиска."""
    kp_id = it.get("id") or it.get("filmId") or it.get("movieId") or it.get("data", {}).get("id")
    if not kp_id:
        return None
    title = (it.get("title") or it.get("nameRu")
             or it.get("data", {}).get("title") or "").strip()
    orig = (it.get("originalTitle") or it.get("nameEn")
            or it.get("data", {}).get("originalTitle") or "").strip()
    year = it.get("year") or it.get("productionYear") or it.get("data", {}).get("year")
    return {
        "kp_id": int(kp_id),
        "title": title or orig,
        "title_orig": orig,
        "year": year,
        "media": media,  # movie | tv
    }


# ---------------------------------------------------------------- votes

VOTE_VAL_RE = re.compile(r"(\d+)\s*$")


def scrape_votes(page: Page, user_id: str) -> list[dict]:
    """Парсим пагинацию страницы оценок: /user/<id>/movies/voted-watched/"""
    votes: dict[int, dict] = {}
    page_num = 1
    empty_streak = 0

    while True:
        url = f"{BASE}/user/{user_id}/movies/voted-watched/?page={page_num}"
        ok = goto(page, url)
        if not ok:
            break

        # 1) попытка из сетевых перехваченных ответов заполняется в bucket —
        #    но надёжнее парсить DOM карточек: у КП стабильная разметка карточки.
        cards = page.evaluate(
            """
            () => {
              const out = [];
              // новая вёрстка: карточки в списках оценок/просмотров
              document.querySelectorAll('a[href*="/film/"], a[href*="/series/"]')
                .forEach(a => {
                  const m = a.href.match(/\\/(film|series)\\/(\\d+)\\//);
                  if (!m) return;
                  const card = a.closest('div[class*="styles_root"]') || a.parentElement;
                  if (!card) return;
                  const text = card.innerText || "";
                  // моя оценка часто бейджем "8" или "Оценка: 8"
                  const rm = text.match(/(?:Оценка|оценка)[:\\s]*([1-9]|10)\\b/);
                  const badge = card.querySelector('[class*="rating"], [class*="Rating"]');
                  let rating = rm ? rm[1] : null;
                  if (!rating && badge) {
                    const bm = (badge.innerText || "").match(/^\\s*(10|[1-9])\\s*$/m);
                    rating = bm ? bm[1] : null;
                  }
                  out.push({
                    kind: m[1] === 'film' ? 'movie' : 'tv',
                    kp_id: m[2],
                    text: text.slice(0, 300),
                    rating,
                  });
                });
              return out;
            }
            """
        )
        added = 0
        for c in cards or []:
            kp_id = int(c["kp_id"])
            if kp_id in votes:
                continue
            votes[kp_id] = {
                "kp_id": kp_id,
                "media": c["kind"],
                "rating": int(c["rating"]) if c["rating"] else None,
                "text": c["text"],
            }
            added += 1

        print(f"  page {page_num}: +{added} (total {len(votes)})")
        if added == 0:
            empty_streak += 1
            if empty_streak >= 2:
                break
        else:
            empty_streak = 0

        page_num += 1
        human_delay()

    return list(votes.values())


def scrape_lists(page: Page, user_id: str) -> list[dict]:
    """Списки пользователя: /user/<id>/lists/ -> каждая папка отдельной страницей."""
    lists: list[dict] = []
    if not goto(page, f"{BASE}/user/{user_id}/lists/"):
        return lists
    human_delay(3, 5)

    links = page.evaluate(
        """
        () => Array.from(document.querySelectorAll('a[href*="/lists/"]'))
              .map(a => ({href: a.href, name: (a.innerText || '').trim()}))
              .filter(l => /\\/user\\/\\d+\\/lists\\/\\d+/.test(l.href))
        """
    )
    # дедуп по id папки
    seen: dict[str, dict] = {}
    for l in links or []:
        m = re.search(r"/user/\d+/lists/(\d+)", l["href"])
        if m:
            seen[m.group(1)] = {"id": m.group(1), "name": l["name"]}

    print(f"  найдено папок: {len(seen)}")
    for lid, meta in seen.items():
        human_delay(3, 6)
        items: dict[int, dict] = {}
        page_num = 1
        while True:
            url = f"{BASE}/user/{user_id}/lists/{lid}/?page={page_num}"
            if not goto(page, url):
                break
            cards = page.evaluate(
                """
                () => Array.from(document.querySelectorAll('a[href*="/film/"], a[href*="/series/"]'))
                      .map(a => {
                        const m = a.href.match(/\\/(film|series)\\/(\\d+)\\//);
                        return m ? {kind: m[1] === 'film' ? 'movie' : 'tv', kp_id: m[2],
                                    title: (a.getAttribute('alt') || a.innerText || '').trim()} : null;
                      }).filter(Boolean)
                """
            )
            added = 0
            for c in cards or []:
                kid = int(c["kp_id"])
                if kid not in items:
                    items[kid] = {"kp_id": kid, "media": c["kind"], "title": c["title"][:200]}
                    added += 1
            if added == 0:
                break
            page_num += 1
            human_delay()
        print(f"  папка '{meta['name']}': {len(items)} позиций")
        lists.append({"name": meta["name"] or f"list_{lid}", "kp_list_id": lid,
                      "items": list(items.values())})

    return lists


def main() -> int:
    ap = argparse.ArgumentParser(description="Экспорт оценок/списков Кинопоиска")
    ap.add_argument("--user-id", required=True, help="числовой ID профиля Кинопоиска")
    ap.add_argument("--headless", action="store_true", help="без окна (после первого входа)")
    args = ap.parse_args()

    from pathlib import Path
    profile = Path(__file__).resolve().parent / ".pw-profile"
    profile.mkdir(exist_ok=True)

    bucket: dict = {}
    with sync_playwright() as pw:
        launch_kw = dict(headless=args.headless, args=[
            "--disable-blink-features=AutomationControlled",
            f"--user-agent={UA}",
        ])
        browser = None
        if not args.headless:
            import os
            exe = os.environ.get("KP_BROWSER_PATH", "").strip()
            if exe and Path(exe).exists():
                browser = pw.chromium.launch_persistent_context(
                    str(profile), executable_path=exe, **launch_kw)
            else:
                browser = pw.chromium.launch_persistent_context(str(profile), **launch_kw)
        else:
            browser = pw.chromium.launch_persistent_context(str(profile), **launch_kw)

        page = browser.new_page()
        install_collector(page, bucket)

        if not wait_login(page, f"{BASE}/user/{args.user_id}/movies/voted-watched/",
                          args.user_id):
            browser.close()
            return 2

        print("\n== Оценки ==")
        votes = scrape_votes(page, args.user_id)
        # rating из DOM часто пустой — добираем из заголовка карточки text: "8"
        for v in votes:
            if v["rating"] is None and v["text"]:
                m = re.search(r"(?:^|\\n)\\s*(10|[1-9])\\s*(?:$|\\n)", v["text"])
                if m:
                    v["rating"] = int(m.group(1))
        save_json(RAW_VOTES, votes)
        print(f"Сохранено оценок: {len(votes)} -> {RAW_VOTES.name}")

        print("\n== Списки ==")
        lists = scrape_lists(page, args.user_id)
        save_json(RAW_LISTS, lists)
        total = sum(len(l["items"]) for l in lists)
        print(f"Сохранено папок: {len(lists)}, позиций: {total} -> {RAW_LISTS.name}")

        # сырые перехваченные JSON — на случай, если DOM-парсер что-то упустил
        if bucket.get("responses"):
            (Path("data") / "kp_raw_responses.json").write_text(
                json.dumps(bucket["responses"], ensure_ascii=False)[:5_000_000],
                encoding="utf-8")
            print(f"Доп. перехваченные JSON: {len(bucket['responses'])} шт -> data/kp_raw_responses.json")

        print("\nГотово. Окно браузера можно закрыть (Ctrl+C если висит).")
        try:
            page.wait_for_timeout(1500)
        except Exception:
            pass
        browser.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())