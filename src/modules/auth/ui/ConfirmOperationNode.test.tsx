import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { ApiProblemError, ApiRateLimitError } from '@core/api';
import { initI18n, setLanguage } from '@core/i18n';
import { useOperationStore } from '@core/operation';
import type { SchemaNode } from '@core/schema';
import { authTranslations } from '../i18n';
import { confirmOperation, openSession } from '../api/authApi';
import { saveConfirmReturn } from '../lib/confirmReturn';
import { tr } from '../../../test/i18n';
import { ConfirmOperationNode } from './ConfirmOperationNode';

/**
 * «Отменить» на общем экране /confirm возвращает на исходный экран (signup/signin), запомненный
 * в sessionStorage (переживает reload); при отсутствии — дефолт /signin. После отмены запись
 * чистится. revokeOperation мокаем (сеть не нужна — отмена best-effort).
 */
vi.mock('../api/authApi', () => ({
  confirmOperation: vi.fn(),
  openSession: vi.fn(),
  resendOperation: vi.fn(),
  revokeOperation: vi.fn().mockResolvedValue(undefined),
}));

/** Причину аннулирования знает только сервер — она приходит текстом и в переводах её нет. */
const REALM_REVOKED_DETAIL = 'Access to the realm has been revoked';
/** Так же и причину отказа терминального действия: 429 приносит её своим detail. */
const LIMIT_DETAIL = 'Concurrent session limit exceeded';

const node: SchemaNode = { type: 'confirmOperation' };

// Зонд текущего маршрута: показывает pathname, куда увёл navigate.
function LocationProbe() {
  return <div data-testid="loc">{useLocation().pathname}</div>;
}

function renderConfirm() {
  return render(
    <MemoryRouter initialEntries={['/confirm']}>
      <Routes>
        <Route path="/confirm" element={<ConfirmOperationNode node={node} />} />
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeAll(() => {
  setLanguage('en');
  const i18n = initI18n();
  for (const [lng, res] of Object.entries(authTranslations)) {
    i18n.addResourceBundle(lng, 'translation', res, true, true);
  }
});

beforeEach(() => {
  sessionStorage.clear();
  vi.mocked(confirmOperation).mockReset();
  vi.mocked(openSession).mockReset();
  // Активная операция подтверждения, чтобы узел отрисовался (иначе snapshot=null → null).
  useOperationStore.getState().dispatch({
    type: 'START',
    parts: {
      token: 't'.repeat(64),
      confirm_method: 'EMAIL',
      remaining_attempts: 3,
      remaining_resends: 1,
      resends_in: 30,
      expires_in: 600,
    },
    now: Date.now(),
  });
});

afterEach(() => {
  // Тик узла живёт на setInterval: оставленные фейковые таймеры утекли бы в соседний кейс.
  vi.useRealTimers();
});

describe('ConfirmOperationNode: «revoke» returns to the screen the flow started from', () => {
  it('the signup flow (returnTo=/signup): revoke goes to /signup', async () => {
    saveConfirmReturn('/signup');
    renderConfirm();
    fireEvent.click(screen.getByRole('button', { name: tr('auth.confirm.revoke') }));
    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/signup'));
    // Запись НЕ чистим на «Отменить»: reset() снапшота в revoke() успевает дать ConfirmPage
    // редиректнуть по тому же loadConfirmReturn(); очистка до навигации вернула бы дефолт /signin.
    expect(sessionStorage.getItem('auth:confirmReturn')).toBe('/signup');
  });

  it('with no remembered origin (a direct visit): revoke goes to /signin, the default', async () => {
    renderConfirm();
    fireEvent.click(screen.getByRole('button', { name: tr('auth.confirm.revoke') }));
    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/signin'));
  });
});

/**
 * Аварийный код вместо второго фактора спека допускает у обычного входа и не допускает в цепочке
 * резервного: там он идёт отдельным звеном, и заменять им пароль значило бы потратить за один вход
 * два кода. Признака потока в снимке нет — звенья приходят по одному, — поэтому подсказку выбирает
 * то, откуда человек сюда пришёл.
 */
describe('ConfirmOperationNode: the second-factor hint', () => {
  function renderFactorLink(origin?: string) {
    if (origin) saveConfirmReturn(origin);
    useOperationStore.getState().dispatch({
      type: 'START',
      parts: {
        token: 't'.repeat(64),
        confirm_method: 'PASSWORD',
        remaining_attempts: 3,
        expires_in: 600,
      },
      now: Date.now(),
    });
    renderConfirm();
  }

  it('the sign-in flow: the hint offers a recovery code as well', () => {
    renderFactorLink('/signin');
    expect(screen.getByText(tr('auth.signin.confirmHint.PASSWORD'))).toBeInTheDocument();
  });

  it('the recovery flow: the hint stays about the second factor alone', () => {
    renderFactorLink('/signin/recovery');
    expect(screen.getByText(tr('auth.confirm.hint.PASSWORD'))).toBeInTheDocument();
  });

  /**
   * Источника нет — потока не знает никто, и звать аварийный код не на чем: в цепочке резервного
   * входа его на этом звене не примут, а отказ стоил бы одной попытки из трёх.
   */
  it('with no stored origin the hint stays about the second factor alone', () => {
    renderFactorLink();
    expect(screen.getByText(tr('auth.confirm.hint.PASSWORD'))).toBeInTheDocument();
  });
});

/**
 * Код принят, а открыть сессию не вышло (429 — лимит одновременных сессий). Операция при этом цела,
 * и повторять надо ровно открытие сессии: экран не должен просить код заново — звено уже пройдено,
 * и повторное подтверждение вернуло бы тот же 204, не приблизив пользователя ко входу.
 */
describe('ConfirmOperationNode: the terminal action is refused', () => {
  async function failOpenSession() {
    vi.mocked(confirmOperation).mockResolvedValue(null);
    vi.mocked(openSession).mockRejectedValue(
      new ApiRateLimitError(
        {
          title: 'Too Many Requests',
          status: 429,
          detail: LIMIT_DETAIL,
          instance: '',
          time: '',
        },
        30,
      ),
    );
    renderConfirm();
    fireEvent.change(screen.getByLabelText(tr('auth.field.code')), { target: { value: '183947' } });
    fireEvent.click(screen.getByRole('button', { name: tr('auth.confirm.submit') }));
    // Ждём ТЕКСТ ОТКАЗА, а не кнопку «Повторить»: кнопку рисует уже фаза `confirmed`, то есть до
    // того, как приедет отказ openSession. На той ранней отрисовке сабмит ещё выключен (submitting),
    // и клик по «Повторить» ушёл бы в никуда. Отказ же приходит вместе со снятием submitting.
    // Подстрокой: рядом с detail сервера экран говорит ещё и когда можно повторить.
    await screen.findByText(LIMIT_DETAIL, { exact: false });
  }

  it('the code field and resend go away, «retry» stays', async () => {
    await failOpenSession();

    expect(screen.queryByLabelText(tr('auth.field.code'))).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: tr('auth.confirm.submit') }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(tr('auth.confirm.resendLink'))).not.toBeInTheDocument();
    expect(screen.getByText(tr('auth.confirm.awaitingFinish'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: tr('auth.confirm.retryFinish') })).toBeEnabled();
  });

  it('«retry» touches only the session opening: the confirmation is not replayed', async () => {
    await failOpenSession();

    fireEvent.click(screen.getByRole('button', { name: tr('auth.confirm.retryFinish') }));

    await waitFor(() => expect(vi.mocked(openSession)).toHaveBeenCalledTimes(2));
    expect(vi.mocked(confirmOperation)).toHaveBeenCalledTimes(1);
  });

  /**
   * «Повторить» так и не нажали, и срок операции вышел. Отказ сервера объяснял прошлое состояние
   * экрана, а не это: повторять больше негде, и обещание «через 30 секунд» звало бы в кнопку,
   * которой уже нет. Экран обязан говорить про саму операцию.
   */
  it('the operation expired while the retry was pending: the text is about the operation, not the past refusal', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await failOpenSession();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(601_000);
    });

    expect(screen.getByText(tr('auth.confirm.invalidated'))).toBeInTheDocument();
    expect(screen.queryByText(LIMIT_DETAIL, { exact: false })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: tr('auth.confirm.retryFinish') }),
    ).not.toBeInTheDocument();
  });
});

