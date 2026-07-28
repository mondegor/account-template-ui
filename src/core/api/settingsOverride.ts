/**
 * Применённые язык и пояс на время окна рассинхрона.
 *
 * Сохранённые настройки попадают в access-токен только на ближайшем продлении сессии, а до тех пор
 * сервер отвечает по старым: тексты на прежнем языке, даты внутри этих текстов — в прежнем поясе.
 * Спека разрешает применить новые значения к конкретному ответу query-параметрами `lang`/`tz` —
 * их и шлём, пока окно открыто. Форсить продление ради этого не будем: оно ротирует общую для всех
 * вкладок куку RTID и может выкинуть пользователя из сессии.
 *
 * Память модульная, а не React: читает интерсептор axios. Не персистится: окно живёт до продления,
 * а reload сам делает продление уже с новым токеном.
 *
 * Язык и пояс здесь равноправны — механизм у них общий. То, что `?tz` сегодня уходит только этим
 * окном, а `?lang` ещё и по выбору в навигации, — временное: переключателя пояса в навигации пока
 * просто нет.
 */

export interface SettingsOverride {
  lang: string | null;
  tz: string | null;
}

const EMPTY: SettingsOverride = { lang: null, tz: null };

let override: SettingsOverride = EMPTY;

/** Значения из ответа POST /v1/user/settings — именно применённые, а не запрошенные. */
export function setSettingsOverride(next: SettingsOverride): void {
  override = next;
}

export function getSettingsOverride(): SettingsOverride {
  return override;
}

/** Зовётся на любом новом access (applyAccess): токен теперь несёт новые значения сам. */
export function clearSettingsOverride(): void {
  override = EMPTY;
}
