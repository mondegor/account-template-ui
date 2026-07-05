import {
  registerComponent,
  registerHandler,
  registerSchema,
  type AsyncValidator,
  type SchemaHandler,
} from '@core/schema';
import { addTranslations } from '@core/i18n';
import { ApiFieldError } from '@core/api';
import { authTranslations } from './i18n';
import { ConfirmOperationNode } from './ui/ConfirmOperationNode';
import { checkLogin, signin, signup } from './api/authApi';
import signupSchema from './schemas/signup.json';
import signinSchema from './schemas/signin.json';
import confirmSchema from './schemas/confirm.json';

/**
 * Регистрация модуля auth в ядре: переводы, тип узла confirmOperation, локальные схемы и обработчики
 * (связь «схема → логика»). realm обработчики берут внутри authApi (из realmProvider), в форме его нет.
 * Позже это переедет в ModuleDefinition реестра модулей (шаг 7) — интерфейс регистрации не меняется.
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

export function registerAuthModule(): void {
  if (registered) return;
  registered = true;
  addTranslations(authTranslations);
  registerComponent('confirmOperation', ConfirmOperationNode);
  registerSchema('auth.signup', signupSchema);
  registerSchema('auth.signin', signinSchema);
  registerSchema('auth.confirm', confirmSchema);
  registerHandler('auth.signup', {
    handler: signupHandler,
    asyncValidators: { user_email: emailAvailable },
  });
  registerHandler('auth.signin', { handler: signinHandler });
}
