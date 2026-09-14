from textual.app import App, ComposeResult
from textual.containers import Container
from textual.widgets import Button, Header, Footer, Static, Label
from textual.screen import Screen
import subprocess
import sys

class MigrateApp(App):
    CSS = """
    Container { align: center middle; }
    Button { width: 40; margin: 1; }
    Static { margin: 1; }
    """
    BINDINGS = [("q", "quit", "Выход")]

    def compose(self) -> ComposeResult:
        yield Header()
        yield Container(
            Label("Кинопоиск -> TMDB Управление"),
            Button("1. Экспорт Кинопоиск (Playwright)", id="export"),
            Button("2. Маппинг (kinopoisk.dev)", id="map"),
            Button("3. Заливка (TMDB API)", id="push"),
            Button("4. Логин в TMDB (сессия)", id="login"),
            Button("5. Полный АВТО-ЦИКЛ (--apply)", id="auto"),
            Label("Для автоматизации: python run_all.py --auto --apply", id="hint"),
        )
        yield Footer()

    def on_button_pressed(self, event: Button.Pressed) -> None:
        cmd = None
        if event.button.id == "export": cmd = [sys.executable, "export_kp.py", "--user-id", "ВАШ_ID"]
        elif event.button.id == "map": cmd = [sys.executable, "map_ids.py"]
        elif event.button.id == "push": cmd = [sys.executable, "migrate.py", "push-all", "--apply"]
        elif event.button.id == "login": cmd = [sys.executable, "migrate.py", "login-tmdb"]
        elif event.button.id == "auto": cmd = [sys.executable, "run_all.py", "--auto", "--apply"]

        if cmd:
            self.exit()
            subprocess.run(cmd)

if __name__ == "__main__":
    MigrateApp().run()