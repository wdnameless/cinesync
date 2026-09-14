import { MigrationState, MovieItem } from './types';

// DOM Elements
const apiKeyInput = document.getElementById('apiKey') as HTMLInputElement;
const saveKeyBtn = document.getElementById('saveKeyBtn') as HTMLButtonElement;
const kpApiKeyInput = document.getElementById('kpApiKey') as HTMLInputElement;
const saveKpKeyBtn = document.getElementById('saveKpKeyBtn') as HTMLButtonElement;
const sessionStatusText = document.getElementById('sessionStatusText') as HTMLElement;
const sessionDot = document.getElementById('sessionDot') as HTMLElement;
const tmdbLoginBtn = document.getElementById('tmdbLoginBtn') as HTMLButtonElement;
const tmdbConfirmBtn = document.getElementById('tmdbConfirmBtn') as HTMLButtonElement;

const tabMigrationBtn = document.getElementById('tabMigrationBtn') as HTMLButtonElement;
const tabExportBtn = document.getElementById('tabExportBtn') as HTMLButtonElement;
const tabSettingsBtn = document.getElementById('tabSettingsBtn') as HTMLButtonElement;
const tabGuideBtn = document.getElementById('tabGuideBtn') as HTMLButtonElement;

const tabMigration = document.getElementById('tabMigration') as HTMLElement;
const tabExport = document.getElementById('tabExport') as HTMLElement;
const tabSettings = document.getElementById('tabSettings') as HTMLElement;
const tabGuide = document.getElementById('tabGuide') as HTMLElement;

const tmdbPingBadge = document.getElementById('tmdbPingBadge') as HTMLElement;
const tmdbPingText = document.getElementById('tmdbPingText') as HTMLElement;
const kpPingBadge = document.getElementById('kpPingBadge') as HTMLElement;
const kpPingText = document.getElementById('kpPingText') as HTMLElement;

function switchTab(tab: 'migration' | 'export' | 'settings' | 'guide') {
  tabMigrationBtn?.classList.toggle('active', tab === 'migration');
  tabExportBtn?.classList.toggle('active', tab === 'export');
  tabSettingsBtn?.classList.toggle('active', tab === 'settings');
  tabGuideBtn?.classList.toggle('active', tab === 'guide');

  tabMigration?.classList.toggle('tab-hidden', tab !== 'migration');
  tabExport?.classList.toggle('tab-hidden', tab !== 'export');
  tabSettings?.classList.toggle('tab-hidden', tab !== 'settings');
  tabGuide?.classList.toggle('tab-hidden', tab !== 'guide');
}

tabMigrationBtn?.addEventListener('click', () => switchTab('migration'));
tabExportBtn?.addEventListener('click', () => switchTab('export'));
tabSettingsBtn?.addEventListener('click', () => switchTab('settings'));
tabGuideBtn?.addEventListener('click', () => switchTab('guide'));
const btnOpenGuideFromKeys = document.getElementById('btnOpenGuideFromKeys') as HTMLButtonElement;
btnOpenGuideFromKeys?.addEventListener('click', () => switchTab('guide'));
const scanBtn = document.getElementById('scanBtn') as HTMLButtonElement;
const startBtn = document.getElementById('startBtn') as HTMLButtonElement;
const stopBtn = document.getElementById('stopBtn') as HTMLButtonElement;
const pauseBtn = document.getElementById('pauseBtn') as HTMLButtonElement;
const resetBtn = document.getElementById('resetBtn') as HTMLButtonElement;
const langRu = document.getElementById('langRu') as HTMLButtonElement;
const langEn = document.getElementById('langEn') as HTMLButtonElement;
const statusBadge = document.getElementById('statusBadge') as HTMLElement;
const scrapedVal = document.getElementById('scrapedVal') as HTMLElement;
const syncedVal = document.getElementById('syncedVal') as HTMLElement;
const failedVal = document.getElementById('failedVal') as HTMLElement;
const progressFill = (document.getElementById('progressFill') || document.getElementById('progressBar')) as HTMLElement;
const progressPctText = (document.getElementById('progressPctText') || document.getElementById('progressPercent')) as HTMLElement;
const activeTitle = (document.getElementById('activeTitle') || document.getElementById('progressTitle')) as HTMLElement;
const logsBox = document.getElementById('logsBox') as HTMLElement;
const clearLogsBtn = document.getElementById('clearLogsBtn') as HTMLButtonElement;

