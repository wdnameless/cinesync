"""Стадия 3. Заливка в TMDB: оценки, watchlist, пользовательские списки.

Запуск:
    python migrate.py login-tmdb        # получит session_id (один раз)
    python migrate.py push-ratings      # оценки 1-10
    python migrate.py push-watchlist    # папка "Буду смотреть" -> TMDB watchlist
    python migrate.py push-lists        # остальные папки -> списки TMDB
    python migrate.py report            # итог: что легло, что нет

Dry-run по умолчанию для всех push-*: добавьте --apply чтобы реально отправлять.
Требуется TMDB_API_KEY в .env; session_id пишется в .env автоматически.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import webbrowser
from urllib.parse import quote

import requests
from dotenv import load_dotenv, set_key
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

from common import (ROOT, MAPPED, RAW_VOTES, RAW_LISTS, RESULT,
                    load_json, save_json)

load_dotenv()

API_KEY = (load_dotenv() or None)  # placeholder, ниже реальное чтение
import os
API_KEY = os.environ.get("TMDB_API_KEY", "").strip()
SESSION_ID = os.environ.get("TMDB_SESSION_ID", "").strip()
ENV_FILE = ROOT / ".env"

API = "https://api.themoviedb.org/3"


class TMDB:
    def __init__(self):
        if not API_KEY:
            sys.exit("Нет TMDB_API_KEY в .env (https://www.themoviedb.org/settings/api)")
        self.s = requests.Session()
        self.s.params = {"api_key": API_KEY}
        self.account_id = None

    @retry(wait=wait_exponential(multiplier=2, min=2, max=60), stop=stop_after_attempt(5))
    def get(self, path: str, **params) -> dict:
        r = self.s.get(f"{API}{path}", timeout=30, **params)
        if r.status_code == 429:
            retry_after = int(r.headers.get("Retry-After", "5"))
            time.sleep(retry_after + 1)
            raise RuntimeError("429")
        r.raise_for_status()
        return r.json()

    @retry(wait=wait_exponential(multiplier=2, min=2, max=60), stop=stop_after_attempt(5))
    def post(self, path: str, json_body: dict | None = None, **params) -> dict:
        r = self.s.post(f"{API}{path}", json=json_body, timeout=30, **params)
        if r.status_code == 429:
            time.sleep(int(r.headers.get("Retry-After", "5")) + 1)
            raise RuntimeError("429")
        r.raise_for_status()
        return r.json() if r.text else {}

    # ---- auth ----
    def request_token(self) -> str:
        return self.get("/authentication/token/new")["request_token"]

    def login(self) -> str:
        rt = self.request_token()
        url = ("https://www.themoviedb.org/authenticate/"
               f"{rt}?redirect_to={quote('https://www.themoviedb.org/')}")
        print("Открываю браузер для одобрения токена. Нажмите 'Approve'.")
        webbrowser.open(url)
        input("После одобрения нажмите Enter здесь... ")
        data = self.post("/authentication/session/new", {"request_token": rt})
        sid = data["session_id"]
        set_key(str(ENV_FILE), "TMDB_SESSION_ID", sid)
        self.s.params["session_id"] = sid
        self.account_id = self.get("/account")["id"]
        print(f"OK. session_id сохранён в .env, account_id={self.account_id}")
        return sid

    def ensure_session(self) -> None:
        global SESSION_ID
        if not SESSION_ID:
            sys.exit("Нет TMDB_SESSION_ID. Сначала: python migrate.py login-tmdb")
        self.s.params["session_id"] = SESSION_ID
        self.account_id = self.get("/account")["id"]

    # ---- actions ----
    def rate(self, media: str, tmdb_id: int, rating: int) -> dict:
        return self.post(f"/account/{self.account_id}/rating/{media}/{tmdb_id}",
                         {"value": rating})

    def watchlist_add(self, media: str, tmdb_id: int) -> dict:
        return self.post(f"/account/{self.account_id}/watchlist",
                         {"media_type": media, "media_id": tmdb_id, "watchlist": True})

    def create_list(self, name: str, description: str = "") -> int:
        d = self.post("/list", {"name": name, "description": description, "language": "ru"})
        return d["list_id"]

    def list_add(self, list_id: int, media: str, tmdb_id: int) -> dict:
        return self.post(f"/list/{list_id}/add_item", {"media_id": tmdb_id})


def mapped_index() -> dict[int, dict]:
    return {m["kp_id"]: m for m in load_json(MAPPED, [])}


def push_ratings(tm: TMDB, apply: bool) -> None:
    votes = load_json(RAW_VOTES, [])
    mi = mapped_index()
    done = set(load_json(RESULT, {}).get("ratings_done", []))
    todo = []
    for v in votes:
        if v["kp_id"] in done or v.get("rating") is None:
            continue
        m = mi.get(v["kp_id"])
        if not m or m["status"] != "ok" or not m["tmdb_id"]:
            continue
        todo.append((v, m))
    print(f"К отправке: {len(todo)} оценок "
          f"(пропущено: без оценки или без tmdb_id: {len(votes) - len(todo)})")
    if apply:
        print("РЕЖИМ: APPLY")
    else:
        print("РЕЖИМ: DRY-RUN (добавьте --apply)")

    done_new: list[int] = []
    for i, (v, m) in enumerate(todo, 1):
        if not apply:
            if i <= 10 or i == len(todo):
                print(f"  [dry] {v['title'][:40]}: {v['rating']} -> tmdb {m['media']}/{m['tmdb_id']}")
            continue
        try:
            tm.rate(m["media"], m["tmdb_id"], v["rating"])
            done_new.append(v["kp_id"])
            if i % 20 == 0 or i == len(todo):
                print(f"  {i}/{len(todo)}")
        except Exception as e:
            print(f"  ERR {v['title'][:40]}: {type(e).__name__}: {e}")
        time.sleep(1.2)  # троттлинг ~50 req/min, с запасом
    if apply and done_new:
        res = load_json(RESULT, {})
        res["ratings_done"] = sorted(set(res.get("ratings_done", []) + done_new))
        save_json(RESULT, res)
        print(f"Отправлено: {len(done_new)}. Чекпоинт обновлён (повтор --apply докачает ошибки).")


def push_watchlist(tm: TMDB, apply: bool) -> None:
    lists = load_json(RAW_LISTS, [])
    wl = next((l for l in lists if l["name"].strip().lower() in
               {"буду смотреть", "planned to watch"}), None)
    if not wl:
        print("Папка 'Буду смотреть' не найдена в kp_lists.json — пропускаю.")
        return
    mi = mapped_index()
    todo = [(it, mi[it["kp_id"]]) for it in wl["items"]
            if it["kp_id"] in mi and mi[it["kp_id"]]["status"] == "ok"]
    print(f"Watchlist: {len(todo)} позиций. {'APPLY' if apply else 'DRY-RUN'}")
    for it, m in (todo if apply else todo[:10]):
        if not apply:
            print(f"  [dry] {it['title'][:40]} -> tmdb {m['media']}/{m['tmdb_id']}")
            continue
        try:
            tm.watchlist_add(m["media"], m["tmdb_id"])
        except Exception as e:
            print(f"  ERR {it['title'][:40]}: {e}")
        time.sleep(1.2)


def push_lists(tm: TMDB, apply: bool) -> None:
    lists = load_json(RAW_LISTS, [])
    mi = mapped_index()
    for l in lists:
        if l["name"].strip().lower() in {"буду смотреть", "planned to watch"}:
            continue  # уже в watchlist
        name = f"[KP] {l['name']}"
        print(f"\nСписок '{name}': {len(l['items'])} позиций")
        if not apply:
            print("  [dry] будет создан список и добавлены смапленные элементы")
            continue
        existing = tm.get(f"/account/{tm.account_id}/lists")["results"]
        lid = next((x["id"] for x in existing if x["name"] == name), None)
        if not lid:
            lid = tm.create_list(name)
            print(f"  создан список id={lid}")
        for it in l["items"]:
            m = mi.get(it["kp_id"])
            if not m or m["status"] != "ok":
                continue
            try:
                tm.list_add(lid, m["media"], m["tmdb_id"])
            except Exception as e:
                # TMDB возвращает 409? нет: duplicate -> {"status_message": "..."} c 200/500
                print(f"  ERR {it['title'][:40]}: {e}")
            time.sleep(1.2)


def report() -> None:
    mi = mapped_index()
    votes = load_json(RAW_VOTES, [])
    res = load_json(RESULT, {})
    ok = [m for m in mi.values() if m["status"] == "ok"]
    ratings_sent = len(res.get("ratings_done", []))
    print(f"""
