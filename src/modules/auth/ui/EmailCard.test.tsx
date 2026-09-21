import { useState } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { addTranslations, initI18n, setLanguage } from '@core/i18n';
import { ApiFieldError, ApiProblemError } from '@core/api';
import { useOperationStore } from '@core/operation';
import { tr } from '../../../test/i18n';
import { authTranslations } from '../i18n';
import {
  applyOperation,
  getUserInfo,
  revokeOperation,
  startEmailChange,
  startEmailChangeByRecovery,
} from '../api/authApi';
import { fmtLong } from '../lib/format';
import { loadSecurityFlow } from '../lib/securityFlow';
import type { PendingOperation, UserInfo, WaitingConfirmOperation } from '../api/types';
import { EmailCard } from './EmailCard';

/**
 * Карточка емаила: правка в самой карточке, запуск одного из двух потоков смены и смена, которая
 * ждёт кода с нового адреса. Само подтверждение идёт на экране операции и проверяется там.
 */

vi.mock('../api/authApi', () => ({
  startEmailChange: vi.fn(),
  startEmailChangeByRecovery: vi.fn(),
  getUserInfo: vi.fn(),
  revokeOperation: vi.fn(),
  applyOperation: vi.fn(),
}));

const OPERATION: WaitingConfirmOperation = {
  token: 't'.repeat(64),
  confirm_method: 'EMAIL',
  remaining_attempts: 3,
  remaining_resends: 1,
  resends_in: 0,
  expires_in: 600,
};

const USER: UserInfo = {
  email: 'user@example.com',
  lang: 'en-US',
  tz: 'UTC',
  auth_2fa_type: 'NONE',
  realms: [],
  status: 'ENABLED',
};

const PENDING: PendingOperation = {
  token: 'p'.repeat(64),
  type: 'CHANGE_EMAIL_CONFIRM',
  extra_value: 'new@example.com',
  expires_at: '2099-01-01T00:00:00Z',
  status: 'OPENED',
  confirm_method: 'EMAIL',
  remaining_attempts: 2,
  remaining_resends: 1,
  resends_in: 0,
};

/**
 * Срок операции на экране — не литерал: его собирает тот же помощник, что и карточка, из пояса и
 * локали профиля (`UTC`, `en-US` у фикстуры выше). Записать результат строкой значило бы проверять
 * не строку блока, а форматирование дат — у него свои тесты.
 */
const UNTIL = fmtLong(PENDING.expires_at, 'en-US', 'UTC');

/** Та же смена, уже подтверждённая: вводить нечего, карточка применяет её сама. */
const CONFIRMED: PendingOperation = {
  token: PENDING.token,
  type: 'CHANGE_EMAIL_CONFIRM',
  extra_value: 'new@example.com',
  expires_at: PENDING.expires_at,
  status: 'CONFIRMED',
};

function LocationProbe() {
  return <div data-testid="loc">{useLocation().pathname}</div>;
}

/**
 * Правку держит страница — здесь её место занимает хост с тем же состоянием. Открыта она не больше
 * чем в одной карточке, поэтому рядом стоит кнопка вместо соседней: для емаила её нажатие значит
 * «правка началась, но не здесь».
 */
function Host({ user, done = false }: { user: UserInfo; done?: boolean }) {
  const [editing, setEditing] = useState<'email' | 'other' | null>(null);
  return (
    <>
      <EmailCard
        user={user}
        editing={editing === 'email'}
        anyEditing={editing !== null}
        onEdit={() => setEditing('email')}
        onClose={() => setEditing(null)}
        done={done}
      />
      <button data-testid="edit-other" onClick={() => setEditing('other')} />
    </>
  );
}

const editOther = () => fireEvent.click(screen.getByTestId('edit-other'));

/** Возвращает перерисовку с другим профилем — так в тесте выглядит его перечитывание. */
function renderCard(user: UserInfo = USER, done = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (u: UserInfo) => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/settings']}>
        <Routes>
          <Route path="/settings" element={<Host user={u} done={done} />} />
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  const { rerender } = render(tree(user));
  return (next: UserInfo) => rerender(tree(next));
}

const field = () => screen.getByLabelText(tr('auth.contacts.email.new'));
const continueButton = () => screen.getByRole('button', { name: tr('auth.contacts.continue') });

function openAndType(value: string) {
  fireEvent.click(screen.getByRole('button', { name: tr('auth.contacts.change') }));
  fireEvent.change(field(), { target: { value } });
}

beforeAll(() => {
  setLanguage('en');
  initI18n();
  addTranslations(authTranslations);
});

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  useOperationStore.getState().reset();
  vi.mocked(startEmailChange).mockResolvedValue(OPERATION);
  vi.mocked(startEmailChangeByRecovery).mockResolvedValue(OPERATION);
  vi.mocked(revokeOperation).mockResolvedValue(undefined);
  vi.mocked(applyOperation).mockResolvedValue(undefined);
});

