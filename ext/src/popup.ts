import type { MovieItem, ServiceId, MediaCategory, MigrationState, TargetProgress, CsvBundle } from './types';
import type { ServiceCredentials } from './services/credentials';

type Lang = 'ru' | 'en';

// DOM Elements - Canonical primary navigation
const tabMigrationBtn = document.getElementById('tabMigrationBtn');
const tabExportBtn = document.getElementById('tabExportBtn');
const tabSettingsBtn = document.getElementById('tabSettingsBtn');
const tabGuideBtn = document.getElementById('tabGuideBtn');

const tabMigration = document.getElementById('tabMigration');
const tabExport = document.getElementById('tabExport');
const tabSettings = document.getElementById('tabSettings');
const tabGuide = document.getElementById('tabGuide');

// Process controls & inputs
const categorySelect = document.getElementById('categorySelect') as HTMLSelectElement | null;
const scanBtn = document.getElementById('scanBtn') as HTMLButtonElement | null;
const startBtn = document.getElementById('startBtn') as HTMLButtonElement | null;
const stopBtn = document.getElementById('stopBtn') as HTMLButtonElement | null;
const pauseBtn = document.getElementById('pauseBtn') as HTMLButtonElement | null;
const resetBtn = document.getElementById('resetBtn') as HTMLButtonElement | null;

// Aggregate metric values (legacy wiring kept so existing rendering survives)
const scrapedVal = document.getElementById('scrapedVal');
const syncedVal = document.getElementById('syncedVal');
const failedVal = document.getElementById('failedVal');

// Progress bar elements
const progressFill = document.getElementById('progressBar') as HTMLElement | null;
const progressPctText = document.getElementById('progressPercent') as HTMLElement | null;
const activeTitle = document.getElementById('progressTitle') as HTMLElement | null;
const statusBadge = document.getElementById('statusBadge');
const targetProgressList = document.getElementById('targetProgressList');

// Log console
const logsBox = document.getElementById('logsBox');
const clearLogsBtn = document.getElementById('clearLogsBtn');

// Kinopoisk Unofficial settings (tabSettings)
const kpApiKeyInput = document.getElementById('kpApiKey') as HTMLInputElement | null;
const saveKpKeyBtn = document.getElementById('saveKpKeyBtn') as HTMLButtonElement | null;
const kpPingBadge = document.getElementById('kpPingBadge');
const kpPingText = document.getElementById('kpPingText');

// TMDB direct controls
const apiKeyInput = document.getElementById('tmdbApiKey') as HTMLInputElement | null;
const saveKeyBtn = document.getElementById('tmdbSaveBtn') as HTMLButtonElement | null;
const tmdbLoginBtn = document.getElementById('tmdbLoginBtn') as HTMLButtonElement | null;
const tmdbConfirmBtn = document.getElementById('tmdbConfirmBtn') as HTMLButtonElement | null;
const sessionDot = document.getElementById('sessionDot');
const sessionStatusText = document.getElementById('tmdbSessionStatusText') as HTMLElement | null;

// Legacy Kinopoisk CSV export buttons (tabExport)
const exportRatedBtn = document.getElementById('exportRatedBtn') as HTMLButtonElement | null;
const exportWatchlistBtn = document.getElementById('exportWatchlistBtn') as HTMLButtonElement | null;
const exportCsvBtn = document.getElementById('exportCsvBtn') as HTMLButtonElement | null;

// Languages
const langRu = document.getElementById('langRu');
const langEn = document.getElementById('langEn');
const tmdbPingBadge = document.getElementById('tmdbPingBadge');
const tmdbPingText = document.getElementById('tmdbPingText');

const ALL_SERVICES: ServiceId[] = ['tmdb', 'simkl', 'letterboxd', 'imdb', 'movielens', 'kinopoisk'];
const CSV_SERVICES: ServiceId[] = ['letterboxd', 'imdb', 'movielens'];

/** Per-service DOM handles, resolved from the frozen Zone E id contract. */
interface ServiceElements {
  tabBtn: HTMLElement | null;
  pane: HTMLElement | null;
  pingBadge: HTMLElement | null;
  pingText: HTMLElement | null;
  clientId: HTMLInputElement | null;
  clientSecret: HTMLInputElement | null;
  saveBtn: HTMLButtonElement | null;
  loginBtn: HTMLButtonElement | null;
  enableToggle: HTMLInputElement | null;
  exportBtn: HTMLButtonElement | null;
}

function resolveServiceElements(service: ServiceId): ServiceElements {
  const $ = (id: string) => document.getElementById(id);
  return {
    tabBtn: $(`tab${service}Btn`),
    pane: $(`tab${service}`),
    pingBadge: $(`${service}PingBadge`),
    pingText: $(`${service}PingText`),
    clientId: $(
      service === 'tmdb' ? 'tmdbApiKey' : `${service}ClientId`
    ) as HTMLInputElement | null,
    clientSecret: $(`${service}ClientSecret`) as HTMLInputElement | null,
    saveBtn: $(`${service}SaveBtn`) as HTMLButtonElement | null,
    loginBtn: $(`${service}LoginBtn`) as HTMLButtonElement | null,
    enableToggle: $(`${service}EnableToggle`) as HTMLInputElement | null,
    exportBtn: $(`${service}ExportBtn`) as HTMLButtonElement | null,
  };
}

const serviceElements: Record<ServiceId, ServiceElements> = {
  tmdb: resolveServiceElements('tmdb'),
  simkl: resolveServiceElements('simkl'),
  letterboxd: resolveServiceElements('letterboxd'),
  imdb: resolveServiceElements('imdb'),
  movielens: resolveServiceElements('movielens'),
  kinopoisk: resolveServiceElements('kinopoisk'),
};

/** Services the user has enabled as sync targets. */
let enabledTargets: ServiceId[] = [];