--- Отчёт ---
Всего оценок в КП:            {len(votes)}
С оценкой (числом):           {sum(1 for v in votes if v.get('rating') is not None)}
Смаплено на TMDB:             {len(ok)} / {len(mi)}
Оценок отправлено в TMDB:     {ratings_sent}
Позиции без tmdb_id:          {sum(1 for m in mi.values() if m['status'] == 'no_tmdb_id')}
Ошибки маппинга:              {sum(1 for m in mi.values() if m['status'].startswith('error'))}

Детали в data/mapped.json (status), data/tmdb_result.json (что отправлено).
Повторные запуски push-* докачивают только неотправленное.
""")


def main() -> int:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("login-tmdb")
    for cmd in ("push-ratings", "push-watchlist", "push-lists"):
        p = sub.add_parser(cmd)
        p.add_argument("--apply", action="store_true", help="реально отправлять (иначе dry-run)")
    sub.add_parser("report")
    args = ap.parse_args()

    tm = TMDB()
    if args.cmd == "login-tmdb":
        tm.login()
        return 0
    if args.cmd == "report":
        report()
        return 0
    tm.ensure_session()
    if args.cmd == "push-ratings":
        push_ratings(tm, args.apply)
    elif args.cmd == "push-watchlist":
        push_watchlist(tm, args.apply)
    elif args.cmd == "push-lists":
        push_lists(tm, args.apply)
    return 0


if __name__ == "__main__":
    sys.exit(main())