const exportRatedBtn = document.getElementById('exportRatedBtn') as HTMLButtonElement;
const exportWatchlistBtn = document.getElementById('exportWatchlistBtn') as HTMLButtonElement;
type Lang = 'ru' | 'en';
let currentLang: Lang = 'ru';

const translations: Record<Lang, Record<string, string>> = {
  ru: {
    tabTransfer: 'Перенос',
    tabExport: 'Экспорт CSV',
    tabSettings: 'Ключи',
    tabGuide: 'Инструкция',
    guideHeader: 'Пошаговое руководство',
    step1Title: 'Получите TMDB API Key',
    step1Desc: 'Зарегистрируйтесь на themoviedb.org, перейдите в Настройки ➔ API и создайте бесплатный ключ разработчика (Developer Key v3).',
    step1Link: 'Открыть TMDB API ↗',
    step2Title: 'Авторизуйтесь через TMDB',
    step2Desc: 'Вставьте ключ во вкладке «Ключи», нажмите «Войти», разрешите доступ во всплывающем окне и нажмите «Подтвердить».',
    step3Title: 'Сканируйте свой Кинопоиск',
    step3Desc: 'Откройте вкладку со своим профилем на kinopoisk.ru и нажмите «1. Сканировать КП». Можно переключаться на другие аккаунты параллельно.',
    step4Title: 'Переносите в TMDB без дублей',
    step4Desc: 'Нажмите «2. В TMDB». Расширение автоматически проверит ваш аккаунт и пропустит фильмы, где уже стоят оценки!',
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
    titleKp: 'Кинопоиск',
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
    lblSynced: 'В TMDB',
    lblFailed: 'Ошибки',
    btnScan: '1. Сканировать КП',
    btnStart: '2. В TMDB',
    btnStop: 'Стоп',
    btnResume: 'Продолжить',
    btnReset: 'Сброс',
    btnExportRated: '⭐ Экспорт оценок (CSV)',
    btnExportWl: '📑 Экспорт Watchlist (CSV)',
    btnExportFull: '💾 Полный архив базы (Кинопоиск CSV)',
    logsTitle: 'Логи событий',
    readyTitle: 'Готов к запуску',
    resetConfirm: 'Сбросить прогресс и очистить очередь?',
    emptyRatings: 'Нет собранных оценок! Сначала нажмите "1. Сканировать КП".',
    emptyWl: 'Список «Буду смотреть» пуст! Сначала нажмите "1. Сканировать КП".',
    emptyBackup: 'Нет данных для экспорта! Сначала нажмите "1. Сканировать КП".',
    stoppedMsg: 'Процесс остановлен пользователем',
  },
  en: {
    tabTransfer: 'Transfer',
    tabExport: 'Export CSV',
    tabSettings: 'API Keys',
    tabGuide: 'User Guide',
    guideHeader: 'Step-by-Step Guide',
    step1Title: 'Get TMDB API Key',
    step1Desc: 'Register at themoviedb.org, navigate to Settings ➔ API, and generate your free Developer Key v3.',
    step1Link: 'Open TMDB API ↗',
    step2Title: 'Sign in via TMDB',
    step2Desc: 'Paste the key in the «API Keys» tab, click «Sign In», approve access in the browser tab, then click «Confirm».',
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
    titleKp: 'Kinopoisk',
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
    lblSynced: 'In TMDB',
    lblFailed: 'Failed',
    btnScan: '1. Scan Kinopoisk',
    btnStart: '2. Transfer to TMDB',
    btnStop: 'Stop',
    btnResume: 'Resume',
    btnReset: 'Reset',
    btnExportRated: '⭐ Export Ratings (CSV)',
    btnExportWl: '📑 Export Watchlist (CSV)',
    btnExportFull: '💾 Full Backup Archive (CSV)',
    logsTitle: 'Event Logs',
    readyTitle: 'Ready to start',
    resetConfirm: 'Reset progress and clear queue?',
    emptyRatings: 'No ratings found! Please click "1. Scan Kinopoisk" first.',
    emptyWl: 'Watchlist is empty! Please click "1. Scan Kinopoisk" first.',
    emptyBackup: 'No data to export! Please click "1. Scan Kinopoisk" first.',
    stoppedMsg: 'Process stopped by user',
  }
};

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
const exportCsvBtn = document.getElementById('exportCsvBtn') as HTMLButtonElement;

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
  logsBox.innerHTML = '<div class="log-entry log-info"><span class="log-time">[Clear]</span> Журнал очищен</div>';
});

