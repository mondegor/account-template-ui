/**
 * Источник ролей пользователя для RoleGuard и фильтрации роутов/nav в реестре модулей.
 *
 * TBD: в текущем `UserInfo` (openapi) явных ролей нет — вернуть их из нового поля/маппинга
 * (`status` / `realms[].user_kind`), когда бэкенд его добавит. Пока — пусто: механизм ролей
 * включён (RoleGuard, requiredRoles), но фактически ничего не отсекает.
 */
export function getUserRoles(): string[] {
  return [];
}