/**
 * 403 — завершить операцию нельзя в принципе: привязка к контуру снята, вкладка уже авторизована
 * либо операция чужая. Приходит он от открытия сессии: у подтверждения кода такого ответа по спеке
 * нет. Экран обязан стать тупиком: ни поля кода, ни «Повторить», ни «запросить новый код» —
 * повторять нечего, единственный выход отсюда — начать вход заново. Объяснить это может только
 * сервер: свой текст про «начните заново» говорит, что делать, но не почему.
 */
describe('ConfirmOperationNode: the server invalidated the operation', () => {
  it('the screen collapses into a dead end carrying the server reason', async () => {
    vi.mocked(confirmOperation).mockResolvedValue(null);
    vi.mocked(openSession).mockRejectedValue(
      new ApiProblemError({
        title: 'Forbidden',
        status: 403,
        detail: REALM_REVOKED_DETAIL,
        instance: '',
        time: '',
      }),
    );
    renderConfirm();
    fireEvent.change(screen.getByLabelText(tr('auth.field.code')), { target: { value: '183947' } });
    fireEvent.click(screen.getByRole('button', { name: tr('auth.confirm.submit') }));

    expect(await screen.findByText(REALM_REVOKED_DETAIL)).toBeInTheDocument();
    expect(screen.queryByLabelText(tr('auth.field.code'))).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: tr('auth.confirm.submit') }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: tr('auth.confirm.retryFinish') }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(tr('auth.confirm.requestNewCode'), { exact: false }),
    ).not.toBeInTheDocument();
    // Выход с экрана остаётся ровно один.
    expect(screen.getByRole('button', { name: tr('auth.confirm.revoke') })).toBeInTheDocument();
  });

  /**
   * В `dead` приводит и локальный таймер — истечением уже подтверждённой операции. Отказа сервера
   * там не было, объяснять нечем, и вместо пустого места экран говорит свой текст.
   */
  it('with no server refusal (a confirmed operation expired): our own dead-end text', async () => {
    useOperationStore.getState().dispatch({ type: 'INVALIDATED' });
    renderConfirm();

    expect(await screen.findByText(tr('auth.confirm.invalidated'))).toBeInTheDocument();
    expect(screen.queryByLabelText(tr('auth.field.code'))).not.toBeInTheDocument();
  });
});
