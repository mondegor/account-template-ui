import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { ApiFieldError, ApiProblemError, ApiRateLimitError } from '@core/api';
import { addTranslations, i18next, initI18n, setLanguage } from '@core/i18n';
import { authTranslations } from '../i18n';
import { useOperationStore } from '@core/operation';
import { applyPassword, confirmOperation, openSession, resendOperation } from '../api/authApi';
import { useConfirmFlow } from './useConfirmFlow';
import { tr } from '../../../test/i18n';

/**
 * Терминальный шаг подтверждения. Проверяется контракт спеки: после 204 сессия открывается БЕЗ
 * secret (подтверждать нечего, и сервер это поле игнорирует), а 429 на открытии сессии не
 * расходует операцию — снимок обязан пережить отказ и остаться подтверждённым, чтобы повтор пошёл
 * ровно в openSession. Переиграй он подтверждение — экран впустую попросил бы код ещё раз, а
 * ответом на него был бы тот же 204: операция от повторного confirm не сдвигается.
 *
 * Терминал у хука — параметр, поэтому кейсы гоняют настоящие завершающие методы, а не подставную
 * функцию: обычно тот же, что передаёт узел подтверждения входа, а там, где ответ объявлен только
 * у security-потока, — его завершающий метод.
 */

vi.mock('../api/authApi', () => ({
  applyPassword: vi.fn(),
  confirmOperation: vi.fn(),
  openSession: vi.fn(),
  resendOperation: vi.fn(),
  revokeOperation: vi.fn(),
}));

const TOKEN = 't'.repeat(64);

const activeOp = {
  type: 'START' as const,
  parts: {
    token: TOKEN,
    confirm_method: 'EMAIL',
    remaining_attempts: 3,
    remaining_resends: 1,
    resends_in: 30,
    expires_in: 600,
  },
  now: Date.now(),
};

/** Терминал входа — тот же, что передаёт ConfirmOperationNode: 201 закрывает операцию, 200 = звено. */
const loginTerminal = async (token: string) => {
  const result = await openSession({ token });
  return result.kind === 'access' ? undefined : result.operation;
};

/**
 * Терминал включения пароля вторым фактором: цепочка звеньев у него та же, а вот 409 спека
 * объявляет только у завершающих методов второго фактора — открытие сессии его не отдаёт.
 */
const factorTerminal = async (token: string) => {
  await applyPassword({ token });
  return undefined;
};

function rateLimited(retryAfterSec?: number) {
  return new ApiRateLimitError(
    {
      title: 'Too Many Requests',
      status: 429,
      detail: 'Concurrent session limit exceeded',
      instance: '',
      time: '',
    },
    retryAfterSec,
  );
}

beforeAll(() => {
  setLanguage('en');
  initI18n();
  // Ветку auth.* в приложении регистрирует registerModule(authModule) — для хука хватит её одной.
  addTranslations(authTranslations);
});

// Язык возвращаем ЗДЕСЬ, а не в afterEach: к этому моменту RTL уже размонтировал хук предыдущего
// теста, и смена языка никого не перерисовывает — иначе ререндер уезжает мимо act().
beforeEach(async () => {
  sessionStorage.clear();
  useOperationStore.getState().reset();
  vi.mocked(applyPassword).mockReset();
  vi.mocked(confirmOperation).mockReset();
  vi.mocked(openSession).mockReset();
  vi.mocked(resendOperation).mockReset();
  await i18next.changeLanguage('en');
});

afterEach(() => {
  // Тик хука живёт на setInterval: оставленные фейковые таймеры утекли бы в соседний кейс.
  vi.useRealTimers();
});

