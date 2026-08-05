import { registerHandler, type AsyncValidator, type SchemaHandler } from '@core/schema';
import { i18next } from '@core/i18n';
import { onForcedLogout } from '@core/auth';
import { useOperationStore } from '@core/operation';
import { signin, signup } from './api/authApi';
import { checkEmailAvailability } from './lib/emailAvailability';
import { saveConfirmReturn } from './lib/confirmReturn';
import { clearSecurityFlow } from './lib/securityFlow';
import { clearRecoveryCodes } from './lib/recoveryCodes';

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

  // Принудительный разлогин (протухший refresh, reuse токена вне grace-окна) не перезагружает
  // вкладку, поэтому незавершённая операция пережила бы смену пользователя: следующий гость
  // попал бы на /confirm с чужим подтверждением, а оборванная посреди 2FA операция — со своим
  // securityFlow. Туда же и показанные аварийные коды — они принадлежат ушедшей сессии. Из core
  // этого не сделать: всё перечисленное живёт в модуле, а импорт core → modules закрыт границами
  // слоёв.
  onForcedLogout(() => {
    useOperationStore.getState().reset();
    clearSecurityFlow();
    clearRecoveryCodes();
  });
}
