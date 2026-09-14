// ext/src/content.ts
console.log("Media Migrator: Content Script Initialized!");

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log("Media Migrator: Received action", request.action);
    if (request.action === "SCRAPE_KP") {
        console.log("Media Migrator: Scraping started...");
        
        // 1. Агрессивно ищем данные в window
        const dataObjects = [];
        for (const key in window) {
            if (key.includes('SERVER_DATA') || key.includes('PRELOADED')) {
                console.log("Found global object:", key, (window as any)[key]);
                dataObjects.push((window as any)[key]);
            }
        }
        
        // 2. Fallback: поиск ссылок
        const links = Array.from(document.querySelectorAll('a[href*="/film/"], a[href*="/series/"]'))
            .map(a => a.getAttribute('href'));
            
        console.log("DOM Links found:", links.length);
        sendResponse({ items: dataObjects, links: links.slice(0, 10), count: dataObjects.length });
    }
    return true;
});