describe('useConfirmFlow: the terminal session opening', () => {
  it('after a 204 the session is opened by the token alone: the secret no longer travels there', async () => {
    vi.mocked(confirmOperation).mockResolvedValue(null);
    vi.mocked(openSession).mockResolvedValue({
      kind: 'access',
      access: { access_token: 'a'.repeat(32), expires_in: 1800 },
    });
    useOperationStore.getState().dispatch(activeOp);
    const onAccess = vi.fn();
    const { result } = renderHook(() =>
      useConfirmFlow({ terminal: loginTerminal, onDone: onAccess, onRevoked: vi.fn() }),
    );

    await act(async () => {
      await result.current.confirm('183947');
    });

    expect(vi.mocked(confirmOperation)).toHaveBeenCalledWith({ token: TOKEN, secret: '183947' });
    expect(vi.mocked(openSession)).toHaveBeenCalledWith({ token: TOKEN });
    expect(onAccess).toHaveBeenCalled();
  });

  it('a 429 while opening the session: we show the refusal but keep the operation', async () => {
    vi.mocked(confirmOperation).mockResolvedValue(null);
    vi.mocked(openSession).mockRejectedValue(rateLimited(30));
    useOperationStore.getState().dispatch(activeOp);
    const { result } = renderHook(() =>
      useConfirmFlow({ terminal: loginTerminal, onDone: vi.fn(), onRevoked: vi.fn() }),
    );

    await act(async () => {
      await result.current.confirm('183947');
    });

    // Серверная деталь как есть: срок из Retry-After в текст не подмешивается.
    expect(result.current.error).toBe('Concurrent session limit exceeded');
    // Снимок на месте и тем же токеном — повторяется ТОТ ЖЕ запрос, новая операция не нужна.
    expect(useOperationStore.getState().snapshot?.token).toBe(TOKEN);
    // Фаза `confirmed`, а не `active`: подтверждение пройдено, повторять надо открытие сессии.
    expect(useOperationStore.getState().snapshot?.phase).toBe('confirmed');
    expect(result.current.awaitingFinish).toBe(true);
  });

  it('the retry after a 429 goes straight to openSession: there is no second confirm', async () => {
    vi.mocked(confirmOperation).mockResolvedValue(null);
    vi.mocked(openSession)
      .mockRejectedValueOnce(rateLimited(30))
      .mockResolvedValueOnce({
        kind: 'access',
        access: { access_token: 'a'.repeat(32), expires_in: 1800 },
      });
    useOperationStore.getState().dispatch(activeOp);
    const onAccess = vi.fn();
    const { result } = renderHook(() =>
      useConfirmFlow({ terminal: loginTerminal, onDone: onAccess, onRevoked: vi.fn() }),
    );

    await act(async () => {
      await result.current.confirm('183947');
    });
    // Повтор: вводить нечего, экран шлёт пустой secret — фаза решает, куда идти.
    await act(async () => {
      await result.current.confirm('');
    });

    // Ключевое: подтверждение НЕ переигрывается — оно вернуло бы тот же 204, не сдвинув операцию.
    expect(vi.mocked(confirmOperation)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(openSession)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(openSession)).toHaveBeenLastCalledWith({ token: TOKEN });
    expect(onAccess).toHaveBeenCalled();
    expect(useOperationStore.getState().snapshot).toBeNull();
  });

  /**
   * Срок подтверждённой операции вышел, пока пользователь не жал «Повторить». Это тупик, и объяснить
   * его прошлым отказом нельзя: в `error` лежит «повторить можно через 30 секунд», а повторять уже
   * негде — кнопка исчезает вместе с фазой `confirmed`. Текст обязан уйти, чтобы экран сказал про
   * саму операцию, а не звал в несуществующую кнопку.
   */
  it('the confirmed operation expired: the 429 refusal leaves the message', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(confirmOperation).mockResolvedValue(null);
    vi.mocked(openSession).mockRejectedValue(rateLimited(30));
    useOperationStore.getState().dispatch({ ...activeOp, now: Date.now() });
    const { result } = renderHook(() =>
      useConfirmFlow({ terminal: loginTerminal, onDone: vi.fn(), onRevoked: vi.fn() }),
    );

    await act(async () => {
      await result.current.confirm('183947');
    });
    expect(result.current.error).toContain('Concurrent session limit exceeded');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(601_000);
    });

    expect(useOperationStore.getState().snapshot?.phase).toBe('dead');
    expect(result.current.error).toBeNull();
  });

  it('a 429 with no detail in the body gives the generic text, not an empty alert', async () => {
    vi.mocked(confirmOperation).mockResolvedValue(null);
    vi.mocked(openSession).mockRejectedValue(
      new ApiRateLimitError({
        title: 'Too Many Requests',
        status: 429,
        detail: '',
        instance: '',
        time: '',
      }),
    );
    useOperationStore.getState().dispatch(activeOp);
    const { result } = renderHook(() =>
      useConfirmFlow({ terminal: loginTerminal, onDone: vi.fn(), onRevoked: vi.fn() }),
    );

    await act(async () => {
      await result.current.confirm('183947');
    });

    expect(result.current.error).toBe(tr('common.error.rateLimited'));
  });

  /**
   * 409 — состояние второго фактора изменилось уже после создания операции, и завершающий метод
   * ею больше не распорядится. В отличие от 429 повторять нечего: снимок обязан стать мёртвым,
   * иначе экран продолжил бы просить код по токену, который сервер больше не примет. Терминал тут
   * security-потока: у открытия сессии 409 по спеке нет.
   */
  it('a 409 from the second-factor terminal marks the operation dead', async () => {
    vi.mocked(confirmOperation).mockResolvedValue(null);
    vi.mocked(applyPassword).mockRejectedValue(
      new ApiProblemError({
        title: 'Conflict',
        status: 409,
        detail: '2FA was disabled after the operation was created',
        instance: '',
        time: '',
      }),
    );
    useOperationStore.getState().dispatch(activeOp);
    const { result } = renderHook(() =>
      useConfirmFlow({ terminal: factorTerminal, onDone: vi.fn(), onRevoked: vi.fn() }),
    );

    await act(async () => {
      await result.current.confirm('183947');
    });

    expect(useOperationStore.getState().snapshot?.phase).toBe('dead');
    expect(result.current.error).toBe('2FA was disabled after the operation was created');
    // Повтор невозможен: экран увёл в тупик, а не в «Повторить».
    expect(result.current.awaitingFinish).toBe(false);
  });

  /**
   * 403 у открытия сессии — тоже тупик, а не повод для «Повторить»: все его причины по спеке
   * терминальные (токен не от входа/регистрации, привязка к realm'у снята, вкладка уже
   * авторизована). Разбирается заодно с 409, потому что у подтверждения кода 403 нет вовсе.
   */
  it('a 403 while opening the session marks the operation dead and offers no retry', async () => {
    vi.mocked(confirmOperation).mockResolvedValue(null);
    vi.mocked(openSession).mockRejectedValue(
      new ApiProblemError({
        title: 'Forbidden',
        status: 403,
        detail: 'Access to the realm has been revoked',
        instance: '',
        time: '',
      }),
    );
    useOperationStore.getState().dispatch(activeOp);
    const { result } = renderHook(() =>
      useConfirmFlow({ terminal: loginTerminal, onDone: vi.fn(), onRevoked: vi.fn() }),
    );

    await act(async () => {
      await result.current.confirm('183947');
    });

    expect(useOperationStore.getState().snapshot?.phase).toBe('dead');
    expect(result.current.error).toBe('Access to the realm has been revoked');
    expect(result.current.awaitingFinish).toBe(false);
  });

  /**
   * `OperationInvalid/token` — операцию израсходовала соседняя вкладка, пока эта ждала повтора
   * после 429. Токен сервер больше не примет, поэтому «Повторить» предлагать нельзя: снимок
   * обязан стать мёртвым, как при 409, — иначе экран зовёт в кнопку, которая всегда откажет.
   */
  it('400 OperationInvalid on a sign-in retry: the snapshot is dead and «Retry» disappears', async () => {
    vi.mocked(confirmOperation).mockResolvedValue(null);
    vi.mocked(openSession)
      .mockRejectedValueOnce(rateLimited(30))
      .mockRejectedValueOnce(
        new ApiFieldError(
          [{ code: 'OperationInvalid/token', detail: 'Unknown operation token' }],
          400,
        ),
      );
    useOperationStore.getState().dispatch(activeOp);
    const { result } = renderHook(() =>
      useConfirmFlow({ terminal: loginTerminal, onDone: vi.fn(), onRevoked: vi.fn() }),
    );

    await act(async () => {
      await result.current.confirm('183947');
    });
    expect(result.current.awaitingFinish).toBe(true);

    await act(async () => {
      await result.current.confirm('');
    });

    expect(useOperationStore.getState().snapshot?.phase).toBe('dead');
    expect(result.current.awaitingFinish).toBe(false);
    expect(result.current.error).toBe('Unknown operation token');
  });

  /**
   * `ConfirmCodeIsRequired/secret` — обратный случай: операция подтверждена НЕ полностью, и терминал
   * позвали рано. Она цела, попытка по спеке не расходуется, а тело несёт operation_state — поэтому
   * снимок обязан вернуться к вводу секрета текущего звена, а не умереть.
   */
  it('400 ConfirmCodeIsRequired at the terminal step: the operation is alive, we ask for the secret again', async () => {
    vi.mocked(confirmOperation).mockResolvedValue(null);
    vi.mocked(openSession).mockRejectedValue(
      new ApiFieldError(
        [{ code: 'ConfirmCodeIsRequired/secret', detail: 'The operation is not fully confirmed' }],
        400,
        // Счётчик отличается от стартового (3), иначе проверка ниже прошла бы и без применения
        // состояния — а применить его хук обязан: снимок возвращается к вводу секрета.
        { remaining_attempts: 2, remaining_resends: 1, resends_in: 30, expires_in: 600 },
      ),
    );
    useOperationStore.getState().dispatch(activeOp);
    const { result } = renderHook(() =>
      useConfirmFlow({ terminal: loginTerminal, onDone: vi.fn(), onRevoked: vi.fn() }),
    );

    await act(async () => {
      await result.current.confirm('183947');
    });

    expect(useOperationStore.getState().snapshot?.phase).toBe('active');
    expect(result.current.awaitingFinish).toBe(false);
    expect(result.current.error).toBe('The operation is not fully confirmed');
    // Счётчики взяты из тела отказа, а не оставлены прежними.
    expect(useOperationStore.getState().snapshot?.remainingAttempts).toBe(2);
  });

  /**
   * `OperationIsNotConfirmed/token` спека называет только у `POST /v1/security/apply-*`: терминал
   * позвали по операции, которую сервер подтверждённой не считает. Токен он больше не примет —
   * тупик, как и у прочих терминальных причин.
   */
  it('400 OperationIsNotConfirmed from the terminal step: the snapshot is dead', async () => {
    vi.mocked(confirmOperation).mockResolvedValue(null);
    useOperationStore.getState().dispatch(activeOp);
    const { result } = renderHook(() =>
      useConfirmFlow({
        terminal: () =>
          Promise.reject(
            new ApiFieldError(
              [{ code: 'OperationIsNotConfirmed/token', detail: 'The operation is not confirmed' }],
              400,
            ),
          ),
        onDone: vi.fn(),
        onRevoked: vi.fn(),
      }),
    );

    await act(async () => {
      await result.current.confirm('183947');
    });

    expect(useOperationStore.getState().snapshot?.phase).toBe('dead');
    expect(result.current.awaitingFinish).toBe(false);
    expect(result.current.error).toBe('The operation is not confirmed');
  });
});

