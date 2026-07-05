import type { OperationSnapshot } from './operationMachine';

/**
 * Персист op-состояния в sessionStorage и возобновление при reload — снимает обход резенд-лимита
 * через перезагрузку (см. память [[operation-token]]). Код (secret) НЕ храним. Абсолютные таймеры
 * позволяют пересчитать остаток от now. sessionStorage (не cookie): на сервер слать не нужно,
 * JS должен читать; чистится при закрытии вкладки.
 */

const KEY = 'auth:operation';

export function saveOperation(s: OperationSnapshot | null): void {
  if (!s || s.phase === 'done' || s.phase === 'idle') {
    sessionStorage.removeItem(KEY);
    return;
  }
  sessionStorage.setItem(KEY, JSON.stringify(s));
}

export function loadOperation(now: number): OperationSnapshot | null {
  const raw = sessionStorage.getItem(KEY);
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as OperationSnapshot;
    // Просроченную операцию не возобновляем.
    if (now >= s.expiresAt) {
      sessionStorage.removeItem(KEY);
      return null;
    }
    return s;
  } catch {
    sessionStorage.removeItem(KEY);
    return null;
  }
}

export function clearOperation(): void {
  sessionStorage.removeItem(KEY);
}
