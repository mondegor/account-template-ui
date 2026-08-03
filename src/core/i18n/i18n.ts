import i18next, { type i18n as I18nInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getLanguage } from './languageProvider';
import { DEFAULT_LANGUAGE, LANGUAGES } from './languages';

/**
 * Единый инстанс i18next (+ react-i18next). Язык берём из languageProvider (браузер → явный
 * выбор юзера позже).
 *
 * interpolation.escapeValue: false — штатная настройка react-i18next. Экранирует React: результат
 * t() попадает в JSX как текст, а HTML-рендера переводов в проекте нет (<Trans> не используется,
 * dangerouslySetInnerHTML запрещён линтом во всём src и отклоняется validateSchema). Второе
 * экранирование не защищало, а портило данные: любой `/`, `&` или кавычка в значении
 * интерполяции доезжали до экрана сущностями — английская дата `7/15/2026` показывалась как
 * `7&#x2F;15&#x2F;2026` (кейс закреплён в i18n.test.ts). Если появится рендер переводов как
 * HTML — экранировать нужно будет там, а не здесь.
 *
 * Один namespace `translation` с dotted-ключами: ядро несёт `common.*` (сообщения валидации
 * из схем), модули добавляют свою ветку (`auth.*`, ...) через addTranslations() при бутстрапе.
 * Так schema-label вида `auth.field.email` резолвится напрямую через keySeparator '.', а ядро
 * не зависит от modules.
 */

const commonRu = {
  validation: {
    required: 'Обязательное поле',
    email: 'Введите корректный email',
    phone: 'Введите корректный телефон',
    login: 'Введите корректный email или телефон',
    min: 'Минимум {{min}} символов',
    max: 'Не более {{max}} символов',
    pattern: 'Неверный формат',
  },
  error: {
    generic: 'Что-то пошло не так. Попробуйте позже.',
    rateLimited: 'Слишком много попыток. Повторите позже.',
    // Дополнение к rateLimited (или к серверной детали), когда сервер прислал Retry-After.
    // Пауза короче минуты называется секундами — см. apiErrorText (@core/api/errors).
    retryAfterSec_one: 'Повторить можно через {{count}} секунду.',
    retryAfterSec_few: 'Повторить можно через {{count}} секунды.',
    retryAfterSec_many: 'Повторить можно через {{count}} секунд.',
    retryAfter_one: 'Повторить можно через {{count}} минуту.',
    retryAfter_few: 'Повторить можно через {{count}} минуты.',
    retryAfter_many: 'Повторить можно через {{count}} минут.',
    network: 'Нет связи с сервером. Проверьте подключение.',
  },
  shell: {
    menu: 'Меню',
    logout: 'Выйти',
    theme: { system: 'Тема: авто', light: 'Тема: светлая', dark: 'Тема: тёмная' },
  },
};

const commonEn = {
  validation: {
    required: 'This field is required',
    email: 'Enter a valid email',
    phone: 'Enter a valid phone number',
    login: 'Enter a valid email or phone number',
    min: 'At least {{min}} characters',
    max: 'At most {{max}} characters',
    pattern: 'Invalid format',
  },
  error: {
    generic: 'Something went wrong. Please try again later.',
    rateLimited: 'Too many attempts. Please try again later.',
    retryAfterSec_one: 'You can try again in {{count}} second.',
    retryAfterSec_other: 'You can try again in {{count}} seconds.',
    retryAfter_one: 'You can try again in {{count}} minute.',
    retryAfter_other: 'You can try again in {{count}} minutes.',
    network: 'Cannot reach the server. Check your connection.',
  },
  shell: {
    menu: 'Menu',
    logout: 'Log out',
    theme: { system: 'Theme: auto', light: 'Theme: light', dark: 'Theme: dark' },
  },
};

let initialized = false;

/** Инициализация инстанса (идемпотентна). Вызывается один раз при бутстрапе до рендера. */
export function initI18n(): I18nInstance {
  if (initialized) return i18next;
  initialized = true;
  void i18next.use(initReactI18next).init({
    lng: getLanguage(),
    // Языки — из справочника (data/languages.json): один список на i18next, переключатель и селект.
    fallbackLng: DEFAULT_LANGUAGE.code,
    supportedLngs: LANGUAGES.map((l) => l.code),
    load: 'languageOnly',
    nonExplicitSupportedLngs: true,
    returnNull: false,
    resources: {
      ru: { translation: { common: commonRu } },
      en: { translation: { common: commonEn } },
    },
    interpolation: { escapeValue: false },
  });
  return i18next;
}

/**
 * Регистрация переводов модуля: для каждого языка — deep-merge ветки в namespace `translation`.
 * Ветка нормально приходит под ключом id модуля, напр. `{ auth: {...} }`, чтобы не пересекаться.
 */
export function addTranslations(bundles: Record<string, Record<string, unknown>>): void {
  for (const [lng, resources] of Object.entries(bundles)) {
    i18next.addResourceBundle(lng, 'translation', resources, true, true);
  }
}

export { i18next };
