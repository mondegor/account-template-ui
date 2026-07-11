/**
 * Источник ролей пользователя для RoleGuard и фильтрации роутов/nav в реестре модулей.
 *
 * TBD: в текущем `UserInfo` (openapi) явных ролей нет — вернуть их из нового поля/маппинга
 * (`status` / `realms[].user_kind`), когда бэкенд его добавит. Пока — пусто.
 */
export function getUserRoles(): string[] {
  return [];
}

/**
 * Применяются ли роли уже сейчас. Пока источника ролей нет (`getUserRoles` → []), возвращаем false:
 * `requiredRoles`/RoleGuard/фильтр nav НИКОГО не отсекают (иначе модуль с requiredRoles стал бы
 * недоступен всем). Когда бэкенд начнёт отдавать роли — переключить на true вместе с getUserRoles.
 */
export function rolesEnforced(): boolean {
  return false;
}