const translations: Record<Lang, Record<string, string>> = {
  ru: {
    tabTransfer: 'Перенос',
    tabExport: 'CSV',
    tabSettings: 'Ключи',
    tabGuide: 'Инфо',
    guideHeader: 'Пошаговое руководство',
    step1Title: 'Получите TMDB API Key',
    step1Desc: 'Зарегистрируйтесь на themoviedb.org, перейдите в Настройки ➔ API и создайте бесплатный ключ разработчика (Developer Key v3).',
    step1Link: 'Открыть TMDB API ↗',
    step2Title: 'Авторизуйтесь через TMDB',
    step2Desc: 'Вставьте ключ во вкладке «Ключи», нажмите «Войти», разрешите доступ во всплывающем окне и нажмите «Подтвердить».',
    step3Title: 'Сканируйте свой Кинопоиск',
    step3Desc: 'Откройте вкладку со своим профилем на kinopoisk.ru и нажмите «1. Сканировать КП». Можно переключаться на другие аккаунты параллельно.',
    step4Title: 'Переносите в TMDB без дублей',
    step4Desc: 'Нажмите «2. Синхронизировать». Расширение сверит получателей с вашим профилем и пропустит то, что там уже есть.',
    step5Title: 'Экспорт таблиц CSV',
    step5Desc: 'Во вкладке «Экспорт CSV» скачивайте готовые таблицы с ID, названиями, годами, оценками и прямыми ссылками на КП.',
    pingValid: 'АКТИВЕН',
    pingInvalid: 'НЕВЕРНЫЙ',
    pingTesting: 'ПРОВЕРКА...',
    exportSectionTitle: 'Экспорт таблиц Кинопоиска',
    exportRatedTitle: 'Оценки пользователей',
    exportRatedDesc: 'ID, Название, Год, Ваша оценка, Ссылка на КП',
    exportWlTitle: 'Буду смотреть (Watchlist)',
    exportWlDesc: 'ID, Название, Год выпуска, Ссылка на КП',
    exportFullTitle: 'Полный архив базы',
    exportFullDesc: 'Все фильмы, оценки, списки, категории и ссылки',
    btnDownloadFull: 'Скачать всё',
    authTitle: 'Авторизация и ключи API',
    btnHowToConnect: 'Как подключить?',
    getKeyLink: 'Получить ↗',
    statusNotAuth: 'Не авторизован',
    statusActive: 'Активна',
    statusAuthPrefix: 'Авторизован',
    btnLogin: 'Войти',
    btnConfirm: 'Подтвердить',
    kpKeyLabel: 'Kinopoisk Unofficial API Key',
    badgeOpt: 'Опционально',
    btnOk: 'ОК',
    processTitle: 'Управление процессом',
    scopeLabel: 'Данные для синхронизации',
    optBoth: 'Оценки + Буду смотреть (Watchlist)',
    optRatings: 'Только оценки пользователя',
    optWatchlist: 'Только список «Буду смотреть»',
    lblScraped: 'Собрано',
    lblSynced: 'Перенесено',
    lblFailed: 'Ошибки',
    btnScan: '1. Сканировать КП',
    btnStart: '2. Синхронизировать',
    btnStop: 'Стоп',
    btnResume: 'Продолжить',
    btnReset: 'Сброс',
    btnExportRated: '⭐ Экспорт оценок (CSV)',
    btnExportWl: '📑 Экспорт Watchlist (CSV)',
    btnExportFull: '💾 Полный архив базы (Кинопоиск CSV)',
    logsTitle: 'Логи событий',
    readyTitle: 'Готов к запуску',
    targetStatusPending: 'в очереди',
    targetStatusRunning: 'выполняется',
    targetStatusCompleted: 'готово',
    targetStatusFailed: 'ошибка',
    targetStatusSkipped: 'пропущено',
    svcKinopoisk: 'Кинопоиск',
    inProgress: 'В процессе...',
    syncingPrefix: 'Синхронизация:',
    captchaDetected: '⚠️ Обнаружена капча! Пройдите её во вкладке Кинопоиска',
    scanning: 'Сбор...',
    transferring: 'Перенос...',
    btnSyncNow: '2. Синхронизировать',
    resetConfirm: 'Сбросить прогресс и очистить очередь?',
    emptyRatings: 'Нет собранных оценок! Сначала нажмите "1. Сканировать КП".',
    emptyWl: 'Список «Буду смотреть» пуст! Сначала нажмите "1. Сканировать КП".',
    emptyBackup: 'Нет данных для экспорта! Сначала нажмите "1. Сканировать КП".',
    stoppedMsg: 'Процесс остановлен пользователем',
    alertNoTmdbKey: 'Сначала укажите и сохраните TMDB v3 API Key!',
    authExpired: 'Сессия истекла',
    reauthNeeded: 'Требуется повторная авторизация',
    reauthBtn: 'Войти снова',
    btnExportServiceCsv: 'Экспорт CSV',
    exportDone: 'Экспорт завершен',
    exportFailed: 'Ошибка экспорта CSV',
    noExportFiles: 'Нет данных для экспорта',
    importNoticeLetterboxd: 'Импортируйте полученный CSV файл на странице letterboxd.com/import/ (лимит 1 МБ на файл)',
    importNoticeImdb: 'IMDb не поддерживает импорт списков. Доступен только экспорт CSV.',
    importNoticeMovielens: 'MovieLens не поддерживает импорт пользовательских файлов. Доступен только экспорт CSV.',
    sourceNoticeKinopoisk: 'Кинопоиск является источником данных, а не получателем синхронизации.',
    noTargetsSelected: 'Выберите хотя бы один сервис для синхронизации!',
    simklPinNotice: 'Для работы с Simkl требуется Client ID вашего приложения и подтверждение PIN-кода.',
    saveCredentialsSuccess: 'Данные сохранены',
    saveCredentialsError: 'Ошибка при сохранении данных',
    pingError: 'Ошибка проверки',
    // Service navigation labels
    svcTmdb: 'TMDB',
    svcSimkl: 'Simkl',
    svcLetterboxd: 'Letterboxd',
    svcImdb: 'IMDb',
    svcMovielens: 'MovieLens',
    kinopoiskTitle: 'Кинопоиск',
    kinopoiskDesc: 'Запись оценок и списка «Буду смотреть» напрямую в ваш профиль Кинопоиска.',
    kinopoiskAutomationNotice: 'У Кинопоиска нет публичного API на запись. Расширение работает через вашу открытую вкладку браузера: держите вкладку Кинопоиска открытой и не закрывайте её во время переноса.',
    btnCheckTab: 'Проверить вкладку',
    // Shared service labels
    btnSave: 'Сохранить',
    btnConnect: 'Подключить',
    btnTransfer: 'Синхронизировать',
    btnExportLetterboxd: 'Экспорт для Letterboxd',
    btnExportImdb: 'Экспорт для IMDb',
    btnExportMovielens: 'Экспорт для MovieLens',
    enableTargetLabel: 'Участвует в синхронизации',
    categoryLabel: 'Данные для синхронизации',
    statusPrefix: 'Статус:',
    createAppLink: 'Создать приложение ↗',
    linkLetterboxdImport: 'Открыть импорт Letterboxd ↗',
    // TMDB
    tmdbTitle: 'The Movie Database (TMDB)',
    tmdbDesc: 'Официальный API v3: полная синхронизация оценок и списка «Буду смотреть».',
    tmdbKeyLabel: 'TMDB v3 API Key',
    // Simkl
    simklTitle: 'Simkl',
    simklDesc: 'Оценки и список «Планирую смотреть» через PIN-авторизацию.',
    simklClientIdLabel: 'Simkl Client ID',
    simklAppNotice: 'Simkl требует собственное приложение: Client ID выдаётся в настройках аккаунта Simkl.',
    simklAuthNotice: 'После сохранения Client ID нажмите «Подключить» и подтвердите PIN-код.',
    // Letterboxd
    letterboxdTitle: 'Letterboxd',
    letterboxdDesc: 'Импорт через CSV-файл: оценки и список отложенного.',
    letterboxdLimitNotice: 'Лимит файла — 1 МБ. Крупные выгрузки разбиваются на части с повтором заголовка.',
    // IMDb
    imdbTitle: 'IMDb',
    imdbDesc: 'Только экспорт CSV в формате IMDb.',
    imdbNoImportNotice: 'IMDb не поддерживает импорт файлов. Возможен только экспорт.',
    // MovieLens
    movielensTitle: 'MovieLens',
    movielensDesc: 'Только экспорт CSV в формате датасета MovieLens.',
    movielensNoImportNotice: 'MovieLens не принимает пользовательские файлы: возможен только экспорт.',
    // Kinopoisk source
    kpSettingsTitle: 'Источник: Кинопоиск',
    kpSourceOnlyNotice: 'Кинопоиск — источник данных. У него нет API на запись, поэтому он не может быть получателем.',
    // Extended guide steps
    step6Title: 'Выберите получателей синхронизации',
    step6Desc: 'На вкладке «Ключи» включите нужные сервисы переключателем и сохраните их ключи. Затем нажмите «2. Синхронизировать».',
    step7Title: 'Сервисы без API (IMDb, MovieLens)',
    step7Desc: 'Они работают только на экспорт: скачайте CSV и загрузите его вручную там, где сервис это поддерживает.',
    step7Link: 'Страница импорта Letterboxd ↗',
  },
  en: {
    tabGuide: 'Guide',
    tabTransfer: 'Sync',
    tabExport: 'CSV',
    tabSettings: 'Keys',
    guideHeader: 'Step-by-Step Guide',
    step1Title: 'Get TMDB API Key',
    step3Title: 'Scan Kinopoisk Profile',
    step3Desc: 'Open your profile page on kinopoisk.ru and click «1. Scan KP». You can run other account scraping in parallel.',
    step4Title: 'Transfer to TMDB with No Duplicates',
    step4Desc: 'Click «2. To TMDB». The extension pre-checks your TMDB ratings & watchlist and automatically skips existing items!',
    step5Title: 'Export Clean CSV Tables',
    step5Desc: 'Use the «Export CSV» tab to download clean spreadsheets with IDs, titles, years, ratings, and direct Kinopoisk URLs.',
    pingValid: 'ACTIVE',
    pingInvalid: 'INVALID',
    pingTesting: 'CHECKING...',
    exportSectionTitle: 'Export Kinopoisk Tables',
    exportRatedDesc: 'ID, Title, Year, Your Rating, Kinopoisk URL',
    exportWlTitle: 'Watchlist',
    exportWlDesc: 'ID, Title, Release Year, Kinopoisk URL',
    exportFullTitle: 'Full Database Backup',
    exportFullDesc: 'All films, ratings, lists, categories, and URLs',
    btnDownloadFull: 'Download All',
    authTitle: 'Authorization & API Keys',
    btnHowToConnect: 'How to Connect?',
    getKeyLink: 'Get Key ↗',
    statusNotAuth: 'Not authorized',
    statusActive: 'Active',
    statusAuthPrefix: 'Authorized',
    btnLogin: 'Sign In',
    btnConfirm: 'Confirm',
    kpKeyLabel: 'Kinopoisk Unofficial API Key',
    badgeOpt: 'Optional',
    btnOk: 'OK',
    processTitle: 'Process Control',
    scopeLabel: 'Data to sync',
    optBoth: 'Ratings + Watchlist',
    optRatings: 'User Ratings Only',
    optWatchlist: 'Watchlist Only',
    lblScraped: 'Scraped',
    lblSynced: 'Synced',
    lblFailed: 'Failed',
    btnScan: '1. Scan Kinopoisk',
    btnStart: '2. Sync now',
    btnStop: 'Stop',
    btnResume: 'Resume',
    btnReset: 'Reset',
    btnExportRated: '⭐ Export Ratings (CSV)',
    btnExportWl: '📑 Export Watchlist (CSV)',
    btnExportFull: '💾 Full Backup Archive (CSV)',
    logsTitle: 'Event Logs',
    readyTitle: 'Ready to start',
    targetStatusPending: 'queued',
    targetStatusRunning: 'running',
    targetStatusCompleted: 'done',
    targetStatusFailed: 'failed',
    targetStatusSkipped: 'skipped',
    svcKinopoisk: 'Kinopoisk',
    inProgress: 'Working...',
    syncingPrefix: 'Syncing:',
    captchaDetected: '⚠️ Captcha detected! Solve it in the Kinopoisk tab',
    scanning: 'Scanning...',
    transferring: 'Transferring...',
    btnSyncNow: '2. Sync now',
    resetConfirm: 'Reset progress and clear queue?',
    emptyRatings: 'No ratings found! Please click "1. Scan Kinopoisk" first.',
    emptyWl: 'Watchlist is empty! Please click "1. Scan Kinopoisk" first.',
    emptyBackup: 'No data to export! Please click "1. Scan Kinopoisk" first.',
    stoppedMsg: 'Process stopped by user',
    alertNoTmdbKey: 'Please enter and save TMDB v3 API Key first!',
    authExpired: 'Auth session expired',
    reauthNeeded: 'Re-authentication required',
    reauthBtn: 'Log in again',
    btnExportServiceCsv: 'Export CSV',
    exportDone: 'Export complete',
    exportFailed: 'CSV export failed',
    noExportFiles: 'No data to export',
    importNoticeLetterboxd: 'Import the downloaded CSV at letterboxd.com/import/ (1 MB file limit)',
    importNoticeImdb: 'IMDb does not support importing lists. Only CSV export is available.',
    importNoticeMovielens: 'MovieLens does not support importing user files. Only CSV export is available.',
    sourceNoticeKinopoisk: 'Kinopoisk is a data source, not a sync destination.',
    noTargetsSelected: 'Please enable at least one target service to sync!',
    simklPinNotice: 'Simkl requires your app Client ID and PIN authorization.',
    saveCredentialsSuccess: 'Credentials saved',
    saveCredentialsError: 'Error saving credentials',
    pingError: 'Ping check failed',
    // Service navigation labels
    svcTmdb: 'TMDB',
    svcSimkl: 'Simkl',
    svcLetterboxd: 'Letterboxd',
    svcImdb: 'IMDb',
    svcMovielens: 'MovieLens',
    kinopoiskTitle: 'Kinopoisk',
    kinopoiskDesc: 'Write ratings and the watchlist directly into your Kinopoisk profile.',
    kinopoiskAutomationNotice: 'Kinopoisk has no public write API. The extension works through your open browser tab: keep a Kinopoisk tab open and do not close it during the transfer.',
    btnCheckTab: 'Check tab',
    // Shared service labels
    btnSave: 'Save',
    btnConnect: 'Connect',
    btnTransfer: 'Sync now',
    btnExportLetterboxd: 'Export for Letterboxd',
    btnExportImdb: 'Export for IMDb',
    btnExportMovielens: 'Export for MovieLens',
    enableTargetLabel: 'Include in sync',
    categoryLabel: 'Data to sync',
    statusPrefix: 'Status:',
    createAppLink: 'Create an app ↗',
    linkLetterboxdImport: 'Open Letterboxd import ↗',
    // TMDB
    tmdbTitle: 'The Movie Database (TMDB)',
    tmdbDesc: 'Official v3 API: full sync of ratings and the watchlist.',
    tmdbKeyLabel: 'TMDB v3 API Key',
    // Simkl
    simklTitle: 'Simkl',
    simklDesc: 'Ratings and plan-to-watch via PIN authorization.',
    simklClientIdLabel: 'Simkl Client ID',
    simklAppNotice: 'Simkl requires your own app: the Client ID is issued in your Simkl account settings.',
    simklAuthNotice: 'After saving the Client ID click "Connect" and approve the PIN code.',
    // Letterboxd
    letterboxdTitle: 'Letterboxd',
    letterboxdDesc: 'Import via CSV file: ratings and watchlist.',
    letterboxdLimitNotice: 'File limit is 1 MB. Larger exports are split into parts with the header repeated.',
    // IMDb
    imdbTitle: 'IMDb',
    imdbDesc: 'CSV export only, in IMDb format.',
    imdbNoImportNotice: 'IMDb does not support importing files. Export only.',
    // MovieLens
    movielensTitle: 'MovieLens',
    movielensDesc: 'CSV export only, in MovieLens dataset format.',
    movielensNoImportNotice: 'MovieLens does not accept user files: export only.',
    // Kinopoisk source
    kpSettingsTitle: 'Source: Kinopoisk',
    kpSourceOnlyNotice: 'Kinopoisk is a data source. It has no write API, so it can never be a destination.',
    // Extended guide steps
    step6Title: 'Choose sync destinations',
    step6Desc: 'On the "Keys" tab enable the services you need and save their credentials. Then press "2. Sync now".',
    step7Title: 'Services without an API (IMDb, MovieLens)',
    step7Desc: 'These are export-only: download the CSV and upload it manually wherever the service allows it.',
    step7Link: 'Letterboxd import page ↗',
  }
};

