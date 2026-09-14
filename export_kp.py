"""Стадия 1. Выгрузка оценок. Скроллит профиль до конца и собирает данные."""
import argparse
import sys
import re
from pathlib import Path
from playwright.sync_api import sync_playwright, Page
from common import RAW_VOTES, UA, save_json

BASE = "https://www.kinopoisk.ru"

def is_logged_in(page: Page) -> bool:
    # Ищем ссылку на профиль в заголовке
    return page.query_selector('a[href*="/user/"]') is not None

def wait_login(page: Page) -> bool:
    page.goto(f"{BASE}/")
    if is_logged_in(page):
        return True
        
    print("\n>>> Не обнаружен вход. Войдите в аккаунт в открывшемся браузере...")
    print(">>> (Скрипт проверяет наличие вашего аватара в заголовке)")
    
    # Ждём до 5 минут
    for _ in range(300):
        page.wait_for_timeout(2_000)
        if is_logged_in(page):
            print(">>> Успешный вход обнаружен!")
            return True
    return False

def scrape_votes(page: Page, uid: str) -> list[dict]:
    url = f"{BASE}/user/{uid}/movies/voted-watched/"
    print(f">>> Скрейпим: {url}")
    page.goto(url)
    
    # Авто-скролл до упора
    last_h = 0
    while True:
        page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        page.wait_for_timeout(2000)
        h = page.evaluate("document.body.scrollHeight")
        if h == last_h: break
        last_h = h
        print(f"  ...листаем...")
    
    # Парсим карточки
    votes = page.evaluate("""() => {
        return Array.from(document.querySelectorAll('a[href*="/film/"], a[href*="/series/"]')).map(a => {
            const m = a.href.match(/\\/(film|series)\\/(\\d+)\\//);
            if (!m) return null;
            const card = a.closest('div[class*="styles_root"]') || a.parentElement;
            const txt = card ? card.innerText : "";
            const rm = txt.match(/(?:Оценка|оценка)[:\\s]*([1-9]|10)\\b/);
            return {
                kp_id: m[2],
                media: m[1] === 'film' ? 'movie' : 'tv',
                rating: rm ? parseInt(rm[1]) : null,
                title: a.innerText
            };
        }).filter(item => item !== null);
    }""")
    # Дедупликация
    dedup = {item["kp_id"]: item for item in votes}.values()
    return list(dedup)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--user-id", default="sacrificalwr")
    ap.add_argument("--headless", action="store_true")
    args = ap.parse_args()
    
    # Статическая папка профиля для сохранения сессии
    profile = Path(__file__).resolve().parent / ".kp-session"
    
    with sync_playwright() as pw:
        # headless=False принудительно, чтобы вы могли видеть окно и логиниться
        browser = pw.chromium.launch_persistent_context(str(profile), headless=False, 
            args=["--disable-blink-features=AutomationControlled", f"--user-agent={UA}"])
        page = browser.new_page()
        
        if not wait_login(page): return 1
        
        votes = scrape_votes(page, args.user_id)
        save_json(RAW_VOTES, votes)
        print(f"\nСохранено оценок: {len(votes)} -> data/kp_votes.json")
        browser.close()
    return 0

if __name__ == "__main__":
    sys.exit(main())