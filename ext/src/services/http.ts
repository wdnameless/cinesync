export interface HttpOptions {
  headers?: Record<string, string>;
  /** minimum ms between requests for this client instance */
  minIntervalMs?: number;
}

// Track schedule for throttle per options instance and per origin
const instanceSchedule = new WeakMap<object, number>();
const originSchedule = new Map<string, number>();

function extractOrigin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

async function applyThrottle(url: string, opts?: HttpOptions): Promise<void> {
  const minInterval = opts?.minIntervalMs;
  if (!minInterval || minInterval <= 0) {
    return;
  }

  const now = Date.now();
  const origin = extractOrigin(url);

  const prevOriginScheduled = originSchedule.get(origin) ?? 0;
  const prevInstanceScheduled = opts ? (instanceSchedule.get(opts) ?? 0) : 0;

  const scheduled = Math.max(now, prevOriginScheduled, prevInstanceScheduled);
  const nextAvailable = scheduled + minInterval;

  originSchedule.set(origin, nextAvailable);
  if (opts) {
    instanceSchedule.set(opts, nextAvailable);
  }

  const delayMs = scheduled - now;
  if (delayMs > 0) {
    await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
  }
}

function buildHeaders(initHeaders?: HeadersInit, optHeaders?: Record<string, string>): Headers {
  const headers = new Headers(initHeaders);
  if (optHeaders) {
    for (const [key, value] of Object.entries(optHeaders)) {
      if (!headers.has(key)) {
        headers.set(key, value);
      }
    }
  }
  return headers;
}

function parseRetryAfter(res: Response): number {
  const header = res.headers.get('Retry-After');
  if (header) {
    const seconds = parseFloat(header);
    if (!Number.isNaN(seconds) && seconds >= 0) {
      return Math.max(500, Math.ceil(seconds * 1000));
    }
    const dateMs = Date.parse(header);
    if (!Number.isNaN(dateMs)) {
      const diff = dateMs - Date.now();
      return Math.max(500, diff);
    }
  }
  return 1000;
}

export async function jsonRequest<T>(
  url: string,
  init: RequestInit,
  opts?: HttpOptions
): Promise<T> {
  const headers = buildHeaders(init.headers, opts?.headers);
  const requestInit: RequestInit = {
    ...init,
    headers,
  };

  await applyThrottle(url, opts);
  let response = await fetch(url, requestInit);

  // One retry on HTTP 429 honouring Retry-After
  if (response.status === 429) {
    const retryDelayMs = parseRetryAfter(response);
    await new Promise<void>((resolve) => setTimeout(resolve, retryDelayMs));
    await applyThrottle(url, opts);
    response = await fetch(url, requestInit);
  }

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    const err = new Error(`HTTP ${response.status} ${response.statusText}: ${bodyText}`);
    Object.assign(err, {
      status: response.status,
      statusText: response.statusText,
      body: bodyText,
    });
    throw err;
  }

  if (response.status === 204) {
    return undefined as unknown as T;
  }

  const text = await response.text();
  if (!text.trim()) {
    return undefined as unknown as T;
  }

  return JSON.parse(text) as T;
}
