# Перенос оценок и списков с Кинопоиска на TMDB

Три стадии, каждая докачивается с чекпоинта — падения/капча не теряют прогресс.

```
Кинопоиск --(1)--> data/kp_votes.json + kp_lists.json
          --(2)--> data/mapped.json   (kinopoisk id -> tmdb id, через kinopoisk.dev)
          --(3)--> TMDB               (оценки, watchlist, списки)
```

## 0. Установка

```bash
pip install -r requirements.txt
python -m playwright install chromium
copy .env.example .env
```

## 1. Ключи

**TMDB** (обязательно): https://www.themoviedb.org/settings/api → «API Key (v3)» → в `.env` → `TMDB_API_KEY`.

**kinopoisk.dev** (обязательно, для маппинга id): Telegram-бот [@kinopoiskdev_bot](https://t.me/kinopoiskdev_bot) → `/start` → `/token` → в `.env` → `KINOPOISK_DEV_TOKEN`.

## 2. Экспорт из Кинопоиска

Ваш `user_id` — число из URL профиля: `https://www.kinopoisk.ru/user/<ID>/`

```bash
python export_kp.py --user-id 1234567
```

- Откроется окно Chromium; если не залогинены — войдите вручную (Yandex ID), скрипт дождётся.
- Сессия сохраняется в `.pw-profile/` — следующий запуск уже без логина: `python export_kp.py --user-id 1234567 --headless`.
- Результат: `data/kp_votes.json`, `data/kp_lists.json`.

## 3. Маппинг id

```bash
python map_ids.py            # все; тест: --limit 5
```

kinopoisk.dev отдаёт `externalId.tmdb` напрямую. Записи со статусом `error`/`no_tmdb_id` докачиваются повторным запуском.

## 4. Заливка в TMDB

```bash
python migrate.py login-tmdb     # одноразово: откроет браузер, нажать Approve
python migrate.py push-ratings   # dry-run; так посмотреть что будет
python migrate.py push-ratings --apply
python migrate.py push-watchlist --apply    # папка "Буду смотреть" -> TMDB watchlist
python migrate.py push-lists --apply        # остальные папки -> списки "[KP] имя"
python migrate.py report
```

Всё идёт с троттлингом ~1.2 c/запрос (безопасно для 3000+ позиций: прогон ~1.5 ч на тысячу оценок). Чекпоинт — `data/tmdb_result.json`: прервали — запустите `--apply` снова, отправится только остаток.

## Файлы

| Файл | Назначение |
|---|---|
| `export_kp.py` | стадия 1: Playwright-скрейп оценок/папок |
| `map_ids.py` | стадия 2: kp id → tmdb id через kinopoisk.dev |
| `migrate.py` | стадия 3: заливка в TMDB (login, ratings, watchlist, lists, report) |
| `common.py` | пути, чекпоинт-хелперы, human-delay |

Приватность: `.env`, `data/`, `.pw-profile/` в `.gitignore` — cookies и ваши списки не уедут в git.

## Если капча / 403 на Кинопоиске

Скрипт останавливается, прогресс сохранён. Решите капчу в открывшемся окне, перезапустите команду — продолжит с места остановки. Если Playwright-Chromium стабильно ловит капчу, укажите реальный браузер в `.env`:

```
KP_BROWSER_PATH=C:\путь\до\chrome.exe
```