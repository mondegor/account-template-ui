import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { ApiFieldError, ApiProblemError, ApiRateLimitError } from '@core/api';
import { addTranslations, i18next, initI18n, setLanguage } from '@core/i18n';
import { authTranslations } from '../i18n';
import { useOperationStore } from '@core/operation';
import { confirmOperation, openSession, resendOperation } from '../api/authApi';
import { useConfirmFlow } from './useConfirmFlow';

/**
 * Терминальный шаг подтверждения. Проверяется контракт спеки: после 204 сессия открывается БЕЗ
 * secret (подтверждать нечего, и сервер это поле игнорирует), а 429 на открытии сессии не
 * расходует операцию — снимок обязан пережить отказ и остаться подтверждённым, чтобы повтор пошёл
 * ровно в openSession. Переиграй он подтверждение — экран впустую попросил бы код ещё раз, а
 * ответом на него был бы тот же 204: операция от повторного confirm не сдвигается.
 *
 * Терминал у хука — параметр, поэтому кейсы гоняют ровно тот, что передаёт узел подтверждения
 * входа: только так проверка остаётся про вход, а не про подставную функцию.
 */

vi.mock('../api/authApi', () => ({
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

function rateLimited(retryAfterSec?: number) {
  return new ApiRateLimitError(
    {
      title: 'Too Many Requests',
      status: 429,
      detail: 'Превышен лимит одновременных сессий',
      instance: '',
      time: '',
    },
    retryAfterSec,
  );
}

beforeAll(() => {
  setLanguage('ru');
  initI18n();
  // Ветку auth.* в приложении регистрирует registerModule(authModule) — для хука хватит её одной.
  addTranslations(authTranslations);
});

// Язык возвращаем ЗДЕСЬ, а не в afterEach: к этому моменту RTL уже размонтировал хук предыдущего
// теста, и смена языка никого не перерисовывает — иначе ререндер уезжает мимо act().
beforeEach(async () => {
  sessionStorage.clear();
  useOperationStore.getState().reset();
  vi.mocked(confirmOperation).mockReset();
  vi.mocked(openSession).mockReset();
  vi.mocked(resendOperation).mockReset();
  await i18next.changeLanguage('ru');
});

afterEach(() => {
  // Тик хука живёт на setInterval: оставленные фейковые таймеры утекли бы в соседний кейс.
  vi.useRealTimers();
});

describe('useConfirmFlow: терминальное открытие сессии', () => {
  it('после 204 открывает сессию только по токену — secret туда уже не идёт', async () => {
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

  it('429 на открытии сессии: показываем отказ, но операцию не теряем', async () => {
    vi.mocked(confirmOperation).mockResolvedValue(null);
    vi.mocked(openSession).mockRejectedValue(rateLimited(30));
    useOperationStore.getState().dispatch(activeOp);
    const { result } = renderHook(() =>
      useConfirmFlow({ terminal: loginTerminal, onDone: vi.fn(), onRevoked: vi.fn() }),
    );

    await act(async () => {
      await result.current.confirm('183947');
    });

    // Серверная деталь + срок из Retry-After: пауза короче минуты называется секундами.
    expect(result.current.error).toBe(
      'Превышен лимит одновременных сессий Повторить можно через 30 секунд.',
    );
    // Снимок на месте и тем же токеном — повторяется ТОТ ЖЕ запрос, новая операция не нужна.
    expect(useOperationStore.getState().snapshot?.token).toBe(TOKEN);
    // Фаза `confirmed`, а не `active`: подтверждение пройдено, повторять надо открытие сессии.
    expect(useOperationStore.getState().snapshot?.phase).toBe('confirmed');
    expect(result.current.awaitingFinish).toBe(true);
  });

  it('повтор после 429 идёт сразу в openSession — второго confirm нет', async () => {
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
  it('подтверждённая операция истекла — отказ 429 из сообщения уходит', async () => {
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
    expect(result.current.error).toContain('Превышен лимит одновременных сессий');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(601_000);
    });

    expect(useOperationStore.getState().snapshot?.phase).toBe('dead');
    expect(result.current.error).toBeNull();
  });

  it('429 без detail в теле — общий текст, а не пустой алерт', async () => {
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

    expect(result.current.error).toBe('Слишком много попыток. Повторите позже.');
  });

  /**
   * 409 — условие, при котором операция создавалась, отпало (2FA отключили уже после её создания).
   * В отличие от 429 повторять нечего: снимок обязан стать мёртвым, иначе экран продолжил бы
   * просить код по токену, который сервер больше не примет.
   */
  it('409 на открытии сессии: операция помечена мёртвой', async () => {
    vi.mocked(confirmOperation).mockResolvedValue(null);
    vi.mocked(openSession).mockRejectedValue(
      new ApiProblemError({
        title: 'Conflict',
        status: 409,
        detail: '2FA была отключена после создания операции',
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
    expect(result.current.error).toBe('2FA была отключена после создания операции');
    // Повтор невозможен: экран увёл в тупик, а не в «Повторить».
    expect(result.current.awaitingFinish).toBe(false);
  });

  /**
   * 403 у открытия сессии — тоже тупик, а не повод для «Повторить»: все его причины по спеке
   * терминальные (токен не от входа/регистрации, привязка к realm'у снята, вкладка уже
   * авторизована). Разбирается заодно с 409, потому что у подтверждения кода 403 нет вовсе.
   */
  it('403 на открытии сессии: операция помечена мёртвой, повтора не предлагаем', async () => {
    vi.mocked(confirmOperation).mockResolvedValue(null);
    vi.mocked(openSession).mockRejectedValue(
      new ApiProblemError({
        title: 'Forbidden',
        status: 403,
        detail: 'Доступ к контуру отозван',
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
    expect(result.current.error).toBe('Доступ к контуру отозван');
    expect(result.current.awaitingFinish).toBe(false);
  });

  /**
   * `OperationInvalid/token` — операцию израсходовала соседняя вкладка, пока эта ждала повтора
   * после 429. Токен сервер больше не примет, поэтому «Повторить» предлагать нельзя: снимок
   * обязан стать мёртвым, как при 409, — иначе экран зовёт в кнопку, которая всегда откажет.
   */
  it('400 OperationInvalid на повторе входа: снимок мёртв, «Повторить» пропадает', async () => {
    vi.mocked(confirmOperation).mockResolvedValue(null);
    vi.mocked(openSession)
      .mockRejectedValueOnce(rateLimited(30))
      .mockRejectedValueOnce(
        new ApiFieldError(
          [{ code: 'OperationInvalid/token', detail: 'Токен операции неизвестен' }],
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
    expect(result.current.error).toBe('Токен операции неизвестен');
  });

  /**
   * `ConfirmCodeIsRequired/secret` — обратный случай: операция подтверждена НЕ полностью, и терминал
   * позвали рано. Она цела, попытка по спеке не расходуется, а тело несёт operation_state — поэтому
   * снимок обязан вернуться к вводу секрета текущего звена, а не умереть.
   */
  it('400 ConfirmCodeIsRequired на терминале: операция жива, снова просим секрет', async () => {
    vi.mocked(confirmOperation).mockResolvedValue(null);
    vi.mocked(openSession).mockRejectedValue(
      new ApiFieldError(
        [{ code: 'ConfirmCodeIsRequired/secret', detail: 'Операция подтверждена не полностью' }],
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
    expect(result.current.error).toBe('Операция подтверждена не полностью');
    // Счётчики взяты из тела отказа, а не оставлены прежними.
    expect(useOperationStore.getState().snapshot?.remainingAttempts).toBe(2);
  });

  /**
   * `OperationIsNotConfirmed/token` спека называет только у `POST /v1/security/apply-*`: терминал
   * позвали по операции, которую сервер подтверждённой не считает. Токен он больше не примет —
   * тупик, как и у прочих терминальных причин.
   */
  it('400 OperationIsNotConfirmed от терминала: снимок мёртв', async () => {
    vi.mocked(confirmOperation).mockResolvedValue(null);
    useOperationStore.getState().dispatch(activeOp);
    const { result } = renderHook(() =>
      useConfirmFlow({
        terminal: () =>
          Promise.reject(
            new ApiFieldError(
              [{ code: 'OperationIsNotConfirmed/token', detail: 'Операция не подтверждена' }],
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
    expect(result.current.error).toBe('Операция не подтверждена');
  });

  it('409 на подтверждении кода: та же мёртвая операция', async () => {
    vi.mocked(confirmOperation).mockRejectedValue(
      new ApiProblemError({
        title: 'Conflict',
        status: 409,
        detail: 'Подтверждать больше нечего',
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
    expect(vi.mocked(openSession)).not.toHaveBeenCalled();
  });
});

/**
 * Отказ повторной отправки. Причины «операция кончилась» (`OperationInvalid`,
 * `OperationAlreadyExpired`, `OperationAlreadyConfirmed`) приходят 400-кой БЕЗ `operation_state`:
 * счётчиков там нет, а деталь сервера объясняет отказ точнее любого нашего запасного текста.
 */
describe('useConfirmFlow: отказ повторной отправки', () => {
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

  it('400 без operation_state доносит деталь сервера, а не общий текст', async () => {
    // Код подтверждённой операции слать повторно незачем, но сама она цела — по ней ещё открывают
    // сессию, поэтому снимок остаётся живым.
    const result = await resendFailsWith(
      new ApiFieldError(
        [{ code: 'OperationAlreadyConfirmed/token', detail: 'Операция уже подтверждена' }],
        400,
      ),
    );

    expect(result.current.error).toBe('Операция уже подтверждена');
    // Счётчиков в теле не было — снимок трогать нечем.
    expect(useOperationStore.getState().snapshot?.remainingAttempts).toBe(3);
    expect(useOperationStore.getState().snapshot?.phase).toBe('active');
  });

  it('операции больше нет → снимок мёртв, новый код просить не у чего', async () => {
    const result = await resendFailsWith(
      new ApiFieldError(
        [{ code: 'OperationAlreadyExpired/token', detail: 'Срок жизни операции истёк' }],
        400,
      ),
    );

    expect(useOperationStore.getState().snapshot?.phase).toBe('dead');
    expect(result.current.error).toBe('Срок жизни операции истёк');
  });

  it('ответ сервиса не по форме полей (5xx) — деталь сервера по общему правилу', async () => {
    const result = await resendFailsWith(
      new ApiProblemError({
        title: 'Internal Server Error',
        status: 500,
        detail: 'Сервис временно недоступен',
        instance: '',
        time: '',
      }),
    );

    expect(result.current.error).toBe('Сервис временно недоступен');
  });

  it('не ответ сервиса (сеть) — текст про шаг, на котором сорвалось', async () => {
    const result = await resendFailsWith(new Error('boom'));

    expect(result.current.error).toBe('Не удалось отправить код повторно.');
  });
});

/**
 * Запасные тексты ошибок берутся из переводов, а не из литералов в коде: иначе англоязычный
 * пользователь получал бы в одном и том же слоте то английский текст (429), то русский.
 */
describe('useConfirmFlow: запасные тексты ошибок переведены', () => {
  it.each([
    ['ru', 'Неверный код'],
    ['en', 'Wrong code'],
  ])('400 без detail на языке %s → %s', async (lng, expected) => {
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

    expect(result.current.error).toBe(expected);
  });

  it.each([
    ['ru', 'Не удалось подтвердить код. Попробуйте ещё раз.'],
    ['en', 'Could not confirm the code. Please try again.'],
  ])('неизвестная ошибка на языке %s → %s', async (lng, expected) => {
    await i18next.changeLanguage(lng);
    vi.mocked(confirmOperation).mockRejectedValue(new Error('boom'));
    useOperationStore.getState().dispatch(activeOp);
    const { result } = renderHook(() =>
      useConfirmFlow({ terminal: loginTerminal, onDone: vi.fn(), onRevoked: vi.fn() }),
    );

    await act(async () => {
      await result.current.confirm('183947');
    });

    expect(result.current.error).toBe(expected);
  });

  /**
   * Запасной текст называет ШАГ, на котором сорвалось. На открытии сессии кода не вводили вовсе:
   * «Неверный код» назвал бы неверным то, чего не было, и отправил бы искать ошибку в письме.
   */
  describe('сорвалось открытие сессии — текст не про код', () => {
    /** 204 прошло, дальше падает openSession: тот же вызов confirm(), но шаг уже другой. */
    function failFinishWith(e: unknown) {
      vi.mocked(confirmOperation).mockResolvedValue(null);
      vi.mocked(openSession).mockRejectedValue(e);
      useOperationStore.getState().dispatch(activeOp);
      return renderHook(() =>
        useConfirmFlow({ terminal: loginTerminal, onDone: vi.fn(), onRevoked: vi.fn() }),
      );
    }

    it.each([
      ['ru', 'Не удалось завершить вход. Повторите попытку.'],
      ['en', 'Could not complete sign-in. Please try again.'],
    ])('400 без detail на языке %s → %s', async (lng, expected) => {
      await i18next.changeLanguage(lng);
      const { result } = failFinishWith(
        new ApiFieldError([{ code: 'ErrorCode', detail: '' }], 400),
      );

      await act(async () => {
        await result.current.confirm('183947');
      });

      expect(result.current.error).toBe(expected);
    });

    it('сеть на повторе входа — тоже про вход, а не про подтверждение кода', async () => {
      const { result } = failFinishWith(new Error('boom'));

      // Первый заход: 204 прошло, упало открытие сессии.
      await act(async () => {
        await result.current.confirm('183947');
      });
      expect(result.current.error).toBe('Не удалось завершить вход. Повторите попытку.');

      // Повтор с фазы `confirmed` — секрета нет вовсе, текст обязан остаться тем же.
      await act(async () => {
        await result.current.confirm('');
      });
      expect(result.current.error).toBe('Не удалось завершить вход. Повторите попытку.');
    });

    /**
     * Шаг называется в тексте, а шаг у каждого потока свой: у security-потоков терминал — это не
     * вход, и «не удалось завершить вход» отправило бы искать проблему совсем не там. Поэтому ключ
     * запасного текста задаёт вызывающий, а дефолт остаётся входовым.
     */
    it('свой finishErrorKey подменяет текст про вход', async () => {
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

      expect(result.current.error).toBe('Повтор пока недоступен');
    });
  });
});
