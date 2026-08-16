/**
 * Аварийные коды, только что выданные сервером, — по дороге от терминала операции к экрану показа.
 *
 * Живут в памяти вкладки и намеренно НЕ персистятся: сервер отдаёт их единственным ответом, и
 * запись в хранилище оставила бы их лежать в браузере дольше самого показа. Цена — reload коды
 * теряет, о чём экран предупреждает заранее.
 *
 * Чистятся кнопкой «Я сохранил коды» и вместе с остальным состоянием ушедшей сессии (см.
 * sessionScopedState): коды ушедшего пользователя следующему в этой вкладке доставаться не должны.
 */

let codes: string[] | null = null;
let reissued = false;

/**
 * `reissued` — набор заменил собой прежний, а не выдан впервые. Едет вместе с кодами, а не
 * переходом: на экран показа ведут два перехода подряд — свой у закрытой операции и запасной у
 * страницы, оставшейся без снимка, — и второй затёр бы всё, что нёс первый.
 */
export function setRecoveryCodes(list: string[], options?: { reissued?: boolean }): void {
  codes = list;
  reissued = options?.reissued === true;
}

/** Чтение не гасит коды: экран показа перечитывает их на каждом рендере. Гасит clear*(). */
export function getRecoveryCodes(): string[] | null {
  return codes;
}

export function areRecoveryCodesReissued(): boolean {
  return reissued;
}

export function clearRecoveryCodes(): void {
  codes = null;
  reissued = false;
}
