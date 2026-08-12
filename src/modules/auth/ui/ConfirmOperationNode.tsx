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

  // Аварийный код вместо второго фактора спека разрешает только обычному входу: в цепочке
  // резервного он идёт отдельным звеном, и заменять им пароль значило бы потратить за один вход два
  // кода. Отличить потоки можно только по тому, откуда человек сюда пришёл: в снимке операции
  // признака нет — звенья цепочки приходят по одному. Нет записи — нет и повода звать аварийный
  // код: подсказка про него там, где его не примут, стоит одной попытки из трёх.
  const hintPrefix = loadConfirmReturn() === '/signin' ? 'auth.signin.confirmHint' : undefined;

  return <OperationConfirm flow={flow} hintPrefix={hintPrefix} />;
}