/**
 * Отказ повторной отправки. Причины «операция кончилась» (`OperationInvalid`,
 * `OperationAlreadyExpired`, `OperationAlreadyConfirmed`) приходят 400-кой БЕЗ `operation_state`:
 * счётчиков там нет, а деталь сервера объясняет отказ точнее любого нашего запасного текста.
 */
describe('useConfirmFlow: a failed resend', () => {
  async function resendFailsWith(e: unknown) {
    vi.mocked(resendOperation).mockRejectedValue(e);
    useOperationStore.getState().dispatch(activeOp);
    const { result } = renderHook(() =>
      useConfirmFlow({ terminal: loginTerminal, onDone: vi.fn(), onRevoked: vi.fn() }),
    );
    await act(async () => {
      await result.current.resend();
    });
    return result;
  }

  it('a 400 without operation_state carries the server detail, not the generic text', async () => {
    // Код подтверждённой операции слать повторно незачем, но сама она цела — по ней ещё открывают
    // сессию, поэтому снимок остаётся живым.
    const result = await resendFailsWith(
      new ApiFieldError(
        [{ code: 'OperationAlreadyConfirmed/token', detail: 'The operation is already confirmed' }],
        400,
      ),
    );

    expect(result.current.error).toBe('The operation is already confirmed');
    // Счётчиков в теле не было — снимок трогать нечем.
    expect(useOperationStore.getState().snapshot?.remainingAttempts).toBe(3);
    expect(useOperationStore.getState().snapshot?.phase).toBe('active');
  });

  it('the operation is gone: the snapshot is dead, there is nothing left to ask a new code from', async () => {
    const result = await resendFailsWith(
      new ApiFieldError(
        [{ code: 'OperationAlreadyExpired/token', detail: 'The operation has expired' }],
        400,
      ),
    );

    expect(useOperationStore.getState().snapshot?.phase).toBe('dead');
    expect(result.current.error).toBe('The operation has expired');
  });

  it('a service answer outside the field shape (5xx) carries the server detail by the general rule', async () => {
    const result = await resendFailsWith(
      new ApiProblemError({
        title: 'Internal Server Error',
        status: 500,
        detail: 'The service is temporarily unavailable',
        instance: '',
        time: '',
      }),
    );

    expect(result.current.error).toBe('The service is temporarily unavailable');
  });

  it('not a service answer (the network) gives the text about the step that broke', async () => {
    const result = await resendFailsWith(new Error('boom'));

    expect(result.current.error).toBe(tr('auth.errors.resend'));
  });
});