// Initialize Settings & Storage
chrome.storage.local.get(['tmdbAuth', 'tmdbApiKey', 'tmdbSessionId', 'tmdbUsername', 'kpApiKey', 'categoryScope'], (res) => {
  const auth = res.tmdbAuth || {};
  const apiKey = auth.apiKey || res.tmdbApiKey || '';
  const sessionId = auth.sessionId || res.tmdbSessionId || '';
  const username = auth.username || res.tmdbUsername || '';

  if (apiKey) {
    apiKeyInput.value = apiKey;
    pingTmdbKey(apiKey);
  }
  if (res.kpApiKey) {
    kpApiKeyInput.value = res.kpApiKey;
    pingKpKey(res.kpApiKey);
  }
  if (res.categoryScope) categorySelect.value = res.categoryScope;

  updateSessionDisplay(!!sessionId, username);
});
categorySelect?.addEventListener('change', () => {
  chrome.storage.local.set({ categoryScope: categorySelect.value });
});

function updateSessionDisplay(isAuth: boolean, username?: string) {
  if (isAuth) {
    sessionStatusText.textContent = username ? `Авторизован (${username})` : 'Активна';
    sessionStatusText.style.color = '#34d399';
    if (sessionDot) {
      sessionDot.className = 'dot active';
    }
    tmdbLoginBtn.textContent = 'Сменить аккаунт';
    tmdbLoginBtn.classList.remove('btn-tmdb');
    tmdbConfirmBtn.style.display = 'none';
  } else {
    sessionStatusText.textContent = 'Не авторизован';
    sessionStatusText.style.color = '#9ca3af';
    if (sessionDot) {
      sessionDot.className = 'dot';
    }
    tmdbLoginBtn.textContent = 'Войти в TMDB';
    tmdbLoginBtn.classList.add('btn-tmdb');
  }
}

function pingTmdbKey(key: string) {
  if (!key) {
    if (tmdbPingBadge) tmdbPingBadge.style.display = 'none';
    return;
  }
  if (tmdbPingBadge) {
    tmdbPingBadge.style.display = 'inline-flex';
    tmdbPingBadge.className = 'ping-badge';
    tmdbPingText.textContent = translations[currentLang].pingTesting;
  }
  chrome.runtime.sendMessage({ action: 'PING_TMDB_KEY', apiKey: key }, (res) => {
    if (tmdbPingBadge) {
      if (res?.valid) {
        tmdbPingBadge.className = 'ping-badge valid';
        tmdbPingText.textContent = translations[currentLang].pingValid;
      } else {
        tmdbPingBadge.className = 'ping-badge invalid';
        tmdbPingText.textContent = translations[currentLang].pingInvalid;
      }
    }
  });
}

function pingKpKey(key: string) {
  if (!key) {
    if (kpPingBadge) kpPingBadge.style.display = 'none';
    return;
  }
  if (kpPingBadge) {
    kpPingBadge.style.display = 'inline-flex';
    kpPingBadge.className = 'ping-badge';
    kpPingText.textContent = translations[currentLang].pingTesting;
  }
  chrome.runtime.sendMessage({ action: 'PING_KP_KEY', kpApiKey: key }, (res) => {
    if (kpPingBadge) {
      if (res?.valid) {
        kpPingBadge.className = 'ping-badge valid';
        kpPingText.textContent = translations[currentLang].pingValid;
      } else {
        kpPingBadge.className = 'ping-badge invalid';
        kpPingText.textContent = translations[currentLang].pingInvalid;
      }
    }
  });
}

