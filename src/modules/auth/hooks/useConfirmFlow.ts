import { useCallback, useEffect, useState } from 'react';
import {
  useOperationStore,
  canResendNow,
  expiresSecondsLeft,
  isResendApplicable,
  resendSecondsLeft,
} from '@core/operation';
import { useTranslation } from 'react-i18next';
import {
  ApiFieldError,
  ApiProblemError,
  ApiRateLimitError,
  apiErrorText,
  parseErrorCode,
} from '@core/api';
import { confirmOperation, resendOperation, revokeOperation } from '../api/authApi';
import type { WaitingConfirmOperation } from '../api/types';

interface UseConfirmFlowArgs {
  /**
   * Терминальное действие подтверждённой операции — параметр, потому что у каждого потока оно
   * своё: вход открывает сессию, security-потоки зовут свой `apply-*`. Секрета не принимает: по
   * полностью подтверждённой операции спека его не ждёт. Вернуло звено — цепочка продолжается,
   * вернуло `void` — операция закрыта.
   */
  terminal: (token: string) => Promise<WaitingConfirmOperation | void>;
  /** Операция закрыта: снимок уже сброшен, дальше навигация — забота вызывающего. */
  onDone: () => void;
  onRevoked: () => void;
  /**
   * Запасной текст на случай, когда сорвался сам терминал, а сервер деталь не прислал. Он называет
   * ШАГ, на котором сорвалось, а шаг у каждого потока свой: «не удалось завершить вход» на
   * установке пароля отправило бы искать проблему совсем не там.
   */
  finishErrorKey?: string;
}

/**
 * Причины отказа 400, после которых операции больше нет: токен неизвестен, истёк или уже
 * использован (`OperationInvalid`), вышел её срок жизни (`OperationAlreadyExpired`) либо она не
 * подтверждена, а терминальный метод уже позвали (`OperationIsNotConfirmed` — спека называет его
 * только у `POST /v1/security/apply-*`). Остальные спека называет и у подтверждения кода, и у
 * открытия сессии, и у повторной отправки. Завершить такую операцию нельзя ничем, поэтому исход
 * тот же, что у 409/403, — тупик и новая операция.
 *
 * `ConfirmCodeIsRequired/secret` (открытие сессии по не до конца подтверждённой операции) сюда
 * намеренно НЕ входит: операция цела, попытка по спеке не расходуется, а тело несёт
 * `operation_state` — снимок возвращается из `confirmed` в `active`, то есть к вводу секрета
 * текущего звена. То же и с `ResendCodeIsNotSupported/token`: по звену, которое подтверждается
 * доказательством без сообщения (второй фактор либо аварийный код), отправлять нечего — у цепочек
 * резервных методов это верно с самого первого звена, — но сама операция жива.
 */
const TERMINAL_OPERATION_REASONS: ReadonlySet<string> = new Set([
  'OperationInvalid',
  'OperationAlreadyExpired',
  'OperationIsNotConfirmed',
]);

function isOperationGone(e: ApiFieldError): boolean {
  return e.fields.some((f) => TERMINAL_OPERATION_REASONS.has(parseErrorCode(f.code).reason));
}

/**
 * Флоу подтверждения (auth-обвязка над generic-движком). После 204 выполняет терминальное
 * действие, которое передал вызывающий; 200 из confirm = следующее звено цепочки (второй фактор):
 * у следующего звена свой токен, предыдущий сразу перестаёт действовать — поэтому все вызовы
 * идут с токеном из снимка, а он перезаписывается каждым ответом.
 * Счётчики/таймеры обновляются из ответов; неверный код читает operation_state из тела 400.
 *
 * 204 переводит снимок в фазу `confirmed` ДО терминального действия. Если оно откажет по причине,
 * которая операцию не расходует (429 — лимит одновременных сессий), пользователь остаётся с
 * подтверждённой операцией: повторять надо ровно терминал. Подтверждение переигрывать не нужно и
 * незачем — звено уже пройдено, и повторный confirm по спеке идемпотентен: он вернул бы тот же 204,
 * не сдвинув операцию ни на шаг. Поэтому вход один — confirm(secret), — но при `confirmed` он идёт
 * сразу в терминал, а secret не спрашиваем (вводить уже нечего).
 *
 * Отсюда же главное различие в разборе отказа: 429 повторяем (снимок цел), а 409, 403 и
 * TERMINAL_OPERATION_REASONS в теле 400 неисправимы — операция помечается мёртвой, и экран уводит
 * на новую операцию. Ветка 409/403 обслуживает только терминалы: 409 отдают завершающие методы
 * второго фактора — `apply-password`, `apply-totp` и `apply-recovery-codes` (состояние 2FA
 * изменилось уже после создания операции), 403 — чужая операция или операция не того типа.
 * У открытия сессии и у `apply-operation` 409 по спеке нет вовсе.
 */
