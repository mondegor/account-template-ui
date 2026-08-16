import { useEffect } from 'react';
import { Navigate } from 'react-router';
import { useAuthStore } from '@core/auth';
import { useOperationStore } from '@core/operation';
import { loadSchema } from '@core/schema';
import { SchemaRenderer } from '@core/renderer';
import { AuthCard } from '../ui/AuthCard';
import { loadConfirmReturn } from '../lib/confirmReturn';
import { loadSecurityFlow } from '../lib/securityFlow';
import { dropSessionScopedState } from '../lib/sessionScopedState';

/**
 * Подтверждение кода — тонкая обёртка: рендерит схему auth.confirm (узел confirmOperation).
 *
 * Нет активной операции — два исхода, и оба обязаны совпадать с навигацией самого узла (он тоже
 * подписан на снапшот и уводит с экрана), иначе на обнулении снапшота ConfirmPage гонялся бы с ним:
 *  - успешное подтверждение уже открыло сессию (openSession → status='authenticated' ДО reset()) →
 *    в кабинет /profile, как и onAccess узла;
 *  - прямой заход ИЛИ «Отменить»/reset без сессии → на исходный экран (loadConfirmReturn:
 *    signup/signin; записи нет — на вход, тем же дефолтом, что и onRevoked узла).
 *
 * Операция может быть и не своя: запись securityFlow означает, что её ведёт /security/confirm, и
 * закрывать её надо методом потока. Здешний узел закрыл бы её открытием сессии — то есть сжёг бы
 * код и получил отказ по чужому типу операции, — поэтому такую операцию отдаём её экрану. Отдаём
 * только внутри её сессии: /security/confirm стоит за guard'ом, и гость ушёл бы оттуда на вход, а
 * вход привёл бы обратно сюда. Гость с записью потока значит, что сессия кончилась не разлогином
 * (например, стартовый silent-refresh не достучался до сервера) и уборку за ней никто не сделал:
 * продолжать поток нечем, и запись гаснет вместе с остальным, что сессии принадлежало.
 */
export function ConfirmPage() {
  const snapshot = useOperationStore((s) => s.snapshot);
  const status = useAuthStore((s) => s.status);

  // Запись читается на каждом рендере: её гасит эффект ниже, и запомненная копия разошлась бы с
  // тем, что видит остальное приложение.
  const securityFlow = Boolean(loadSecurityFlow());

  // Уборка идёт эффектом, а не в теле рендера: рендер остаётся чистым, а страница после неё уходит
  // веткой без снимка — тем же адресом, что и брошенное подтверждение.
  const orphanedFlow = securityFlow && status === 'anonymous';
  useEffect(() => {
    if (orphanedFlow) dropSessionScopedState();
  }, [orphanedFlow]);

  if (!snapshot) {
    return (
      <Navigate
        to={status === 'authenticated' ? '/profile' : (loadConfirmReturn() ?? '/signin')}
        replace
      />
    );
  }
  if (securityFlow) {
    // Пока идёт стартовый silent-refresh (status='unknown'), чья это операция, ещё не решено —
    // ждём молча, как и guard'ы. Дальше исходов два: своя сессия — отдаём операцию её экрану,
    // сессии нет — эффект уже гасит запись, и следующий рендер уйдёт веткой без снимка.
    if (status === 'authenticated') return <Navigate to="/security/confirm" replace />;
    return null;
  }
  return (
    <AuthCard>
      <SchemaRenderer schema={loadSchema('auth.confirm')} />
    </AuthCard>
  );
}