let currentLang: Lang = 'ru';

function setLanguage(lang: Lang) {
  currentLang = lang;
  chrome.storage.local.set({ uiLang: lang });
  langRu?.classList.toggle('active', lang === 'ru');
  langEn?.classList.toggle('active', lang === 'en');

  const dict = translations[lang];
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (key && dict[key]) {
      el.textContent = dict[key];
    }
  });
}

langRu?.addEventListener('click', () => setLanguage('ru'));
langEn?.addEventListener('click', () => setLanguage('en'));

chrome.storage.local.get(['uiLang'], (res) => {
  if (res.uiLang === 'en' || res.uiLang === 'ru') {
    setLanguage(res.uiLang);
  }
});

// Helper: Show brief visual feedback on button
function pulseSuccess(btn: HTMLElement, tempText?: string) {
  const original = btn.innerHTML;
  btn.style.borderColor = 'rgba(16, 185, 129, 0.6)';
  if (tempText) btn.textContent = tempText;
  setTimeout(() => {
    btn.innerHTML = original;
    btn.style.borderColor = '';
  }, 1200);
}

// Clear Logs Box
clearLogsBtn?.addEventListener('click', () => {
  if (!logsBox) return;
  logsBox.innerHTML = '<div class="log-entry log-info"><span class="log-time">[Clear]</span> Журнал очищен</div>';
});

