import { Navigate } from 'react-router';
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
 *    signup/signin; записи нет — на вход, тем же дефолтом, что и onRevoked узла).
 */
export function ConfirmPage() {
  const snapshot = useOperationStore((s) => s.snapshot);
  const status = useAuthStore((s) => s.status);
  if (!snapshot) {
    return (
      <Navigate
        to={status === 'authenticated' ? '/profile' : (loadConfirmReturn() ?? '/signin')}
        replace
      />
    );
  }
  return (
    <AuthCard>
      <SchemaRenderer schema={loadSchema('auth.confirm')} />
    </AuthCard>
  );
}
