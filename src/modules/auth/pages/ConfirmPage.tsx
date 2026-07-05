import { Navigate } from 'react-router-dom';
import { useOperationStore } from '@core/operation';
import { loadSchema } from '@core/schema';
import { SchemaRenderer } from '@core/renderer';
import { AuthCard } from '../ui/AuthCard';

/**
 * Подтверждение кода — тонкая обёртка: рендерит схему auth.confirm (узел confirmOperation).
 * Прямой заход без активной операции → на вход.
 */
export function ConfirmPage() {
  const snapshot = useOperationStore((s) => s.snapshot);
  if (!snapshot) return <Navigate to="/signin" replace />;
  return (
    <AuthCard>
      <SchemaRenderer schema={loadSchema('auth.confirm')} />
    </AuthCard>
  );
}