// Initialize Settings & Storage
chrome.storage.local.get(['tmdbAuth', 'tmdbApiKey', 'tmdbSessionId', 'tmdbUsername', 'kpApiKey', 'categoryScope'], (res) => {
  const auth = res.tmdbAuth || {};
  const apiKey = auth.apiKey || res.tmdbApiKey || '';
  const sessionId = auth.sessionId || res.tmdbSessionId || '';
  const username = auth.username || res.tmdbUsername || '';

  if (apiKey && apiKeyInput) {
    apiKeyInput.value = apiKey;
    pingService('tmdb');
  }
  if (res.kpApiKey && kpApiKeyInput) {
    kpApiKeyInput.value = res.kpApiKey;
    pingKpKey(res.kpApiKey);
  }
  if (res.categoryScope && categorySelect) categorySelect.value = res.categoryScope;

  updateSessionDisplay(!!sessionId, username);
});
categorySelect?.addEventListener('change', () => {
  if (categorySelect) chrome.storage.local.set({ categoryScope: categorySelect.value });
});

function updateSessionDisplay(isAuth: boolean, username?: string) {
  if (!sessionStatusText) return;
  if (isAuth) {
    sessionStatusText.textContent = username ? `Авторизован (${username})` : 'Активна';
    sessionStatusText.style.color = '#34d399';
    if (sessionDot) {
      sessionDot.className = 'dot active';
    }
    if (tmdbLoginBtn) {
      tmdbLoginBtn.textContent = 'Сменить аккаунт';
      tmdbLoginBtn.classList.remove('btn-tmdb');
    }
    if (tmdbConfirmBtn) tmdbConfirmBtn.style.display = 'none';
  } else {
    sessionStatusText.textContent = 'Не авторизован';
    sessionStatusText.style.color = '#9ca3af';
    if (sessionDot) {
      sessionDot.className = 'dot';
    }
    if (tmdbLoginBtn) {
      tmdbLoginBtn.textContent = 'Войти в TMDB';
      tmdbLoginBtn.classList.add('btn-tmdb');
    }
  }
}