afterEach(cleanup);

describe('EmailCard', () => {
  it('at rest shows the address and the action over it', () => {
    renderCard();

    expect(screen.getByText(USER.email)).toBeInTheDocument();
    expect(screen.getByText(tr('auth.contacts.email.sub'))).toBeInTheDocument();
    expect(screen.queryByLabelText(tr('auth.contacts.email.new'))).not.toBeInTheDocument();
  });

  /** Куда придёт код, сказано до нажатия: при смене адреса — на текущий, а не на новый. Сам адрес
      подсказка и называет, поэтому отдельной строки с ним над полем нет. */
  it('the edit says where the code goes instead of repeating the address', () => {
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: tr('auth.contacts.change') }));

    expect(screen.queryByText(USER.email)).not.toBeInTheDocument();
    expect(
      screen.getByText(tr('auth.contacts.email.hint', { email: USER.email })),
    ).toBeInTheDocument();
    expect(continueButton()).toBeDisabled();
  });

  it('starts the change and moves to the confirmation with the new address', async () => {
    renderCard();
    openAndType('  new@example.com ');

    fireEvent.click(continueButton());

    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/security/confirm'));
    expect(startEmailChange).toHaveBeenCalledWith({ new_email: 'new@example.com' });
    expect(loadSecurityFlow()).toEqual({ kind: 'email', value: 'new@example.com' });
    expect(useOperationStore.getState().snapshot?.token).toBe(OPERATION.token);
  });

  /** Операция на тот же адрес была бы пустой: регистр почта не различает. */
  it('the current address typed again is caught before the request', () => {
    renderCard();
    openAndType('User@Example.com');

    fireEvent.click(continueButton());

    expect(screen.getByText(tr('auth.contacts.email.same'))).toBeInTheDocument();
    expect(startEmailChange).not.toHaveBeenCalled();
  });

  it('a refusal on the field sits under it and goes away with the next edit', async () => {
    const detail = 'This email is already used by another user';
    vi.mocked(startEmailChange).mockRejectedValue(
      new ApiFieldError([{ code: 'EmailAlreadyExists/new_email', detail }], 400),
    );
    renderCard();
    openAndType('taken@example.com');

    fireEvent.click(continueButton());

    expect(await screen.findByText(detail)).toBeInTheDocument();
    expect(field()).toHaveAttribute('aria-invalid', 'true');

    fireEvent.change(field(), { target: { value: 'taken@example.co' } });
    await waitFor(() => expect(screen.queryByText(detail)).not.toBeInTheDocument());
  });

  it('a refusal about nothing in particular is said above the actions, the input stays', async () => {
    const failure = new ApiProblemError({
      title: 'Internal Server Error',
      status: 500,
      detail: 'Something broke',
      instance: '',
      time: '',
    });
    vi.mocked(startEmailChange).mockRejectedValue(failure);
    renderCard();
    openAndType('new@example.com');

    fireEvent.click(continueButton());

    expect(await screen.findByText('Something broke')).toBeInTheDocument();
    expect(field()).toHaveValue('new@example.com');
  });

  it('cancel closes the edit and forgets the input', () => {
    renderCard();
    openAndType('new@example.com');

    fireEvent.click(screen.getByRole('button', { name: tr('auth.contacts.cancel') }));
    fireEvent.click(screen.getByRole('button', { name: tr('auth.contacts.change') }));

    expect(field()).toHaveValue('');
  });

  /** Без 2FA доказательство у аккаунта одно — код на текущий адрес: запасного пути нет. */
  it('offers the email-less path only with 2FA on', () => {
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: tr('auth.contacts.change') }));

    expect(
      screen.queryByRole('button', { name: tr('auth.contacts.email.noAccess') }),
    ).not.toBeInTheDocument();
  });

  it('the email-less path starts its own flow', async () => {
    renderCard({ ...USER, auth_2fa_type: 'PASSWORD' });
    fireEvent.click(screen.getByRole('button', { name: tr('auth.contacts.change') }));
    fireEvent.click(screen.getByRole('button', { name: tr('auth.contacts.email.noAccess') }));
    expect(screen.getByText(tr('auth.contacts.email.recoveryTitle'))).toBeInTheDocument();
    expect(screen.getByText(tr('auth.contacts.email.recoveryHint'))).toBeInTheDocument();
    fireEvent.change(field(), { target: { value: 'new@example.com' } });

    fireEvent.click(continueButton());

    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/security/confirm'));
    expect(startEmailChangeByRecovery).toHaveBeenCalledWith({ new_email: 'new@example.com' });
    expect(startEmailChange).not.toHaveBeenCalled();
    expect(loadSecurityFlow()).toEqual({ kind: 'email-recovery', value: 'new@example.com' });
  });

  /** Гасит итог насовсем страница — при следующей правке; сама карточка не показывает его в правке. */
  it('shows the result of a change that has just finished, but not over the edit', () => {
    renderCard(USER, true);
    expect(screen.getByText(tr('auth.contacts.email.done'))).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: tr('auth.contacts.change') }));

    expect(screen.queryByText(tr('auth.contacts.email.done'))).not.toBeInTheDocument();
  });
});

