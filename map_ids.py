"""Стадия 2. Маппинг: kinopoisk id -> tmdb id (через kinopoisk.dev).

Запуск:
    python map_ids.py            # докачивается с чекпоинта
    python map_ids.py --limit 5  # тест

kinopoisk.dev: /v1.4/movie/{kp_id} -> {externalId: {tmdbId, imdbId}, type}
type: film->movie, TV_SERIES/MINI_SERIES/TV_SHOW->tv, мультфильмы -> movie.

Требуется KINOPOISK_DEV_TOKEN в .env (бот @kinopoiskdev_bot).
"""
from __future__ import annotations

import argparse
import os
import sys
import time

import requests
from dotenv import load_dotenv
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

from common import RAW_VOTES, RAW_LISTS, MAPPED, load_json, save_json

load_dotenv()

KPD_TOKEN = os.environ.get("KINOPOISK_DEV_TOKEN", "").strip()
KPD_BASE = "https://api.kinopoisk.dev"

TV_TYPES = {"TV_SERIES", "MINI_SERIES", "TV_SHOW"}


class RateLimited(Exception):
    pass


@retry(retry=retry_if_exception_type((RateLimited, requests.RequestException)),
       wait=wait_exponential(multiplier=2, min=2, max=60), stop=stop_after_attempt(6))
def kpd_get(session: requests.Session, path: str) -> dict:
    r = session.get(f"{KPD_BASE}{path}",
                    headers={"X-API-KEY": KPD_TOKEN, "accept": "application/json"},
                    timeout=30)
    if r.status_code == 429:
        raise RateLimited("429")
    r.raise_for_status()
    return r.json()


def classify_media(kpd_movie: dict, fallback_media: str) -> str:
    t = (kpd_movie.get("type") or "").upper()
    if t in TV_TYPES or t == "ANIMATED_SERIES":
        return "tv"
    if t in {"MOVIE", "CARTOON", "ANIME", "VIDEO"}:
        return "movie"
    return fallback_media


def map_one(session: requests.Session, item: dict) -> dict:
    out = dict(item)
    out.update({"tmdb_id": None, "imdb_id": None, "status": "unmapped"})
    try:
        data = kpd_get(session, f"/v1.4/movie/{item['kp_id']}")
    except Exception as e:
        out["status"] = f"error: {type(e).__name__}"
        return out
    ext = data.get("externalId") or {}
    out["imdb_id"] = ext.get("imdb")
    out["tmdb_id"] = ext.get("tmdb")
    out["media"] = classify_media(data, item.get("media", "movie"))
    out["status"] = "ok" if out["tmdb_id"] else "no_tmdb_id"
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="обработать только N записей (тест)")
    args = ap.parse_args()

    if not KPD_TOKEN:
        print("Нет KINOPOISK_DEV_TOKEN в .env. Токен: Telegram @kinopoiskdev_bot -> /start -> /token")
        return 1

    votes = load_json(RAW_VOTES, [])
    lists = load_json(RAW_LISTS, [])
    if not votes and not lists:
        print("Нет данных. Сначала: python export_kp.py --user-id <ID>")
        return 1

    # очередь всех уникальных kp_id
    queue: dict[int, dict] = {}
    for v in votes:
        queue[v["kp_id"]] = v
    for l in lists:
        for it in l["items"]:
            queue.setdefault(it["kp_id"], it)

    done = {m["kp_id"]: m for m in load_json(MAPPED, [])}
    todo = [q for q in queue.values() if q["kp_id"] not in done]
    if args.limit:
        todo = todo[:args.limit]

    print(f"Всего уникальных: {len(queue)}, уже смаплено: {len(done)}, осталось: {len(todo)}")

    s = requests.Session()
    results: list[dict] = []
    for i, item in enumerate(todo, 1):
        m = map_one(s, item)
        results.append(m)
        if i % 25 == 0 or i == len(todo):
            done.update({r["kp_id"]: r for r in results})
            save_json(MAPPED, list(done.values()))
            ok = sum(1 for r in results if r["status"] == "ok")
            print(f"  {i}/{len(todo)} (ok: {ok})")
    # финальный merge
    done.update({r["kp_id"]: r for r in results})
    save_json(MAPPED, list(done.values()))

    ok = sum(1 for m in done.values() if m["status"] == "ok")
    no_tmdb = sum(1 for m in done.values() if m["status"] == "no_tmdb_id")
    err = sum(1 for m in done.values() if m["status"].startswith("error"))
    print(f"\nГотово: ok={ok}, no_tmdb_id={no_tmdb}, errors={err} -> {MAPPED.name}")
    if err:
        print("Ошибки докачаются при повторном запуске: python map_ids.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())