// Save TMDB API Key
saveKeyBtn?.addEventListener('click', () => {
  const key = apiKeyInput.value.trim();
  chrome.runtime.sendMessage({ action: 'SAVE_API_KEY', apiKey: key }, () => {
    chrome.storage.local.set({ tmdbApiKey: key }, () => {
      pulseSuccess(saveKeyBtn, '✓');
      pingTmdbKey(key);
    });
  });
});
// Save KP API Key
saveKpKeyBtn?.addEventListener('click', () => {
  const key = kpApiKeyInput.value.trim();
  chrome.runtime.sendMessage({ action: 'SAVE_KP_API_KEY', kpApiKey: key }, () => {
    chrome.storage.local.set({ kpApiKey: key }, () => {
      pulseSuccess(saveKpKeyBtn, '✓');
      pingKpKey(key);
    });
  });
});

// TMDB Login Workflow
tmdbLoginBtn?.addEventListener('click', () => {
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
      tmdbLoginBtn.disabled = false;
      if (res?.success) {
        tmdbLoginBtn.textContent = currentLang === 'ru' ? 'Вход в браузере...' : 'Opening browser...';
        tmdbConfirmBtn.style.display = 'inline-flex';
        sessionStatusText.textContent = currentLang === 'ru' ? 'Одобрите доступ на сайте TMDB' : 'Approve access on TMDB';
        sessionStatusText.style.color = '#fbbf24';
      } else {
        tmdbLoginBtn.textContent = currentLang === 'ru' ? 'Войти в TMDB' : 'Login to TMDB';
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
  const category = (categorySelect.value as MediaCategory) || 'both';
  chrome.runtime.sendMessage({ action: 'START_SCANNING', category }, (response) => {
    if (response?.error) {
      alert(`Ошибка: ${response.error}`);
    } else {
      refreshState();
    }
  });
});

startBtn?.addEventListener('click', () => {
  const category = (categorySelect.value as MediaCategory) || 'both';
  chrome.runtime.sendMessage({ action: 'START_MIGRATION', category }, (response) => {
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
  const dict = translations[currentLang];
  if (!rated.length) {
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
  pulseSuccess(exportRatedBtn, 'Готово!');
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
    statusBadge.textContent = state.status.toUpperCase();
    statusBadge.className = 'status-badge';
    if (state.status === 'scraping' || state.status === 'migrating') {
      statusBadge.classList.add('status-running');
    } else if (state.status === 'paused_captcha') {
      statusBadge.classList.add('status-paused');
    } else if (state.status === 'completed') {
      statusBadge.classList.add('status-completed');
    } else if (state.status === 'error') {
      statusBadge.classList.add('status-error');
    }

    // Counters
    scrapedVal.textContent = state.scrapedCount.toString();
    syncedVal.textContent = state.syncedCount.toString();
    failedVal.textContent = state.failedCount.toString();

    // Progress Bar & Percentage
    let pct = 0;
    if (state.status === 'migrating' && state.totalFound > 0) {
      pct = Math.min(100, Math.round(((state.syncedCount + state.failedCount) / state.totalFound) * 100));
    } else if (state.status === 'completed') {
      pct = 100;
    }
    if (progressFill) progressFill.style.width = `${pct}%`;
    if (progressPctText) progressPctText.textContent = `${pct}%`;

    // Active Item Title
    if (activeTitle) {
      if (state.currentTitle) {
        activeTitle.textContent = `Синхронизация: ${state.currentTitle}`;
        activeTitle.style.color = '#e2e8f0';
      } else if (state.status === 'paused_captcha') {
        activeTitle.textContent = '⚠️ Обнаружена капча! Пройдите её во вкладке Кинопоиска';
        activeTitle.style.color = 'var(--accent-amber)';
      } else {
        activeTitle.textContent = state.errorMessage || (state.status === 'idle' ? 'Готов к запуску' : 'В процессе...');
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
          <span>${isScraping ? (currentLang === 'ru' ? 'Сбор...' : 'Scanning...') : (currentLang === 'ru' ? 'Перенос...' : 'Transferring...')}</span>
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
          <span>${currentLang === 'ru' ? '2. В TMDB' : '2. To TMDB'}</span>
        `;
      }
      if (scanBtn) scanBtn.disabled = false;
      if (pauseBtn) pauseBtn.style.display = 'none';
    }
    // Logs Box Rendering (auto-scroll only if user is already near bottom)
    if (state.logs && state.logs.length > 0) {
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

// Initial pull + polling interval
refreshState();
setInterval(refreshState, 1000);
