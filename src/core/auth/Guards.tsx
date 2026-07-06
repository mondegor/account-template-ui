import { useEffect, type ReactNode } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuthStore } from './authStore';
import { onForcedLogout } from './refresh';
import { getUserRoles } from './roles';

/** Пока идёт стартовый silent-refresh (status='unknown') — ничего не решаем. */
function Splash() {
  return null;
}

/** Доступ только аутентифицированным. Реагирует на принудительный разлогин (reuse вне grace-окна). */
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const status = useAuthStore((s) => s.status);
  const navigate = useNavigate();

  useEffect(() => onForcedLogout(() => navigate('/signin', { replace: true })), [navigate]);

  if (status === 'unknown') return <Splash />;
  if (status !== 'authenticated') return <Navigate to="/signin" replace />;
  return <>{children}</>;
}

/** guests-only: аутентифицированного уводим в кабинет. */
export function GuestOnly({ children }: { children: ReactNode }) {
  const status = useAuthStore((s) => s.status);
  if (status === 'unknown') return <Splash />;
  if (status === 'authenticated') return <Navigate to="/profile" replace />;
  return <>{children}</>;
}

/**
 * Второй рубеж по ролям (поверх ProtectedRoute). Пропускает, если requiredRoles пуст ИЛИ есть
 * пересечение с ролями пользователя; иначе — в кабинет. Источник ролей — getUserRoles (пока []).
 */
export function RoleGuard({
  requiredRoles,
  children,
}: {
  requiredRoles?: string[];
  children: ReactNode;
}) {
  if (requiredRoles && requiredRoles.length > 0) {
    const roles = getUserRoles();
    if (!requiredRoles.some((r) => roles.includes(r))) return <Navigate to="/profile" replace />;
  }
  return <>{children}</>;
}
