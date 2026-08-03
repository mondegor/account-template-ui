export {
  getLanguage,
  setLanguage,
  setProfileLanguage,
  clearProfileLanguage,
  getLanguageSource,
} from './languageProvider';
export type { LanguageSource } from './languageProvider';
export { adoptProfileLanguage } from './languageSync';
export { LANGUAGES, DEFAULT_LANGUAGE, findLanguage, toLocale, fromApiLocale } from './languages';
export type { Language } from './languages';
// Наружу — только прикладное. Арифметика смещений (parseGmtOffset, getTimeZoneOffset,
// formatOffset, isDstActive) остаётся внутренней: снаружи она никому не нужна — у мока своя
// (src/mocks/serverTime.ts).
export {
  TIME_ZONES,
  findTimeZone,
  timeZoneLabel,
  resolveTimeZone,
  getOsTimeZone,
  sameZoneBehaviour,
  buildTimeZoneHeader,
} from './timeZones';
export type { TimeZone } from './timeZones';
export { initI18n, addTranslations, i18next } from './i18n';
export { formatDate, formatDateTimeLong } from './dateTime';
export { formatRelativeTime } from './relativeTime';
export type { RelativeTimeResult, RelativeTimeOptions } from './relativeTime';
