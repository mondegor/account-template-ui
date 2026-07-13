import type { TFunction } from 'i18next';

/**
 * Человекочитаемые названия вместо технических строк бэка. Таблица подписей — в ветке `deploy.*`
 * (src/app/i18n/deploy.ts): конкретные имена реалмов принадлежат деплою, а не переиспользуемому
 * модулю. Фолбэк — само значение: realm или user_kind, которых нет в переводах, покажутся как
 * есть, а не пустотой и не ключом.
 */

/** Имя кабинета: print-shop/admin → «Служебный». */
export function realmLabel(t: TFunction, realm: string): string {
  return t(`deploy.realmLabel.${realm}`, { defaultValue: realm });
}

/** Тип аккаунта: staff → «Сотрудник». */
export function userKindLabel(t: TFunction, kind: string): string {
  return t(`deploy.userKind.${kind}`, { defaultValue: kind });
}
