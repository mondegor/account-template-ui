import { ApiFieldError, parseErrorCode } from '@core/api';
import { checkLogin } from '../api/authApi';

/**
 * Единая проверка доступности email через check-login — общий кусок для живого UX-чека
 * (EmailFieldNode) и async-валидатора на submit (register.ts), чтобы классификация ответа не
 * разъезжалась. Занят → 400 ApiFieldError (текст поля в `message`); 5xx/сеть → 'unknown'
 * (нейтрально: не подтверждаем и не блокируем — реальный гейт сам signup).
 *
 * «Занят» — это РОВНО `EmailAlreadyExists`, а не любой 400: `ValidateError/...` значит, что запрос
 * забракован по значению (в т.ч. по realm'у, к емаилу отношения не имеющему), и выдавать это за
 * занятость нельзя — тем более что исход оседает в кэше на всю сессию. Разбираем поэтому префикс
 * кода; суффикс, наоборот, не смотрим: check-login ругается на своё поле (`user_login`), а форма
 * регистрации зовёт поле `user_email` — под него текст кладёт явный асинк-валидатор.
 *
 * Детерминированные исходы (free/taken) кэшируются на сессию по нормализованному email: живой чек
 * поля уже сходил в сеть, поэтому async-валидатор на сабмите берёт готовый результат и НЕ дёргает
 * ручку повторно. Транзиентные ('unknown') не кэшируем — их перепроверят и сервер на сабмите.
 */
export type EmailAvailability =
  { state: 'free' } | { state: 'taken'; message: string | null } | { state: 'unknown' };

/** Осевший (детерминированный) исход — то, что кладём в кэш и отдаём для мгновенного восстановления. */
export type SettledAvailability = Extract<EmailAvailability, { state: 'free' | 'taken' }>;

const cache = new Map<string, SettledAvailability>();

/** Синхронно вернуть ранее вычисленный исход для значения (или undefined) — для мгновенного UX. */
export function getCachedEmailAvailability(email: string): SettledAvailability | undefined {
  return cache.get(email.trim());
}

export async function checkEmailAvailability(email: string): Promise<EmailAvailability> {
  const key = email.trim();
  const cached = cache.get(key);
  if (cached) return cached;
  try {
    await checkLogin(key);
    const result: SettledAvailability = { state: 'free' };
    cache.set(key, result);
    return result;
  } catch (e) {
    // `errors` — список, и занятость в нём не обязана быть первой: ищем по всему.
    const attr =
      e instanceof ApiFieldError
        ? e.fields.find((f) => parseErrorCode(f.code).reason === 'EmailAlreadyExists')
        : undefined;
    if (attr) {
      const result: SettledAvailability = { state: 'taken', message: attr.detail || null };
      cache.set(key, result);
      return result;
    }
    return { state: 'unknown' };
  }
}

/** Только для тестов: очистить кэш исходов. */
export function resetEmailAvailabilityCache(): void {
  cache.clear();
}
