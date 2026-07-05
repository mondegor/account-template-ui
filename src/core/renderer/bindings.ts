import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { realmProvider } from '@core/auth';
import { useOperationStore } from '@core/operation';
import type { HandlerContext } from '@core/schema';

/**
 * Собирает HandlerContext для обработчиков схем: навигация (react-router), realm (из realmProvider,
 * в UI не вводится) и диспатч в generic-движок операций. Обработчик не импортирует их сам —
 * получает через ctx (тестируемо, единая точка).
 */
export function useHandlerContext(): HandlerContext {
  const navigate = useNavigate();
  const dispatchOperation = useOperationStore((s) => s.dispatch);
  return useMemo<HandlerContext>(
    () => ({ navigate, realm: realmProvider.getRealm(), dispatchOperation }),
    [navigate, dispatchOperation],
  );
}
