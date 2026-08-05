/**
 * Какому потоку принадлежит активная операция подтверждения. Снимок операции этого не помнит: у
 * него есть токен и метод звена, но не назначение — а завершать операцию надо своим `apply-*`.
 * Точек входа две: гостевой /confirm (терминал — открытие сессии) и авторизованный
 * /security/confirm (терминал — метод потока). Наличие записи и есть признак security-операции,
 * её отсутствие — auth-операции; обе страницы сверяются с записью и уводят чужой поток на его
 * экран.
 *
 * Храним в sessionStorage рядом с самой операцией — по тем же причинам (переживает reload,
 * чистится при закрытии вкладки). `token` нужен там, где операция уже подтверждена, а её
 * завершение идёт отдельным экраном: снимок к этому моменту стёрт, и токен больше взять неоткуда.
 */

const KEY = 'auth:securityFlow';

export type SecurityFlowKind = 'password' | 'totp' | 'recovery-codes' | 'disable2fa';

const KINDS: readonly SecurityFlowKind[] = ['password', 'totp', 'recovery-codes', 'disable2fa'];

export interface SecurityFlowRecord {
  kind: SecurityFlowKind;
  token?: string;
}

export function saveSecurityFlow(record: SecurityFlowRecord): void {
  sessionStorage.setItem(KEY, JSON.stringify(record));
}

/**
 * Запись потока или null, если её нет либо она не разобралась. Вид потока сверяем со списком: по
 * нему выбирается терминальное действие, и запись с неизвестным `kind` увела бы на экран
 * подтверждения, закрыть который нечем. Непригодную запись убираем — она уже никому не пригодится.
 */
export function loadSecurityFlow(): SecurityFlowRecord | null {
  const raw = sessionStorage.getItem(KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<SecurityFlowRecord>;
    if (!parsed?.kind || !KINDS.includes(parsed.kind)) {
      sessionStorage.removeItem(KEY);
      return null;
    }
    return {
      kind: parsed.kind,
      token: typeof parsed.token === 'string' ? parsed.token : undefined,
    };
  } catch {
    sessionStorage.removeItem(KEY);
    return null;
  }
}

export function clearSecurityFlow(): void {
  sessionStorage.removeItem(KEY);
}
