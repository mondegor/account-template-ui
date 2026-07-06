import { registerHandler, type AsyncValidator, type SchemaHandler } from '@core/schema';
import { ApiFieldError } from '@core/api';
import { checkLogin, signin, signup } from './api/authApi';

/**
 * Обработчики схем auth (связь «схема → логика») — императивная часть модуля, вызывается из
 * onInit его ModuleDefinition (module.tsx). realm обработчики берут внутри authApi (из
 * realmProvider), в форме его нет. Декларативные поля (схемы/переводы/типы узлов) — в module.tsx.
 */

const signupHandler: SchemaHandler = async (values, ctx) => {
  const op = await signup(String(values.user_email ?? '').trim());
  ctx.dispatchOperation({ type: 'START', parts: op, now: Date.now() });
  ctx.navigate('/confirm');
};

const signinHandler: SchemaHandler = async (values, ctx) => {
  const op = await signin(String(values.user_login ?? '').trim());
  ctx.dispatchOperation({ type: 'START', parts: op, now: Date.now() });
  ctx.navigate('/confirm');
};

/**
 * Асинк-проверка доступности email на регистрации (на submit). Занят (400) → текст ошибки под поле.
 * 5xx/сеть — остаёмся нейтральны: не подтверждаем доступность, но и не блокируем ввод (реальный
 * гейт — сам signup), поэтому под полем ничего не показываем.
 */
const emailAvailable: AsyncValidator = async (value) => {
  const email = String(value ?? '').trim();
  try {
    await checkLogin(email);
    return null;
  } catch (e) {
    if (e instanceof ApiFieldError) return e.fields[0]?.detail ?? null;
    return null;
  }
};

let registered = false;

/** Регистрирует обработчики схем auth (идемпотентно). Вызывается из authModule.onInit. */
export function registerAuthHandlers(): void {
  if (registered) return;
  registered = true;
  registerHandler('auth.signup', {
    handler: signupHandler,
    asyncValidators: { user_email: emailAvailable },
  });
  registerHandler('auth.signin', { handler: signinHandler });
}
