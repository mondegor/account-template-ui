/**
 * Куда вернуть по «Отменить» с общего экрана /confirm (signup → /signup, signin → /signin).
 * Храним в sessionStorage рядом с самой операцией ([[operation-token]]) — чтобы переживать reload
 * (операция возобновляется из sessionStorage, а location.state — нет). Пишет обработчик потока
 * перед переходом на /confirm; читает узел подтверждения; чистится при завершении операции.
 */

const KEY = 'auth:confirmReturn';

export function saveConfirmReturn(path: string): void {
  sessionStorage.setItem(KEY, path);
}

export function loadConfirmReturn(): string {
  return sessionStorage.getItem(KEY) ?? '/signin';
}

export function clearConfirmReturn(): void {
  sessionStorage.removeItem(KEY);
}