function pingKpKey(key: string) {
  if (!key) {
    if (kpPingBadge) kpPingBadge.style.display = 'none';
    return;
  }
  if (kpPingBadge) {
    kpPingBadge.style.display = 'inline-flex';
    kpPingBadge.className = 'ping-badge';
    if (kpPingText) kpPingText.textContent = translations[currentLang].pingTesting;
  }
  chrome.runtime.sendMessage({ action: 'PING_KP_KEY', kpApiKey: key }, (res) => {
    if (!kpPingBadge) return;
    if (res?.valid) {
      kpPingBadge.className = 'ping-badge valid';
      if (kpPingText) kpPingText.textContent = translations[currentLang].pingValid;
    } else {
      kpPingBadge.className = 'ping-badge invalid';
      if (kpPingText) kpPingText.textContent = translations[currentLang].pingInvalid;
    }
  });
}

// Save TMDB API Key
saveKeyBtn?.addEventListener('click', () => {
  if (!apiKeyInput) return;
  const key = apiKeyInput.value.trim();
  chrome.runtime.sendMessage({ action: 'SAVE_API_KEY', apiKey: key }, () => {
    chrome.storage.local.set({ tmdbApiKey: key }, () => {
      if (saveKeyBtn) pulseSuccess(saveKeyBtn, '✓');
      pingService('tmdb');
    });
  });
});
// Save KP API Key
saveKpKeyBtn?.addEventListener('click', () => {
  if (!kpApiKeyInput) return;
  const key = kpApiKeyInput.value.trim();
  chrome.runtime.sendMessage({ action: 'SAVE_KP_API_KEY', kpApiKey: key }, () => {
    chrome.storage.local.set({ kpApiKey: key }, () => {
      if (saveKpKeyBtn) pulseSuccess(saveKpKeyBtn, '✓');
      pingKpKey(key);
    });
  });
});

// TMDB Login Workflow
tmdbLoginBtn?.addEventListener('click', () => {
  if (!apiKeyInput) return;
  const key = apiKeyInput.value.trim();
  if (!key) {
    const dict = translations[currentLang];
    alert(dict.alertNoTmdbKey || 'Сначала укажите и сохраните TMDB v3 API Key!');
    apiKeyInput.focus();
    return;
  }
  tmdbLoginBtn.disabled = true;
  tmdbLoginBtn.textContent = currentLang === 'ru' ? 'Генерация токена...' : 'Generating token...';
  if (sessionDot) sessionDot.className = 'dot waiting';

  chrome.runtime.sendMessage({ action: 'SAVE_API_KEY', apiKey: key }, () => {
    chrome.runtime.sendMessage({ action: 'TMDB_START_AUTH' }, (res) => {
      if (tmdbLoginBtn) {
        tmdbLoginBtn.disabled = false;
        tmdbLoginBtn.textContent = currentLang === 'ru' ? 'Вход в браузере...' : 'Opening browser...';
      }
      if (res?.success) {
        if (tmdbConfirmBtn) tmdbConfirmBtn.style.display = 'inline-flex';
        if (sessionStatusText) {
          sessionStatusText.textContent = currentLang === 'ru' ? 'Одобрите доступ на сайте TMDB' : 'Approve access on TMDB';
          sessionStatusText.style.color = '#fbbf24';
        }
      } else {
        if (tmdbLoginBtn) tmdbLoginBtn.textContent = currentLang === 'ru' ? 'Войти в TMDB' : 'Login to TMDB';
        if (sessionDot) sessionDot.className = 'dot';
        alert('Ошибка авторизации: ' + (res?.error || 'Неизвестная ошибка'));
      }
    });
  });
});
tmdbConfirmBtn?.addEventListener('click', () => {
  tmdbConfirmBtn.disabled = true;
  tmdbConfirmBtn.textContent = currentLang === 'ru' ? 'Проверка...' : 'Checking...';

  chrome.runtime.sendMessage({ action: 'TMDB_COMPLETE_AUTH', requestToken: '' }, (res) => {
    tmdbConfirmBtn.disabled = false;
    tmdbConfirmBtn.textContent = currentLang === 'ru' ? 'Подтвердить' : 'Confirm';
    if (res?.success) {
      tmdbConfirmBtn.style.display = 'none';
      updateSessionDisplay(true, res.username || 'TMDB User');
      alert(currentLang === 'ru' ? `Авторизация успешна! Аккаунт: ${res.username || 'TMDB'}` : `Authorization successful! Account: ${res.username || 'TMDB'}`);
    } else {
      alert('Не удалось подтвердить сессию: ' + (res?.error || 'Повторите попытку'));
    }
  });
});
scanBtn?.addEventListener('click', () => {
  const category = (categorySelect?.value as MediaCategory) || 'both';
  chrome.runtime.sendMessage({ action: 'START_SCANNING', category }, (response) => {
    if (response?.error) {
      alert(`Ошибка: ${response.error}`);
    } else {
      refreshState();
    }
  });
});

startBtn?.addEventListener('click', () => {
  const category = (categorySelect?.value as MediaCategory) || 'both';
  const targets = Array.from(enabledTargets);
  if (targets.length === 0) {
    alert(translations[currentLang].noTargetsSelected || 'Выберите хотя бы один сервис для синхронизации!');
    return;
  }
  chrome.runtime.sendMessage({ action: 'START_SYNC', targets, category }, (response) => {
    if (response?.error) {
      alert(`Ошибка: ${response.error}`);
    } else {
      refreshState();
    }
  });
});
stopBtn?.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'STOP_PROCESS' }, () => {
    refreshState();
  });
});

pauseBtn?.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'RESUME_MIGRATION' }, () => {
    refreshState();
  });
});

resetBtn?.addEventListener('click', () => {
  const dict = translations[currentLang];
  if (!confirm(dict.resetConfirm || 'Сбросить прогресс и очистить очередь?')) return;
  chrome.runtime.sendMessage({ action: 'RESET_STATE' }, () => {
    refreshState();
  });
});
function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  const bom = '\uFEFF';
  const content = bom + [headers.join(','), ...rows.map(r => r.join(','))].join('\r\n');
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function getStoredItems(): Promise<MovieItem[]> {
  return new Promise((resolve) => {
    chrome.storage.local.get(['lastScrapedItems', 'scrapedItems'], (res) => {
      const items = (res.lastScrapedItems || res.scrapedItems || []) as MovieItem[];
      resolve(items);
    });
  });
}

