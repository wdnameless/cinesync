"""Общие константы и утилиты кинопоиск-TMDB мигратора."""
from __future__ import annotations

import json
import random
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
DATA.mkdir(exist_ok=True)

# Промежуточные файлы (каждая стадия докачивается с чекпоинта)
RAW_VOTES = DATA / "kp_votes.json"          # [{kp_id, title, year, my_rating, rated_at, media}]
RAW_LISTS = DATA / "kp_lists.json"          # [{name, items: [{kp_id, title, year, media}]}]
MAPPED = DATA / "mapped.json"               # [{kp_id, ..., tmdb_id, imdb_id, media, status}]
RESULT = DATA / "tmdb_result.json"          # итог отчёта заливки

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")


def human_delay(a: float = 2.5, b: float = 6.5) -> None:
    """Случайная пауза, имитирующая человека."""
    time.sleep(random.uniform(a, b))


def save_json(path: Path, obj) -> None:
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(path)


def load_json(path: Path, default):
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return default