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

/**
 * Смена емаила — две операции подряд, и у каждой свой вид: первая (`email`, либо `email-recovery`
 * без доступа к текущему адресу) доказывает владение аккаунтом, вторая (`…-confirm`) — владение
 * новым адресом. Вторую открывает терминал первой, и вид записи меняется вместе с ней: по нему
 * экран выбирает и тексты, и следующий терминал.
 *
 * К второй операции возвращаются и из профиля — из другой вкладки или с другого устройства. Каким
 * был шаг 1, запись профиля не говорит, поэтому у возврата свой вид (`email-confirm-resume`): он
 * ведёт себя как `email-confirm`, но ступеней не показывает — назвать пройденный путь нечем.
 */
export type SecurityFlowKind =
  | 'password'
  | 'totp'
  | 'recovery-codes'
  | 'disable2fa'
  | 'email'
  | 'email-recovery'
  | 'email-confirm'
  | 'email-recovery-confirm'
  | 'email-confirm-resume'
  | 'phone';

const KINDS: readonly SecurityFlowKind[] = [
  'password',
  'totp',
  'recovery-codes',
  'disable2fa',
  'email',
  'email-recovery',
  'email-confirm',
  'email-recovery-confirm',
  'email-confirm-resume',
  'phone',
];

export interface SecurityFlowRecord {
  kind: SecurityFlowKind;
  token?: string;
  /**
   * Новое значение, которое поток устанавливает, — емаил или номер. Снимок операции его не несёт,
   * а экран подтверждения называет его в подсказке: код с нового адреса иначе не отличить от кода
   * с текущего.
   */
  value?: string;
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
      value: typeof parsed.value === 'string' ? parsed.value : undefined,
    };
  } catch {
    sessionStorage.removeItem(KEY);
    return null;
  }
}

export function clearSecurityFlow(): void {
  sessionStorage.removeItem(KEY);
}
