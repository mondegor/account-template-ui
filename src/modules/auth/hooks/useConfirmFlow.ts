import { useCallback, useEffect, useState } from 'react';
import {
  useOperationStore,
  canResendNow,
  expiresSecondsLeft,
  isResendApplicable,
  resendSecondsLeft,
} from '@core/operation';
import { useTranslation } from 'react-i18next';
import { ApiFieldError, ApiProblemError, ApiRateLimitError, apiErrorText } from '@core/api';
import { confirmOperation, resendOperation, revokeOperation } from '../api/authApi';
import { isOperationGone } from '../lib/operationGone';
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
   * Экран закрыт, а операция осталась жить на сервере: её отдаёт профиль, и вернуться к ней можно
   * позже. Есть только у потоков, которые уход переживают, — остальным уходить некуда, и снимок
   * такой операции гаснет вместе с экраном насовсем.
   */
  onLeft?: () => void;
  /**
   * Запасной текст на случай, когда сорвался сам терминал, а сервер деталь не прислал. Он называет
   * ШАГ, на котором сорвалось, а шаг у каждого потока свой: «не удалось завершить вход» на
   * установке пароля отправило бы искать проблему совсем не там.
   */
  finishErrorKey?: string;
}

/**
 * Отказ вместе с тем, на чём он случился. Одного текста экрану мало: место строки и пометка поля
 * решаются порознь, и решают их разные вопросы.
 *
 *  - `confirm` — сервер вынес вердикт по набранному: строка под полем, поле помечено ошибкой;
 *  - `notice` — до вердикта не дошло (лимит, сбой сервиса, обрыв связи). Повторить можно тут же,
 *    поэтому строка тоже под полем, но набранное ни в чём не виновато и поле остаётся чистым;
 *  - `resend` — сорвалась повторная отправка: она про кнопку, поля к ней нет, и строка идёт наверх.
 *
 * Сорванное терминальное действие разбирается теми же ветками, но метка ему без надобности: секрет
 * к тому времени принят, поля на экране нет, и место у такого отказа одно — наверху.
 */
