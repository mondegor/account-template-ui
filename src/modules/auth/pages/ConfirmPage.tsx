import { Navigate } from 'react-router-dom';
import { useAuthStore } from '@core/auth';
import { useOperationStore } from '@core/operation';
import { loadSchema } from '@core/schema';
import { SchemaRenderer } from '@core/renderer';
import { AuthCard } from '../ui/AuthCard';
import { loadConfirmReturn } from '../lib/confirmReturn';

/**
 * Подтверждение кода — тонкая обёртка: рендерит схему auth.confirm (узел confirmOperation).
 *
 * Нет активной операции — два исхода, и оба обязаны совпадать с навигацией самого узла (он тоже
 * подписан на снапшот и уводит с экрана), иначе на обнулении снапшота ConfirmPage гонялся бы с ним:
 *  - успешное подтверждение уже открыло сессию (openSession → status='authenticated' ДО reset()) →
 *    в кабинет /profile, как и onAccess узла;
 *  - прямой заход ИЛИ «Отменить»/reset без сессии → на исходный экран (loadConfirmReturn:
 *    signup/signin, дефолт /signin), как и onRevoked узла.
 * Раньше access-переход спасал лишь бонс через GuestOnly (/signin → /profile) — теперь таргет верный
 * сразу.
 */
export function ConfirmPage() {
  const snapshot = useOperationStore((s) => s.snapshot);
  const status = useAuthStore((s) => s.status);
  if (!snapshot) {
    return <Navigate to={status === 'authenticated' ? '/profile' : loadConfirmReturn()} replace />;
  }
  return (
    <AuthCard>
      <SchemaRenderer schema={loadSchema('auth.confirm')} />
    </AuthCard>
  );
}
