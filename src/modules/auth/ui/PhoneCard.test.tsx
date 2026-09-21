import { useState } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { addTranslations, initI18n, setLanguage } from '@core/i18n';
import { ApiFieldError } from '@core/api';
import { useOperationStore } from '@core/operation';
import { tr } from '../../../test/i18n';
import { authTranslations } from '../i18n';
import { startPhoneChange } from '../api/authApi';
import { loadSecurityFlow } from '../lib/securityFlow';
import type { UserInfo, WaitingConfirmOperation } from '../api/types';
import { PhoneCard } from './PhoneCard';

/** Карточка телефона: установка и смена одним потоком, правка в самой карточке. */

vi.mock('../api/authApi', () => ({
  startPhoneChange: vi.fn(),
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

function LocationProbe() {
  return <div data-testid="loc">{useLocation().pathname}</div>;
}

function Host({ user, done = false }: { user: UserInfo; done?: boolean }) {
  const [editing, setEditing] = useState(false);
  return (
    <PhoneCard
      user={user}
      editing={editing}
      onEdit={() => setEditing(true)}
      onClose={() => setEditing(false)}
      done={done}
    />
  );
}

function renderCard(user: UserInfo = USER, done = false) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/settings']}>
        <Routes>
          <Route path="/settings" element={<Host user={user} done={done} />} />
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const continueButton = () => screen.getByRole('button', { name: tr('auth.contacts.continue') });

beforeAll(() => {
  setLanguage('en');
  initI18n();
  addTranslations(authTranslations);
});

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  useOperationStore.getState().reset();
  vi.mocked(startPhoneChange).mockResolvedValue(OPERATION);
});

afterEach(cleanup);

describe('PhoneCard', () => {
  it('without a number offers to add one', () => {
    renderCard();

    expect(screen.getByText(tr('auth.contacts.phone.empty'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: tr('auth.contacts.add') })).toBeInTheDocument();
  });

  it('with a number offers to change it', () => {
    renderCard({ ...USER, phone: '+7 999 888 77 66' });

    expect(screen.getByText('+7 999 888 77 66')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: tr('auth.contacts.change') })).toBeInTheDocument();
  });

  /** Форма начинается сразу с полем: ни прежнего номера, ни строки о его отсутствии над ним. */
  it('the edit does not repeat the current number', () => {
    renderCard({ ...USER, phone: '+7 999 888 77 66' });
    fireEvent.click(screen.getByRole('button', { name: tr('auth.contacts.change') }));

    expect(screen.queryByText('+7 999 888 77 66')).not.toBeInTheDocument();
    expect(screen.getByLabelText(tr('auth.contacts.phone.new'))).toBeInTheDocument();
  });

  it('setting the first number starts with the field alone', () => {
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: tr('auth.contacts.add') }));

    expect(screen.queryByText(tr('auth.contacts.phone.empty'))).not.toBeInTheDocument();
    expect(screen.getByLabelText(tr('auth.contacts.phone.field'))).toBeInTheDocument();
  });

  /** Иначе человек ждал бы SMS: код приходит на емаил. */
  it('says the code goes to the email, not to the phone', () => {
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: tr('auth.contacts.add') }));

    expect(
      screen.getByText(tr('auth.contacts.phone.hint', { email: USER.email })),
    ).toBeInTheDocument();
  });

  it('starts the flow with the number as typed and moves to the confirmation', async () => {
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: tr('auth.contacts.add') }));
    fireEvent.change(screen.getByLabelText(tr('auth.contacts.phone.field')), {
      target: { value: ' +7 (912) 345-67-89 ' },
    });

    fireEvent.click(continueButton());

    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/security/confirm'));
    expect(startPhoneChange).toHaveBeenCalledWith({ new_phone: '+7 (912) 345-67-89' });
    expect(loadSecurityFlow()).toEqual({ kind: 'phone', value: '+7 (912) 345-67-89' });
  });

  /** Пробелы, скобки и дефисы номер новым не делают. */
  it('the current number written differently is caught before the request', () => {
    renderCard({ ...USER, phone: '+7 999 888 77 66' });
    fireEvent.click(screen.getByRole('button', { name: tr('auth.contacts.change') }));
    fireEvent.change(screen.getByLabelText(tr('auth.contacts.phone.new')), {
      target: { value: '+7 (999) 888-77-66' },
    });

    fireEvent.click(continueButton());

    expect(screen.getByText(tr('auth.contacts.phone.same'))).toBeInTheDocument();
    expect(startPhoneChange).not.toHaveBeenCalled();
  });

  it('a refusal on the field sits under it', async () => {
    const detail = 'This phone number is already used by another user';
    vi.mocked(startPhoneChange).mockRejectedValue(
      new ApiFieldError([{ code: 'PhoneAlreadyExists/new_phone', detail }], 400),
    );
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: tr('auth.contacts.add') }));
    fireEvent.change(screen.getByLabelText(tr('auth.contacts.phone.field')), {
      target: { value: '+7 900 000 00 00' },
    });

    fireEvent.click(continueButton());

    expect(await screen.findByText(detail)).toBeInTheDocument();
  });

  it('shows the result of a change that has just finished', () => {
    renderCard({ ...USER, phone: '+7 999 888 77 66' }, true);

    expect(screen.getByText(tr('auth.contacts.phone.done'))).toBeInTheDocument();
  });
});