describe('EmailCard (a change waiting for the code from the new address)', () => {
  const waiting: UserInfo = { ...USER, pending_operations: [PENDING] };

  it('names the new address and keeps the current one as the value', () => {
    renderCard(waiting);

    expect(screen.getByText(tr('auth.contacts.email.pendingChip'))).toBeInTheDocument();
    expect(
      screen.getByText(tr('auth.contacts.email.pending', { email: 'new@example.com' })),
    ).toBeInTheDocument();
    expect(screen.getByText(USER.email)).toBeInTheDocument();
  });

  /**
   * Чип и блок под строкой значения сообщают сам факт начатого изменения; что меняется — говорит
   * только эта строка. Новый адрес есть на экране дважды, но своим узлом — лишь здесь: в абзаце
   * блока он сидит внутри длинной фразы.
   */
  it('shows the transition right in the value row', () => {
    renderCard(waiting);

    expect(screen.getByText(USER.email)).toBeInTheDocument();
    expect(screen.getByText('new@example.com')).toBeInTheDocument();
    // Переход рисует стрелка, а вслух её не прочитают — рядом стоит слово для диктора.
    expect(screen.getByText(tr('auth.contacts.email.changingTo'))).toBeInTheDocument();
  });

  /** Без начатого изменения строка значения обещала бы переход, которого не начинали. */
  it('leaves the value row alone when no change is waiting', () => {
    renderCard(USER);

    expect(screen.getByText(USER.email)).toBeInTheDocument();
    expect(screen.queryByText('new@example.com')).not.toBeInTheDocument();
    expect(screen.queryByText(tr('auth.contacts.email.changingTo'))).not.toBeInTheDocument();
  });

  /**
   * Срок у операции один на оба состояния, а истекает по нему разное: пока код ждут — само
   * подтверждение, принятому коду остаётся успеть применить смену. Ждёт операция в обоих случаях,
   * но разного, и чип обязан говорить то же, что строка под ним.
   */
  it('a confirmed change counts down to the completion, not to the confirmation', () => {
    renderCard({ ...USER, pending_operations: [CONFIRMED] });

    expect(screen.getByText(tr('auth.contacts.email.pendingConfirmedChip'))).toBeInTheDocument();
    expect(screen.queryByText(tr('auth.contacts.email.pendingChip'))).not.toBeInTheDocument();
    expect(
      screen.getByText(tr('auth.contacts.email.pendingConfirmedWhen', { date: UNTIL }), {
        exact: false,
      }),
    ).toBeInTheDocument();
  });

  /** Счётчики берутся из свежего профиля: в кэше мог лежать снимок до прошлой попытки. */
  it('«confirm» opens the confirmation from a fresh profile, without a new code', async () => {
    const fresh: PendingOperation = { ...PENDING, remaining_attempts: 1 };
    vi.mocked(getUserInfo).mockResolvedValue({ ...waiting, pending_operations: [fresh] });
    renderCard(waiting);

    fireEvent.click(screen.getByRole('button', { name: tr('auth.contacts.email.confirm') }));

    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/security/confirm'));
    const snapshot = useOperationStore.getState().snapshot;
    expect(snapshot?.token).toBe(PENDING.token);
    expect(snapshot?.remainingAttempts).toBe(1);
    // Вид возврата свой: каким был шаг 1, профиль не говорит, и ступеней экран не покажет.
    expect(loadSecurityFlow()).toEqual({
      kind: 'email-confirm-resume',
      value: 'new@example.com',
    });
  });

  /**
   * Запись в OPENED без полей звена подтверждать нечем: кнопка отвечает отказом, а не тишиной —
   * иначе она молчала бы на каждое нажатие.
   */
  it('a waiting change with no confirmation link fails instead of doing nothing', async () => {
    const broken: PendingOperation = {
      token: PENDING.token,
      type: 'CHANGE_EMAIL_CONFIRM',
      extra_value: 'new@example.com',
      expires_at: PENDING.expires_at,
      status: 'OPENED',
    };
    vi.mocked(getUserInfo).mockResolvedValue({ ...waiting, pending_operations: [broken] });
    renderCard(waiting);

    fireEvent.click(screen.getByRole('button', { name: tr('auth.contacts.email.confirm') }));

    expect(await screen.findByText(tr('common.error.generic'))).toBeInTheDocument();
    // Пробник адреса живёт на всех прочих маршрутах: его отсутствие и значит, что ушли не отсюда.
    expect(screen.queryByTestId('loc')).toBeNull();
    expect(useOperationStore.getState().snapshot).toBeNull();
    expect(loadSecurityFlow()).toBeNull();
  });

  it('«cancel change» revokes the operation', async () => {
    renderCard(waiting);

    fireEvent.click(screen.getByRole('button', { name: tr('auth.contacts.email.cancelChange') }));

    await waitFor(() => expect(revokeOperation).toHaveBeenCalledWith({ token: PENDING.token }));
  });

  /** Код принят, а применить не успели: вводить нечего — карточка завершает смену сама. */
  it('a confirmed change is finished right in the card', async () => {
    renderCard({ ...USER, pending_operations: [CONFIRMED] });

    fireEvent.click(screen.getByRole('button', { name: tr('auth.contacts.email.finish') }));

    await waitFor(() => expect(applyOperation).toHaveBeenCalledWith({ token: PENDING.token }));
    expect(await screen.findByText(tr('auth.contacts.email.done'))).toBeInTheDocument();
  });

  /**
   * Отказ в применении закрывает операцию: перечитанный профиль её уже не несёт, блок ожидания
   * уходит — а объяснение остаётся в карточке.
   */
  it('keeps the finish error after the change is gone from the profile', async () => {
    const detail = 'Email is already taken';
    vi.mocked(applyOperation).mockRejectedValue(
      new ApiFieldError([{ code: 'EmailAlreadyExists', detail }], 400),
    );
    const reread = renderCard({ ...USER, pending_operations: [CONFIRMED] });

    fireEvent.click(screen.getByRole('button', { name: tr('auth.contacts.email.finish') }));
    expect(await screen.findByText(detail)).toBeInTheDocument();

    reread(USER);

    expect(screen.queryByRole('button', { name: tr('auth.contacts.email.finish') })).toBeNull();
    expect(screen.getByText(detail)).toBeInTheDocument();
  });

  /**
   * Отказ показывают оба действия одной строкой: она обязана говорить про то, что нажали сейчас,
   * а не про сорвавшееся до него.
   */
  it('a failed cancel is explained by the cancel, not by the resume before it', async () => {
    const resumeDetail = 'Profile is unavailable';
    const cancelDetail = 'The change is already gone';
    vi.mocked(getUserInfo).mockRejectedValue(
      new ApiProblemError({
        title: 'Internal Server Error',
        status: 500,
        detail: resumeDetail,
        instance: '',
        time: '',
      }),
    );
    vi.mocked(revokeOperation).mockRejectedValue(
      new ApiFieldError([{ code: 'OperationInvalid', detail: cancelDetail }], 400),
    );
    renderCard(waiting);

    fireEvent.click(screen.getByRole('button', { name: tr('auth.contacts.email.confirm') }));
    expect(await screen.findByText(resumeDetail)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: tr('auth.contacts.email.cancelChange') }));

    expect(await screen.findByText(cancelDetail)).toBeInTheDocument();
    expect(screen.queryByText(resumeDetail)).toBeNull();
  });

  /** Итог, достигнутый в карточке, гаснет от любой начатой правки, а не только от своей. */
  it('the finished result goes away with an edit started in another card', async () => {
    renderCard({ ...USER, pending_operations: [CONFIRMED] });

    fireEvent.click(screen.getByRole('button', { name: tr('auth.contacts.email.finish') }));
    expect(await screen.findByText(tr('auth.contacts.email.done'))).toBeInTheDocument();

    editOther();

    expect(screen.queryByText(tr('auth.contacts.email.done'))).toBeNull();
  });

  it('the finish error goes away with an edit started in another card', async () => {
    const detail = 'Email is already taken';
    vi.mocked(applyOperation).mockRejectedValue(
      new ApiFieldError([{ code: 'EmailAlreadyExists', detail }], 400),
    );
    renderCard({ ...USER, pending_operations: [CONFIRMED] });

    fireEvent.click(screen.getByRole('button', { name: tr('auth.contacts.email.finish') }));
    expect(await screen.findByText(detail)).toBeInTheDocument();

    editOther();

    expect(screen.queryByText(detail)).toBeNull();
  });

  /** Действия начатого изменения стоят в блоке; второй вход в правку спорил бы с ними. */
  it('hides the change button while a change is waiting', () => {
    renderCard(waiting);

    expect(screen.queryByRole('button', { name: tr('auth.contacts.change') })).toBeNull();
  });
});
