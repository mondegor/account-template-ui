/**
 * Клиентская корреляционная сессия: UUID в sessionStorage, ротация по 20-мин простою
 * и по закрытию вкладки. Это НЕ auth-сессия — только для трассировки запросов
 * (заголовок X-Correlation-Id). См. память [[request-headers]].
 */

const KEY = 'x-correlation-id';
const LAST_SEEN_KEY = 'x-correlation-id:last-seen';
const IDLE_LIMIT_MS = 20 * 60 * 1000;

function newId(): string {
  return crypto.randomUUID();
}

export function getCorrelationId(): string {
  const now = Date.now();
  let id = sessionStorage.getItem(KEY);
  const lastSeen = Number(sessionStorage.getItem(LAST_SEEN_KEY) ?? 0);

  if (!id || now - lastSeen > IDLE_LIMIT_MS) {
    id = newId();
    sessionStorage.setItem(KEY, id);
  }
  sessionStorage.setItem(LAST_SEEN_KEY, String(now));
  return id;
}
