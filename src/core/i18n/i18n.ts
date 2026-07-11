import i18next, { type i18n as I18nInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getLanguage } from './languageProvider';

/**
 * Единый инстанс i18next (+ react-i18next). Язык берём из languageProvider (браузер → явный
 * выбор юзера позже). Инвариант безопасности (plan.txt): interpolation.escapeValue: true —
 * значения экранируются на уровне i18next (React экранирует повторно, это defence-in-depth).
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
    fallbackLng: 'ru',
    supportedLngs: ['ru', 'en'],
    load: 'languageOnly',
    nonExplicitSupportedLngs: true,
    returnNull: false,
    resources: {
      ru: { translation: { common: commonRu } },
      en: { translation: { common: commonEn } },
    },
    interpolation: { escapeValue: true },
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