export function useConfirmFlow({
  terminal,
  onDone,
  onRevoked,
  finishErrorKey = 'auth.errors.finish',
}: UseConfirmFlowArgs) {
  const { t } = useTranslation();
  const snapshot = useOperationStore((s) => s.snapshot);
  const dispatch = useOperationStore((s) => s.dispatch);
  const reset = useOperationStore((s) => s.reset);

  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);

  // Локальный тик раз в секунду: пересчёт таймеров + перевод в expired.
  useEffect(() => {
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      const before = useOperationStore.getState().snapshot?.phase;
      dispatch({ type: 'TICK', now: t });
      // Тупик по истечению — не отказ сервера, и прошлый отказ его не объясняет: после 429 на
      // открытии сессии в `error` лежит «повторить можно через N секунд», а повторять уже нечего
      // и негде — кнопка исчезает вместе с фазой `confirmed`. Гасим текст, чтобы экран сказал про
      // саму операцию (auth.confirm.invalidated). Причины от сервера приходят своим путём — там
      // фаза меняется в обработке ответа, а не здесь.
      if (before !== 'dead' && useOperationStore.getState().snapshot?.phase === 'dead') {
        setError(null);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [dispatch]);

  const startNextLink = useCallback(
    (op: WaitingConfirmOperation) => dispatch({ type: 'START', parts: op, now: Date.now() }),
    [dispatch],
  );

  /**
   * Запуск терминального действия. Оно может вернуть ещё одно звено — так открытие сессии по
   * спеке отвечает 200, когда secret передали прямо в него и цепочка ещё не кончилась. Иначе
   * операция закрыта: гасим снимок и отдаём управление вызывающему.
   */
  const runTerminal = useCallback(
    async (token: string) => {
      const next = await terminal(token);
      if (next) {
        startNextLink(next);
        return;
      }
      dispatch({ type: 'DONE' });
      reset();
      onDone();
    },
    [terminal, dispatch, reset, onDone, startNextLink],
  );

  const confirm = useCallback(
    async (secret: string) => {
      if (!snapshot) return;
      setSubmitting(true);
      setError(null);
      // На каком шаге сорвалось. У подтверждённой операции кода не вводили вовсе, поэтому запасные
      // тексты про код там не годятся: они назвали бы неверным то, чего не было. Флаг локальный,
      // а не по фазе снимка: 204 двигает её через store, а `snapshot` в этом вызове тот же самый.
      let finishing = snapshot.phase === 'confirmed';
      try {
        // Повтор после отказа терминального действия: подтверждать нечего, операция цела.
        if (finishing) {
          await runTerminal(snapshot.token);
          return;
        }
        const next = await confirmOperation({ token: snapshot.token, secret });
        if (next) {
          // 200 — ещё одно подтверждение (цепочка), напр. 2FA-шаг.
          startNextLink(next);
          return;
        }
        // 204 — операция подтверждена ПОЛНОСТЬЮ, дальше идёт терминальное действие.
        // Фазу двигаем ДО вызова: откажи он — повторять надо будет уже только его.
        dispatch({ type: 'CONFIRMED' });
        finishing = true;
        await runTerminal(snapshot.token);
      } catch (e) {
        if (e instanceof ApiFieldError && isOperationGone(e)) {
          // Операции больше нет: её израсходовала соседняя вкладка либо вышел срок. Просить код
          // заново (или предлагать «Повторить») незачем — этот токен сервер уже не примет.
          dispatch({ type: 'INVALIDATED' });
          setError(apiErrorText(e, t));
        } else if (e instanceof ApiFieldError) {
          if (e.operationState) {
            dispatch({ type: 'CONFIRM_FAILED', state: e.operationState, now: Date.now() });
          }
          setError(e.fields[0]?.detail || t(finishing ? finishErrorKey : 'auth.errors.wrongCode'));
        } else if (e instanceof ApiProblemError && (e.status === 409 || e.status === 403)) {
          // Операцию больше нельзя завершить ничем. 409 — отпало условие, при котором она
          // создавалась (второй фактор включили или отключили уже после). 403 — завершить её
          // нельзя в принципе: токен не от того потока, привязка к realm'у снята, вкладка уже
          // авторизована либо операция чужая. Повтор не лечит ни то, ни другое, поэтому помечаем
          // снимок мёртвым — экран уведёт на новую операцию, а не будет просить код заново.
          // Источник тут только терминал, и 409 объявлен не у каждого: его отдают завершающие
          // методы второго фактора, но не открытие сессии и не применение операции. У подтверждения
          // кода по спеке нет ни 403, ни 409 — отключённая после создания операции 2FA приходит туда
          // обычным ConfirmCodeIsIncorrect, иначе по ответу гостевого метода читалось бы состояние
          // 2FA аккаунта.
          dispatch({ type: 'INVALIDATED' });
          setError(apiErrorText(e, t));
        } else if (e instanceof ApiRateLimitError || e instanceof ApiProblemError) {
          // 429 на терминале — например, лимит одновременных сессий на открытии. Подтверждённая
          // операция при этом НЕ расходуется, поэтому снимок не сбрасываем: фаза `confirmed` уже
          // выставлена, и повтор пойдёт сразу в терминал, пока не истёк срок жизни операции.
          setError(apiErrorText(e, t));
        } else {
          // Не ответ сервиса (сеть, сбой в самом клиенте) — здесь уместнее сказать про шаг,
          // на котором сорвалось, чем общее «что-то пошло не так» из apiErrorText.
          setError(t(finishing ? finishErrorKey : 'auth.errors.confirm'));
        }
      } finally {
        setSubmitting(false);
      }
    },
    [snapshot, startNextLink, runTerminal, dispatch, finishErrorKey, t],
  );

  const resend = useCallback(async () => {
    if (!snapshot || resending) return; // защита от повторной отправки (двойной клик жжёт лимит)
    setResending(true);
    setError(null);
    try {
      const op = await resendOperation({ token: snapshot.token });
      dispatch({ type: 'RESENT', parts: op, now: Date.now() });
    } catch (e) {
      if (e instanceof ApiFieldError && isOperationGone(e)) {
        // Операции нет — новый код слать некуда, и вводить его тоже некуда: тот же тупик.
        dispatch({ type: 'INVALIDATED' });
        setError(apiErrorText(e, t));
      } else if (e instanceof ApiFieldError) {
        // Счётчики несёт не всякий отказ: у «операция уже подтверждена» их нет — там и обновлять
        // нечего. Поэтому смотрим на само тело, а не на код: пришёл operation_state — применяем.
        // Деталь сервера в любом случае объясняет отказ точнее нашего запасного текста.
        if (e.operationState) {
          dispatch({ type: 'CONFIRM_FAILED', state: e.operationState, now: Date.now() });
        }
        setError(e.fields[0]?.detail || t('auth.errors.resendUnavailable'));
      } else if (e instanceof ApiProblemError) {
        // Троттл повторной отправки приходит сюда не 429-м, а 400-м выше: срок повтора клиент
        // берёт из operation_state.resends_in, которого тело problem+json не вмещает. Здесь
        // остаётся то, что про саму операцию не говорит ничего.
        setError(apiErrorText(e, t));
      } else {
        // Не ответ сервиса (сеть, сбой в самом клиенте) — говорим про шаг, на котором сорвалось.
        setError(t('auth.errors.resend'));
      }
    } finally {
      setResending(false);
    }
  }, [snapshot, dispatch, resending, t]);

  const revoke = useCallback(async () => {
    if (snapshot) {
      try {
        await revokeOperation({ token: snapshot.token });
      } catch {
        /* отмена лучшего усилия */
      }
    }
    reset();
    onRevoked();
  }, [snapshot, reset, onRevoked]);

  return {
    snapshot,
    error,
    submitting,
    resending,
    /** Код принят, сорвался только терминал: экрану нужен «Повторить», а не поле ввода. */
    awaitingFinish: snapshot?.phase === 'confirmed',
    expiresLeft: snapshot ? expiresSecondsLeft(snapshot, now) : 0,
    resendLeft: snapshot ? resendSecondsLeft(snapshot, now) : 0,
    canResend: snapshot ? canResendNow(snapshot, now) : false,
    isResendApplicable: snapshot ? isResendApplicable(snapshot) : false,
    confirm,
    resend,
    revoke,
  };
}

/** Состояние и действия подтверждения — то, чем питается презентационный OperationConfirm. */
export type ConfirmFlow = ReturnType<typeof useConfirmFlow>;
