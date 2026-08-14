import { useNavigate } from 'react-router';
import type { NodeComponentProps } from '@core/schema';
import { useConfirmFlow } from '../hooks/useConfirmFlow';
import { openSession } from '../api/authApi';
import { clearConfirmReturn, loadConfirmReturn } from '../lib/confirmReturn';
import { OperationConfirm } from './OperationConfirm';

/**
 * Узел схемы `confirmOperation` (регистрируется модулем auth) — auth-специфика вокруг общего
 * экрана подтверждения: терминальное действие (открытие сессии) и навигация. Сам экран рисует
 * OperationConfirm, он же обслуживает security-потоки.
 */

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function ConfirmOperationNode(_props: NodeComponentProps) {
  const navigate = useNavigate();
  // Экран /confirm общий для signup/signin — «Отменить» возвращает на исходный экран, запомненный
  // обработчиком потока в sessionStorage (переживает reload; дефолт — вход). НЕ чистим здесь до
  // навигации: revoke() сначала делает reset() снапшота, из-за чего ConfirmPage (подписан на
  // снапшот) успевает сам редиректнуть по loadConfirmReturn() — оба выхода должны вести в одно место.
  const flow = useConfirmFlow({
    // 200 в ответ на открытие сессии — ещё одно звено цепочки: по спеке так бывает, когда secret
    // передали прямо в открытие, минуя confirm. Наш путь входа сюда не заходит, но ветка есть.
    terminal: async (token) => {
      const result = await openSession({ token });
      return result.kind === 'access' ? undefined : result.operation;
    },
    onDone: () => {
      clearConfirmReturn();
      navigate('/profile', { replace: true });
    },
    onRevoked: () => navigate(loadConfirmReturn() ?? '/signin', { replace: true }),
  });

  // Из потоков этого узла подмена положена только обычному входу: в цепочке резервного аварийный
  // код идёт отдельным звеном, и заменять им пароль значило бы потратить за один вход два кода, а
  // регистрации второго фактора не бывает вовсе. Отличить потоки можно только по тому, откуда
  // человек сюда пришёл: в снимке операции признака нет — звенья цепочки приходят по одному.
  // Нет записи — нет и переключателя: звать в формат, который на этом звене не примут, стоит одной
  // попытки из трёх.
  const allowRecoverySwap = loadConfirmReturn() === '/signin';

  return <OperationConfirm flow={flow} allowRecoverySwap={allowRecoverySwap} />;
}
