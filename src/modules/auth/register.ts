import { registerHandler, type AsyncValidator, type SchemaHandler } from '@core/schema';
import { i18next } from '@core/i18n';
import { onForcedLogout } from '@core/auth';
import { signin, signinByRecovery, signup } from './api/authApi';
import { checkEmailAvailability } from './lib/emailAvailability';
import { saveConfirmReturn } from './lib/confirmReturn';
import { dropSessionScopedState } from './lib/sessionScopedState';

/**
 * Императивная часть модуля auth — обработчики схем (связь «схема → логика») и подписки; зовётся
 * из onInit его ModuleDefinition (module.tsx). realm обработчики берут внутри authApi (из
 * realmProvider), в форме его нет. Декларативные поля (схемы/переводы/типы узлов) — в module.tsx.
 */

const signupHandler: SchemaHandler = async (values, ctx) => {
  const op = await signup(String(values.user_email ?? '').trim());
  ctx.dispatchOperation({ type: 'START', parts: op, now: Date.now() });
  // Экран /confirm общий для signup/signin — запоминаем, куда вернуть по «Отменить».
  saveConfirmReturn('/signup');
  ctx.navigate('/confirm');
};

const signinHandler: SchemaHandler = async (values, ctx) => {
  const op = await signin(String(values.user_login ?? '').trim());
  ctx.dispatchOperation({ type: 'START', parts: op, now: Date.now() });
  saveConfirmReturn('/signin');
  ctx.navigate('/confirm');
};

/**
 * Резервный вход отличается от обычного только методом-инициатором: дальше та же операция и тот же
 * общий экран подтверждения, который сам ведёт по звеньям цепочки. Возврат по «Отменить» свой —
 * человек пришёл с резервного экрана, и обычный вход ему как раз не годится.
 */
const signinRecoveryHandler: SchemaHandler = async (values, ctx) => {
  const op = await signinByRecovery(String(values.user_login ?? '').trim());
  ctx.dispatchOperation({ type: 'START', parts: op, now: Date.now() });
  saveConfirmReturn('/signin/recovery');
  ctx.navigate('/confirm');
};

/**
 * Асинк-проверка доступности email на регистрации (на submit). Занят (400) → текст ошибки под поле;
 * если сервер не прислал detail — общий фолбэк-текст (иначе занятый email проскочил бы гейт).
 * 5xx/сеть — остаёмся нейтральны: не подтверждаем доступность, но и не блокируем ввод (реальный
 * гейт — сам signup), поэтому под полем ничего не показываем.
 */
const emailAvailable: AsyncValidator = async (value) => {
  const result = await checkEmailAvailability(String(value ?? ''));
  return result.state === 'taken' ? (result.message ?? i18next.t('auth.field.emailTaken')) : null;
};

let registered = false;

/** Регистрирует обработчики схем и подписки модуля (идемпотентно). Зовётся из authModule.onInit. */
export function initAuthModule(): void {
  if (registered) return;
  registered = true;
  registerHandler('auth.signup', {
    handler: signupHandler,
    asyncValidators: { user_email: emailAvailable },
  });
  registerHandler('auth.signin', { handler: signinHandler });
  registerHandler('auth.signinRecovery', { handler: signinRecoveryHandler });

  // Принудительный разлогин (протухший refresh, reuse токена вне grace-окна) — момент, когда
  // сессия кончилась, а вкладка осталась: всё, что ей принадлежало, гасим (см.
  // dropSessionScopedState).
  onForcedLogout(dropSessionScopedState);
}
