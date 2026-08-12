/**
 * Куда вернуть по «Отменить» с общего экрана /confirm (signup → /signup, signin → /signin).
 * Храним в sessionStorage рядом с самой операцией — чтобы переживать reload (операция
 * возобновляется из sessionStorage, а location.state — нет). Пишет обработчик потока перед
 * переходом на /confirm; читает узел подтверждения; чистится при завершении операции.
 *
 * Записи может не быть, и подставлять за неё что-то хранилище не берётся: «некуда возвращать» и
 * «возвращать на вход» — разные факты, и читателей у них двое. Навигации нужен любой рабочий адрес,
 * поэтому дефолт она задаёт сама; выбору подсказки нужен именно исходный экран, и догадка вместо
 * него стоила бы попытки подтверждения.
 */

const KEY = 'auth:confirmReturn';

export function saveConfirmReturn(path: string): void {
  sessionStorage.setItem(KEY, path);
}

export function loadConfirmReturn(): string | null {
  return sessionStorage.getItem(KEY);
}

export function clearConfirmReturn(): void {
  sessionStorage.removeItem(KEY);
}