/**
 * Запасные тексты ошибок берутся из переводов, а не из литералов в коде: иначе англоязычный
 * пользователь получал бы в одном и том же слоте то английский текст (429), то русский.
 *
 * Оба языка гоняются одним кейсом, а эталон берётся ключом. Сам по себе такой эталон вырождался
 * бы в сравнение перевода с собой, поэтому рядом закреплено, что словари по этому ключу и правда
 * расходятся: захардкоженная в коде строка совпала бы только с одним языком из двух.
 */
describe('useConfirmFlow: the fallback error texts are translated', () => {
  const differsByLanguage = (key: string) =>
    expect(i18next.getFixedT('ru')(key)).not.toBe(i18next.getFixedT('en')(key));

  it.each(['ru', 'en'])('a 400 with no detail is translated (%s)', async (lng) => {
    differsByLanguage('auth.errors.wrongCode');
    await i18next.changeLanguage(lng);
    vi.mocked(confirmOperation).mockRejectedValue(
      new ApiFieldError([{ code: 'ConfirmCodeIsIncorrect/secret', detail: '' }], 400),
    );
    useOperationStore.getState().dispatch(activeOp);
    const { result } = renderHook(() =>
      useConfirmFlow({ terminal: loginTerminal, onDone: vi.fn(), onRevoked: vi.fn() }),
    );

    await act(async () => {
      await result.current.confirm('000000');
    });

    expect(result.current.error).toBe(tr('auth.errors.wrongCode'));
  });

  it.each(['ru', 'en'])('an unknown error is translated (%s)', async (lng) => {
    differsByLanguage('auth.errors.confirm');
    await i18next.changeLanguage(lng);
    vi.mocked(confirmOperation).mockRejectedValue(new Error('boom'));
    useOperationStore.getState().dispatch(activeOp);
    const { result } = renderHook(() =>
      useConfirmFlow({ terminal: loginTerminal, onDone: vi.fn(), onRevoked: vi.fn() }),
    );

    await act(async () => {
      await result.current.confirm('183947');
    });

    expect(result.current.error).toBe(tr('auth.errors.confirm'));
  });

  /**
   * Запасной текст называет ШАГ, на котором сорвалось. На открытии сессии кода не вводили вовсе:
   * «Неверный код» назвал бы неверным то, чего не было, и отправил бы искать ошибку в письме.
   */
  describe('the session opening broke: the text is not about the code', () => {
    /** 204 прошло, дальше падает openSession: тот же вызов confirm(), но шаг уже другой. */
    function failFinishWith(e: unknown) {
      vi.mocked(confirmOperation).mockResolvedValue(null);
      vi.mocked(openSession).mockRejectedValue(e);
      useOperationStore.getState().dispatch(activeOp);
      return renderHook(() =>
        useConfirmFlow({ terminal: loginTerminal, onDone: vi.fn(), onRevoked: vi.fn() }),
      );
    }

    it.each(['ru', 'en'])('a 400 with no detail is translated (%s)', async (lng) => {
      expect(i18next.getFixedT('ru')('auth.errors.finish')).not.toBe(
        i18next.getFixedT('en')('auth.errors.finish'),
      );
      await i18next.changeLanguage(lng);
      const { result } = failFinishWith(
        new ApiFieldError([{ code: 'ErrorCode', detail: '' }], 400),
      );

      await act(async () => {
        await result.current.confirm('183947');
      });

      expect(result.current.error).toBe(tr('auth.errors.finish'));
    });

    it('a network failure on a sign-in retry is about the sign-in too, not about confirming the code', async () => {
      const { result } = failFinishWith(new Error('boom'));

      // Первый заход: 204 прошло, упало открытие сессии.
      await act(async () => {
        await result.current.confirm('183947');
      });
      expect(result.current.error).toBe(tr('auth.errors.finish'));

      // Повтор с фазы `confirmed` — секрета нет вовсе, текст обязан остаться тем же.
      await act(async () => {
        await result.current.confirm('');
      });
      expect(result.current.error).toBe(tr('auth.errors.finish'));
    });

    /**
     * Шаг называется в тексте, а шаг у каждого потока свой: у security-потоков терминал — это не
     * вход, и «не удалось завершить вход» отправило бы искать проблему совсем не там. Поэтому ключ
     * запасного текста задаёт вызывающий, а дефолт остаётся входовым.
     */
    it('a custom finishErrorKey replaces the sign-in text', async () => {
      vi.mocked(confirmOperation).mockResolvedValue(null);
      vi.mocked(openSession).mockRejectedValue(new Error('boom'));
      useOperationStore.getState().dispatch(activeOp);
      const { result } = renderHook(() =>
        useConfirmFlow({
          terminal: loginTerminal,
          onDone: vi.fn(),
          onRevoked: vi.fn(),
          finishErrorKey: 'auth.errors.resendUnavailable',
        }),
      );

      await act(async () => {
        await result.current.confirm('183947');
      });

      expect(result.current.error).toBe(tr('auth.errors.resendUnavailable'));
    });
  });
});
