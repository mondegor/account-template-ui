/**
 * Итог смены емаила или телефона, который экран подтверждения передаёт настройкам вместе с
 * переходом. Состояние навигации, а не запись в хранилище: итог показывается один раз — в момент
 * возврата, и следующий заход на страницу о нём уже не рассказывает.
 */
export type ContactDone = 'email' | 'phone';

export interface SettingsLocationState {
  contactDone?: ContactDone;
}

/** Состояние навигации приходит нетипизированным: берём итог, только если он наш. */
export function readContactDone(state: unknown): ContactDone | undefined {
  const done = (state as SettingsLocationState | null)?.contactDone;
  return done === 'email' || done === 'phone' ? done : undefined;
}
