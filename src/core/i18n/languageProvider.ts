import { DEFAULT_LANGUAGE, findLanguage } from './languages';

/**
 * Источник текущего языка ОТОБРАЖЕНИЯ — для стартовой инициализации i18next и для решения, слать
 * ли `?lang`. Заголовок Accept-Language отсюда НЕ формируется: его ставит браузер, и он несёт
 * окружение, а не наш выбор (см. commonHeaders). Приоритет: явный выбор юзера (persist
 * в localStorage) → язык браузера → язык по умолчанию. Смену языка в UI делает LanguageButton
 * (setLanguage + i18next.changeLanguage); здесь — хранилище выбора, i18next не импортируем
 * (нет цикла).
 *
 * Рядом со значением хранится ИСТОЧНИК выбора — от него зависит, кто кого перебивает:
 *  - `auto`    — пользователь не выбирал ничего: язык берётся из браузера;
 *  - `local`   — выбрал переключателем в шелле: это устройство-локальный выбор, он побеждает
 *                и держится, пока пользователь сам его не сменит (сохранение настроек его не трогает);
 *  - `profile` — подтянут из GET /v1/user.
 * Регуляторов два и они независимы: переключатель правит ЯЗЫК ОТОБРАЖЕНИЯ, форма настроек —
 * ЯЗЫК ПРОФИЛЯ (язык писем и серверных текстов).
 */

const STORAGE_KEY = 'ui.lang';
const SOURCE_KEY = 'ui.lang.source';

export type LanguageSource = 'auto' | 'local' | 'profile';

let explicitLang: string | null = null;
let source: LanguageSource | null = null;

/** Поддерживаемый ли язык (точное совпадение с кодом из справочника). */
function isSupported(lang: string): boolean {
  return findLanguage(lang)?.code === lang;
}

function write(lang: string, next: Exclude<LanguageSource, 'auto'>): void {
  explicitLang = lang;
  source = next;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
    localStorage.setItem(SOURCE_KEY, next);
  } catch {
    // приватный режим / недоступный storage — выбор останется в памяти на текущую сессию.
  }
}

/** Выбор пользователя в шелле: перебивает язык профиля и держится до следующего клика. */
export function setLanguage(lang: string): void {
  write(lang, 'local');
}

/**
 * Язык, подтянутый из профиля. Отдельная функция, а не флаг у setLanguage: у вызова из навигации
 * источник всегда `local`, развилки там быть не должно. Единственный потребитель —
 * adoptProfileLanguage (languageSync).
 */
export function setProfileLanguage(lang: string): void {
  write(lang, 'profile');
}

/**
 * Забыть язык, подтянутый из профиля, — на выходе из аккаунта. Без этого он переживает выход,
 * и гостевые запросы СЛЕДУЮЩЕГО пользователя уходят с `?lang` предыдущего: письмо с кодом придёт
 * на чужом языке. Локальный выбор (`local`) не трогаем — это выбор устройства, он переживает
 * смену пользователя намеренно.
 *
 * Язык интерфейса на текущей странице не переключаем: сам по себе выход не повод менять то,
 * что человек видит прямо сейчас. Забываем только хранилище — дальше язык берётся из браузера
 * (или из профиля того, кто войдёт следующим).
 */
export function clearProfileLanguage(): void {
  if (getLanguageSource() !== 'profile') return;
  explicitLang = null;
  source = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(SOURCE_KEY);
  } catch {
    // недоступный storage — в памяти уже сброшено, а писать было некуда и раньше.
  }
}

export function getLanguage(): string {
  if (explicitLang) return explicitLang;
  try {
    // Битый/чужой ui.lang (не из справочника) игнорируем — иначе он уедет в `?lang`
    // и в i18next.init({lng}). Падаем на язык браузера.
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && isSupported(stored)) {
      explicitLang = stored;
      source = localStorage.getItem(SOURCE_KEY) === 'profile' ? 'profile' : 'local';
      return stored;
    }
  } catch {
    // недоступный storage — падаем на язык браузера.
  }
  return navigator.language ?? DEFAULT_LANGUAGE.code;
}

/** Откуда взялся текущий язык отображения. Значение без источника не читаем — только через getLanguage. */
export function getLanguageSource(): LanguageSource {
  if (source) return source;
  getLanguage();
  return source ?? 'auto';
}