// Экспорт оценок Кинопоиска (CSV)
exportRatedBtn?.addEventListener('click', async () => {
  const items = await getStoredItems();
  const rated = items.filter((it) => typeof it.rating === 'number' && it.rating > 0);
  const dict = translations[currentLang];
  if (rated.length === 0) {
    alert(dict.emptyRatings || 'Нет собранных оценок для экспорта!');
    return;
  }
  const headers = ['Kinopoisk_ID', 'Название', 'Год', 'Моя_оценка', 'Ссылка_Кинопоиск'];
  const rows = rated.map((it) => [
    it.id || it.kpId || '',
    `"${(it.title || '').replace(/"/g, '""')}"`,
    it.year || '',
    it.rating || '',
    `"${it.url || `https://www.kinopoisk.ru/film/${it.id || it.kpId}/`}"`,
  ]);
  downloadCsv(`kinopoisk_ratings_${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
  if (exportRatedBtn) pulseSuccess(exportRatedBtn, 'Готово!');
});

// Экспорт списка "Буду смотреть" (Watchlist CSV)
exportWatchlistBtn?.addEventListener('click', async () => {
  const items = await getStoredItems();
  const wl = items.filter((it) => it.category === 'watchlist' || (!it.rating && it.category !== 'ratings'));
  const dict = translations[currentLang];
  if (!wl.length) {
    alert(dict.emptyWl || 'Список «Буду смотреть» пуст!');
    return;
  }
  const headers = ['Kinopoisk_ID', 'Название', 'Год', 'Ссылка_Кинопоиск'];
  const rows = wl.map((it) => [
    it.id || it.kpId || '',
    `"${(it.title || '').replace(/"/g, '""')}"`,
    it.year || '',
    `"${it.url || `https://www.kinopoisk.ru/film/${it.id || it.kpId}/`}"`,
  ]);
  downloadCsv(`kinopoisk_watchlist_${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
  pulseSuccess(exportWatchlistBtn, 'Готово!');
});

// Полный архив базы (CSV)
exportCsvBtn?.addEventListener('click', async () => {
  const items = await getStoredItems();
  if (!items.length) {
    alert('Нет собранных записей для экспорта! Сначала запустите сканирование.');
    return;
  }
  const headers = ['Kinopoisk_ID', 'Тип', 'Название', 'Год', 'Категория', 'Моя_оценка', 'Ссылка_Кинопоиск'];
  const rows = items.map((it) => [
    it.id || it.kpId || '',
    it.type || 'film',
    `"${(it.title || '').replace(/"/g, '""')}"`,
    it.year || '',
    it.category === 'ratings' ? 'Оценки' : 'Буду смотреть',
    it.rating || '',
    `"${it.url || `https://www.kinopoisk.ru/film/${it.id || it.kpId}/`}"`,
  ]);
  downloadCsv(`kinopoisk_full_backup_${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
  pulseSuccess(exportCsvBtn, 'Скачано!');
});

// UI State Refresh Loop
async function refreshState() {
  chrome.runtime.sendMessage({ action: 'GET_STATE' }, (response) => {
    chrome.storage.local.get(['migrationState', 'lastScrapedItems'], (storageData) => {
      const storageState = storageData.migrationState || {};
      const state: MigrationState = response?.state || storageState;
      if (!state.status && !storageState.status) return;
      
      // Use whichever state is more informative
      const effectiveState = (state.scrapedCount || 0) >= (storageState.scrapedCount || 0) ? state : storageState;
      applyStateToUi(effectiveState);
    });
  });
}

function applyStateToUi(state: MigrationState) {
    const dict = translations[currentLang];

    if (statusBadge) {
      statusBadge.textContent = state.status.toUpperCase();
      statusBadge.className = 'status-badge';
      if (state.status === 'scraping' || state.status === 'migrating') {
        statusBadge.classList.add('status-running');
      } else if (state.status === 'paused_captcha') {
        statusBadge.classList.add('status-paused');
      } else if (state.status === 'completed') {
        statusBadge.classList.add('status-completed');
      } else if (state.status === 'partial') {
        statusBadge.classList.add('status-paused');
      } else if (state.status === 'error') {
        statusBadge.classList.add('status-error');
      }
    }

    // Counters (aggregate across targets — still populated by the orchestrator)
    if (scrapedVal) scrapedVal.textContent = state.scrapedCount.toString();
    if (syncedVal) syncedVal.textContent = state.syncedCount.toString();
    if (failedVal) failedVal.textContent = state.failedCount.toString();

    // Progress Bar & Percentage
    // Progress is work completed over work found. Reporting 0% next to a
    // finished run (partial/error with counters already at 289) read as if
    // nothing had happened, so any state that has counters uses them.
    const processed = state.syncedCount + (state.skippedCount ?? 0) + state.failedCount;
    let pct = 0;
    if (state.totalFound > 0) {
      pct = Math.min(100, Math.round((processed / state.totalFound) * 100));
    } else if (state.status === 'completed') {
      pct = 100;
    }
    if (progressFill) progressFill.style.width = `${pct}%`;
    if (progressPctText) progressPctText.textContent = `${pct}%`;

    // Active Item Title
    if (activeTitle) {
      if (state.currentTitle) {
        activeTitle.textContent = `${dict.syncingPrefix} ${state.currentTitle}`;
        activeTitle.style.color = '#e2e8f0';
      } else if (state.status === 'paused_captcha') {
        activeTitle.textContent = dict.captchaDetected;
        activeTitle.style.color = 'var(--accent-amber)';
      } else {
        activeTitle.textContent = state.errorMessage || (state.status === 'idle' ? dict.readyTitle : dict.inProgress);
        activeTitle.style.color = state.errorMessage ? 'var(--accent-rose)' : 'var(--text-muted)';
      }
    }

    // Buttons Visibility and States
    const isRunning = state.status === 'scraping' || state.status === 'migrating';
    if (stopBtn) {
      stopBtn.style.display = isRunning ? 'inline-flex' : 'none';
    }
    if (state.status === 'paused_captcha') {
      if (startBtn) startBtn.style.display = 'none';
      if (pauseBtn) pauseBtn.style.display = 'inline-flex';
      if (scanBtn) scanBtn.disabled = true;
    } else if (isRunning) {
      if (startBtn) {
        startBtn.style.display = 'inline-flex';
        startBtn.disabled = true;
        const isScraping = state.status === 'scraping';
        startBtn.innerHTML = `
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="2" x2="12" y2="6"></line><line x1="12" y1="18" x2="12" y2="22"></line><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line><line x1="2" y1="12" x2="6" y2="12"></line><line x1="18" y1="12" x2="22" y2="12"></line><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line></svg>
          <span>${isScraping ? dict.scanning : dict.transferring}</span>
        `;
      }
      if (scanBtn) scanBtn.disabled = true;
      if (pauseBtn) pauseBtn.style.display = 'none';
    } else {
      if (startBtn) {
        startBtn.style.display = 'inline-flex';
        startBtn.disabled = false;
        startBtn.innerHTML = `
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
          <span>${dict.btnSyncNow}</span>
        `;
      }
      if (scanBtn) scanBtn.disabled = false;
      if (pauseBtn) pauseBtn.style.display = 'none';
    }
    // Per-target progress (multi-service sync)
    renderTargetProgress(state.targets);

    // Logs Box Rendering (auto-scroll only if user is already near bottom)
    if (logsBox && state.logs && state.logs.length > 0) {
      const isNearBottom = logsBox.scrollHeight - logsBox.scrollTop - logsBox.clientHeight < 40;
      logsBox.innerHTML = state.logs
        .slice(-70)
        .map((l) => {
          const time = new Date(l.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
          return `<div class="log-entry log-${l.type}"><span class="log-time">[${time}]</span> ${escapeHtml(l.message)}</div>`;
        })
        .join('');
      if (isNearBottom) {
        logsBox.scrollTop = logsBox.scrollHeight;
      }
    }
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ---------------------------------------------------------------------------
// Two-level navigation: four primary tabs + one tab per service
// ---------------------------------------------------------------------------

type TabId = 'migration' | 'export' | 'settings' | 'guide' | ServiceId;

const PRIMARY_TABS: Array<{ id: 'migration' | 'export' | 'settings' | 'guide'; btn: HTMLElement | null; pane: HTMLElement | null }> = [
  { id: 'migration', btn: tabMigrationBtn, pane: tabMigration },
  { id: 'export', btn: tabExportBtn, pane: tabExport },
  { id: 'settings', btn: tabSettingsBtn, pane: tabSettings },
  { id: 'guide', btn: tabGuideBtn, pane: tabGuide },
];

function switchTab(tab: TabId) {
  const isPrimary = (t: string): t is 'migration' | 'export' | 'settings' | 'guide' =>
    t === 'migration' || t === 'export' || t === 'settings' || t === 'guide';

  for (const entry of PRIMARY_TABS) {
    entry.btn?.classList.toggle('active', entry.id === tab);
    entry.pane?.classList.toggle('tab-hidden', entry.id !== tab);
  }

  for (const service of ALL_SERVICES) {
    const els = serviceElements[service];
    els.tabBtn?.classList.toggle('active', service === tab);
    els.pane?.classList.toggle('tab-hidden', service !== tab);
  }

  // Guard against an unknown id reaching here through a stale attribute.
  if (!isPrimary(tab) && !ALL_SERVICES.includes(tab as ServiceId)) {
    tabMigrationBtn?.classList.add('active');
    tabMigration?.classList.remove('tab-hidden');
  }
}

for (const entry of PRIMARY_TABS) {
  entry.btn?.addEventListener('click', () => switchTab(entry.id));
}

for (const service of ALL_SERVICES) {
  serviceElements[service].tabBtn?.addEventListener('click', () => switchTab(service));
}

// ---------------------------------------------------------------------------
// Per-service ping badge
// ---------------------------------------------------------------------------

type PingState = 'valid' | 'invalid' | 'checking';

function renderPing(service: ServiceId, state: PingState) {
  const els = serviceElements[service];
  const dict = translations[currentLang];

  const text =
    state === 'valid' ? dict.pingValid : state === 'invalid' ? dict.pingInvalid : dict.pingTesting;

  if (els.pingBadge) {
    els.pingBadge.style.display = 'inline-flex';
    els.pingBadge.className = state === 'checking' ? 'ping-badge' : `ping-badge ${state}`;
  }
  if (els.pingText) {
    els.pingText.textContent = text;
  }
}

/**
 * Marks an element busy for the duration of an async action so a slow request
 * cannot be double-fired, then always clears it — including on error.
 */
function withBusy<T extends HTMLElement | null>(el: T, fn: () => void): void {
  if (!el || el.classList.contains('is-busy')) return;
  el.classList.add('is-busy');
  const clear = () => el.classList.remove('is-busy');
  try {
    fn();
  } catch (err) {
    clear();
    throw err;
  }
  // The message callback always runs; a timeout guarantees release if it never does.
  window.setTimeout(clear, 15000);
}

function pingService(service: ServiceId) {
  renderPing(service, 'checking');
  const badge = serviceElements[service]?.pingBadge;
  withBusy(badge, () => {
    chrome.runtime.sendMessage({ action: 'PING_SERVICE', service }, (res: { success?: boolean; valid?: boolean; error?: string } | undefined) => {
      badge?.classList.remove('is-busy');
      if (res?.valid) {
        renderPing(service, 'valid');
      } else {
        renderPing(service, 'invalid');
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Per-service credentials, connect, enable-toggle, CSV export
// ---------------------------------------------------------------------------

function collectCredentials(service: ServiceId): ServiceCredentials {
  const els = serviceElements[service];
  const creds: ServiceCredentials = {};

  const clientId = els.clientId?.value.trim();
  const clientSecret = els.clientSecret?.value.trim();

  if (service === 'tmdb') {
    if (clientId) creds.apiKey = clientId;
  } else {
    if (clientId) creds.clientId = clientId;
    if (clientSecret) creds.clientSecret = clientSecret;
  }
  return creds;
}

function saveServiceCredentials(service: ServiceId) {
  const credentials = collectCredentials(service);
  const dict = translations[currentLang];
  const btn = serviceElements[service]?.saveBtn;

  withBusy(btn, () => {
    chrome.runtime.sendMessage(
      { action: 'SAVE_SERVICE_CREDENTIALS', service, credentials },
      (res: { success?: boolean; error?: string } | undefined) => {
        btn?.classList.remove('is-busy');
        if (res?.success) {
          pingService(service);
          // TMDB keeps its dedicated key path so the existing auth flow still works.
          if (service === 'tmdb' && credentials.apiKey) {
            chrome.runtime.sendMessage({ action: 'SAVE_API_KEY', apiKey: credentials.apiKey }, () => {});
          }
        } else {
          if (activeTitle) activeTitle.textContent = res?.error || dict.saveCredentialsError;
        }
      }
    );
  });
}

function downloadBundle(filename: string, content: string) {
  // Adapters already produced exact-format CSV including its BOM — save verbatim.
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function exportServiceCsv(service: ServiceId) {
  const dict = translations[currentLang];
  const btn = serviceElements[service]?.exportBtn;

  withBusy(btn, () => {
    chrome.runtime.sendMessage(
      { action: 'EXPORT_SERVICE_CSV', service },
      (res: { success?: boolean; files?: CsvBundle[]; error?: string } | undefined) => {
        btn?.classList.remove('is-busy');
        if (res?.success && res.files && res.files.length > 0) {
          for (const file of res.files) {
            downloadBundle(file.filename, file.content);
          }
        } else {
          alert(res?.error || dict.noExportFiles);
        }
      }
    );
  });
}

function startSimklAuth() {
  const dict = translations[currentLang];
  const els = serviceElements.simkl;
  const statusEl = document.getElementById('simklStatusText');
  const loginBtn = els?.loginBtn;

  withBusy(loginBtn, () => {
    chrome.runtime.sendMessage(
      { action: 'SIMKL_START_AUTH' },
      (res: { success?: boolean; userCode?: string; verificationUrl?: string; error?: string } | undefined) => {
        loginBtn?.classList.remove('is-busy');
        if (!res?.success || !res.userCode) {
          if (statusEl) statusEl.textContent = res?.error || dict.pingError;
          return;
        }

        // The PIN is confirmed on Simkl, not here, so show it, copy it, and let
        // the user approve it on the page that opens.
        if (statusEl) statusEl.textContent = res.userCode;
        navigator.clipboard?.writeText(res.userCode).catch(() => {});
        chrome.tabs.create({ url: res.verificationUrl || 'https://simkl.com/pin' });

        alert(
          currentLang === 'ru'
            ? `Код ${res.userCode} скопирован. Введите его на открывшейся странице Simkl и нажмите ОК.`
            : `Code ${res.userCode} copied. Enter it on the Simkl page that just opened, then press OK.`
        );

        chrome.runtime.sendMessage(
          { action: 'SIMKL_COMPLETE_AUTH', userCode: res.userCode },
          (done: { success?: boolean; error?: string } | undefined) => {
            if (statusEl) {
              statusEl.textContent = done?.success
                ? currentLang === 'ru'
                  ? 'Подключено'
                  : 'Connected'
                : done?.error || dict.pingError;
            }
            pingService('simkl');
          }
        );
      }
    );
  });
}

for (const service of ALL_SERVICES) {
  const els = serviceElements[service];

  els.saveBtn?.addEventListener('click', () => saveServiceCredentials(service));

  els.loginBtn?.addEventListener('click', () => {
    if (service === 'tmdb') {
      tmdbLoginBtn?.click();
      return;
    }
    if (service === 'simkl') {
      startSimklAuth();
      return;
    }
    pingService(service);
  });

  els.enableToggle?.addEventListener('change', () => {
    const enabled = !!els.enableToggle?.checked;
    chrome.runtime.sendMessage({ action: 'TOGGLE_TARGET', service, enabled }, () => {
      setEnabledTargets(
        enabled ? [...enabledTargets, service] : enabledTargets.filter((s) => s !== service)
      );
    });
  });

  els.exportBtn?.addEventListener('click', () => exportServiceCsv(service));
}

function setEnabledTargets(targets: ServiceId[]) {
  enabledTargets = Array.from(new Set(targets));
  chrome.storage.local.set({ enabledTargets });
}

// ---------------------------------------------------------------------------
// Per-target progress rendering
// ---------------------------------------------------------------------------

function renderTargetProgress(targets: TargetProgress[] | undefined) {
  if (!targetProgressList) return;
  if (!targets || targets.length === 0) {
    targetProgressList.innerHTML = '';
    return;
  }

  targetProgressList.innerHTML = targets
    .map((t) => {
      const errText = t.error ? ` · ${escapeHtml(t.error)}` : '';
      const reauth =
        t.error === 'AUTH_EXPIRED'
          ? `<button class="btn btn-secondary" data-reauth="${t.service}">${escapeHtml(
              translations[currentLang].reauthBtn
            )}</button>`
          : '';
      // Show a product name and a readable status, not the raw service id and
      // the wire value ('tmdb completed') the orchestrator happens to use.
      const serviceName = translations[currentLang][`svc${t.service[0].toUpperCase()}${t.service.slice(1)}`] ?? t.service;
      const statusText = translations[currentLang][`targetStatus${t.status[0].toUpperCase()}${t.status.slice(1)}`] ?? t.status;
      return `<div class="target-progress-row">
        <span class="target-name">${escapeHtml(serviceName)}</span>
        <span class="target-status">${escapeHtml(statusText)}${errText}</span>
        <span class="target-counters">${t.synced} / ${t.skipped} / ${t.failed}</span>
        ${reauth}
      </div>`;
    })
    .join('');

  targetProgressList.querySelectorAll<HTMLElement>('[data-reauth]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const service = btn.getAttribute('data-reauth') as ServiceId | null;
      if (service) switchTab(service);
    });
  });
}

// ---------------------------------------------------------------------------
// Start sync over the enabled targets
// ---------------------------------------------------------------------------

function startSync() {
  const dict = translations[currentLang];
  if (enabledTargets.length === 0) {
    alert(dict.noTargetsSelected);
    return;
  }
  const category = (categorySelect?.value as MediaCategory) || 'both';
  chrome.runtime.sendMessage(
    { action: 'START_SYNC', targets: enabledTargets, category },
    (res: { success?: boolean; error?: string } | undefined) => {
      if (!res?.success && res?.error) {
        alert(res.error);
      }
      refreshState();
    }
  );
}

startBtn?.addEventListener('click', startSync);

// ---------------------------------------------------------------------------
// Restore enabled targets and ping anything already credentialed
// ---------------------------------------------------------------------------

chrome.storage.local.get(['enabledTargets'], (res) => {
  if (Array.isArray(res.enabledTargets)) {
    enabledTargets = res.enabledTargets as ServiceId[];
    // Reflect stored state in BOTH directions. Applying only the stored-on
    // services left every toggle whose HTML default is `checked` looking armed
    // while `enabledTargets` was empty — the user pressed Sync, the guard saw
    // zero targets, and nothing happened with no visible cause.
    for (const service of ALL_SERVICES) {
      const toggle = serviceElements[service]?.enableToggle;
      if (toggle) toggle.checked = enabledTargets.includes(service);
    }
  }
});

for (const service of ALL_SERVICES) {
  const els = serviceElements[service];
  const hasValue = !!els.clientId?.value.trim();
  if (hasValue) pingService(service);
}

// Initial pull + polling interval
refreshState();
setInterval(refreshState, 1000);