interface FlowFailure {
  from: 'confirm' | 'notice' | 'resend';
  text: string;
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
 * Отсюда же главное различие в разборе отказа: 429 повторяем (снимок цел), а 409, 403 и причины
 * `isOperationGone` в теле 400 неисправимы — операция помечается мёртвой, и экран уводит
 * на новую операцию. Ветка 409/403 обслуживает только терминалы: 409 отдают завершающие методы
 * второго фактора — `apply-password`, `apply-totp` и `apply-recovery-codes` (состояние 2FA
 * изменилось уже после создания операции), 403 — чужая операция или операция не того типа.
 * У открытия сессии и у `apply-operation` 409 по спеке нет вовсе.
 */
export function useConfirmFlow({
  terminal,
  onDone,
  onRevoked,
  onLeft,
  finishErrorKey = 'auth.errors.finish',
}: UseConfirmFlowArgs) {
  const { t } = useTranslation();
  const snapshot = useOperationStore((s) => s.snapshot);
  const dispatch = useOperationStore((s) => s.dispatch);
  const reset = useOperationStore((s) => s.reset);

  const [now, setNow] = useState(() => Date.now());
  const [failure, setFailure] = useState<FlowFailure | null>(null);
  // setState с тем же null React пропускает, так что вызов на каждый набранный символ безвреден.
  const clearError = useCallback(() => setFailure(null), []);
  // Текст и его источник ставятся одним вызовом: разойтись им нельзя, иначе отказ уедет не туда.
  const fail = useCallback(
    (from: FlowFailure['from'], text: string) => setFailure({ from, text }),
    [],
  );
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
        setFailure(null);
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
      setFailure(null);
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
          fail('confirm', apiErrorText(e, t));
        } else if (e instanceof ApiFieldError) {
          if (e.operationState) {
            dispatch({ type: 'CONFIRM_FAILED', state: e.operationState, now: Date.now() });
          }
          fail(
            'confirm',
            e.fields[0]?.detail || t(finishing ? finishErrorKey : 'auth.errors.wrongCode'),
          );
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
          fail('confirm', apiErrorText(e, t));
        } else if (e instanceof ApiRateLimitError || e instanceof ApiProblemError) {
          // Вердикта по секрету тут нет: лимит считает попытки, а сбой сервиса не дошёл до проверки.
          // 429 на терминале — например, лимит одновременных сессий на открытии. Подтверждённая
          // операция при этом НЕ расходуется, поэтому снимок не сбрасываем: фаза `confirmed` уже
          // выставлена, и повтор пойдёт сразу в терминал, пока не истёк срок жизни операции.
          fail('notice', apiErrorText(e, t));
        } else {
          // Не ответ сервиса (сеть, сбой в самом клиенте) — здесь уместнее сказать про шаг,
          // на котором сорвалось, чем общее «что-то пошло не так» из apiErrorText.
          fail('notice', t(finishing ? finishErrorKey : 'auth.errors.confirm'));
        }
      } finally {
        setSubmitting(false);
      }
    },
    [snapshot, startNextLink, runTerminal, dispatch, fail, finishErrorKey, t],
  );

  const resend = useCallback(async () => {
    if (!snapshot || resending) return; // защита от повторной отправки (двойной клик жжёт лимит)
    setResending(true);
    setFailure(null);
    try {
      const op = await resendOperation({ token: snapshot.token });
      dispatch({ type: 'RESENT', parts: op, now: Date.now() });
    } catch (e) {
      if (e instanceof ApiFieldError && isOperationGone(e)) {
        // Операции нет — новый код слать некуда, и вводить его тоже некуда: тот же тупик.
        dispatch({ type: 'INVALIDATED' });
        fail('resend', apiErrorText(e, t));
      } else if (e instanceof ApiFieldError) {
        // Счётчики несёт не всякий отказ: у «операция уже подтверждена» их нет — там и обновлять
        // нечего. Поэтому смотрим на само тело, а не на код: пришёл operation_state — применяем.
        // Деталь сервера в любом случае объясняет отказ точнее нашего запасного текста.
        if (e.operationState) {
          dispatch({ type: 'CONFIRM_FAILED', state: e.operationState, now: Date.now() });
        }
        fail('resend', e.fields[0]?.detail || t('auth.errors.resendUnavailable'));
      } else if (e instanceof ApiProblemError) {
        // Троттл повторной отправки приходит сюда не 429-м, а 400-м выше: срок повтора клиент
        // берёт из operation_state.resends_in, которого тело problem+json не вмещает. Здесь
        // остаётся то, что про саму операцию не говорит ничего.
        fail('resend', apiErrorText(e, t));
      } else {
        // Не ответ сервиса (сеть, сбой в самом клиенте) — говорим про шаг, на котором сорвалось.
        fail('resend', t('auth.errors.resend'));
      }
    } finally {
      setResending(false);
    }
  }, [snapshot, dispatch, fail, resending, t]);

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

  /**
   * Уход с экрана без отзыва: операция остаётся на сервере и ждёт — запроса тут нет вовсе, и этим
   * `leave` отличается от `revoke`. Снимок всё равно гасим: экран закрыт, а собрать его заново
   * умеет тот, кто к операции возвращает, — он читает её из профиля.
   */
  const leave = useCallback(() => {
    reset();
    onLeft?.();
  }, [reset, onLeft]);

  return {
    snapshot,
    error: failure?.text ?? null,
    /** На чём сорвалось: отсюда экран берёт и место строки, и то, помечать ли поле (`FlowFailure`). */
    errorFrom: failure?.from ?? null,
    /** Снять показанный отказ — экран зовёт на правке набранного, когда отказ был про него. */
    clearError,
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
    leave,
  };
}

/** Состояние и действия подтверждения — то, чем питается презентационный OperationConfirm. */
export type ConfirmFlow = ReturnType<typeof useConfirmFlow>;
