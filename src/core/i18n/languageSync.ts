import { i18next } from './i18n';
import { fromApiLocale } from './languages';
import { getLanguageSource, setProfileLanguage } from './languageProvider';

/**
 * Применение языка ПРОФИЛЯ к отображению. Отдельный файл, потому что languageProvider намеренно
 * не импортирует i18next (цикл) — это зафиксировано в его шапке.
 *
 * Правило одно: язык профиля применяется, только если пользователь не переопределил язык
 * в навигации (источник `local`). Локальный выбор побеждает — и при входе, и при сохранении
 * настроек: на сервере тогда меняется профиль (язык писем), а интерфейс остаётся тем, что выбрали
 * на этом устройстве. Параметра `force` нет: его единственным потребителем был бы путь сохранения,
 * а ему как раз перебивать локальный выбор нельзя.
 */
export function adoptProfileLanguage(locale: string | undefined): void {
  // Приходит СЕРВЕРНАЯ локаль (ru-RU) — её нельзя класть в хранилище и в i18next как есть:
  // getLanguage() отбраковал бы `ru-RU` по справочнику и на следующей загрузке молча свалился бы
  // на язык браузера, а i18next.language стал бы `ru-RU` и разъехался с тем, что уходит в `?lang`.
  const code = fromApiLocale(locale);
  // Язык, которого фронт не знает (бэк завёл новый) — не наше дело: интерфейс не трогаем.
  if (!code) return;
  if (getLanguageSource() === 'local') return;

  setProfileLanguage(code);
  void i18next.changeLanguage(code);
}
