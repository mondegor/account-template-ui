import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { addTranslations, initI18n, setLanguage } from '@core/i18n';
import { ApiProblemError } from '@core/api';
import { useOperationStore } from '@core/operation';
import { tr } from '../../../test/i18n';
import { authTranslations } from '../i18n';
import { startDisable2fa, startRecoveryCodesReissue } from '../api/authApi';
import { loadSecurityFlow } from '../lib/securityFlow';
import type { UserAuth2fa, WaitingConfirmOperation } from '../api/types';
import { TwoFaCard } from './TwoFaCard';

/**
 * Карточка защиты: что она говорит про каждое состояние `auth_2fa_type`, какие методы предлагает и
 * что запускают перевыпуск и отключение.
 */

vi.mock('../api/authApi', () => ({
  startDisable2fa: vi.fn(),
  startRecoveryCodesReissue: vi.fn(),
}));

const OPERATION: WaitingConfirmOperation = {
  token: 't'.repeat(64),
  confirm_method: 'EMAIL',
  remaining_attempts: 3,
  remaining_resends: 1,
  resends_in: 0,
  expires_in: 600,
};

/** Тело problem+json — фикстура теста; статус в нём и есть то, что показывается плашкой. */
const CONFLICT = new ApiProblemError({
  title: 'Conflict',
  status: 409,
  detail: '2FA is already off',
  instance: '',
  time: '',
});

function LocationProbe() {
  return <div data-testid="loc">{useLocation().pathname}</div>;
}

function renderCard(type: UserAuth2fa, recoveryCodesLeft?: number) {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={['/settings']}>
        <Routes>
          <Route
            path="/settings"
            element={<TwoFaCard type={type} recoveryCodesLeft={recoveryCodesLeft} />}
          />
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Плитку ищем как элемент: по содержимому это была бы проверка формулировки, а не раскладки. */
const passwordTile = () => screen.getByTestId('two-fa-method-PASSWORD');
const totpTile = () => screen.getByTestId('two-fa-method-TOTP');

beforeAll(() => {
  setLanguage('en');
  initI18n();
  // Без словаря модуля tr() вернул бы сам ключ, и он же стоял бы на экране: проверка сравнивала
  // бы ключ с ключом и зеленела при любом тексте.
  addTranslations(authTranslations);
});

beforeEach(() => {
  sessionStorage.clear();
  useOperationStore.getState().reset();
  vi.mocked(startRecoveryCodesReissue).mockReset().mockResolvedValue(OPERATION);
  vi.mocked(startDisable2fa).mockReset().mockResolvedValue(OPERATION);
});

afterEach(cleanup);

describe('TwoFaCard', () => {
  /** Состояние названо и словом в шапке, и строкой под ней: чип говорит «есть ли», строка — «чем». */
  it.each([
    ['NONE' as const, 'off' as const],
    ['PASSWORD' as const, 'on' as const],
    ['TOTP' as const, 'on' as const],
  ])('names the %s state', (type, chip) => {
    renderCard(type, type === 'NONE' ? undefined : 8);

    expect(screen.getByText(tr(`auth.twoFa.${chip}`))).toBeInTheDocument();
    expect(screen.getByText(tr(`auth.twoFa.lead.${type}`))).toBeInTheDocument();
  });

  /** Оба метода показаны всегда и в одном порядке — перестановка ломала бы узнавание. */
  it.each(['NONE' as const, 'PASSWORD' as const, 'TOTP' as const])(
    'shows both methods on %s',
    (type) => {
      renderCard(type, type === 'NONE' ? undefined : 8);

      expect(passwordTile()).toBeInTheDocument();
      expect(totpTile()).toBeInTheDocument();
    },
  );

  /** Пока защита выключена, пароль зовёт на свой экран — ссылкой призыва, а не всей плиткой. */
  it('offers the password while the protection is off', () => {
    renderCard('NONE');

    expect(
      within(passwordTile()).getByRole('link', { name: tr('auth.twoFa.method.password.cta') }),
    ).toHaveAttribute('href', '/security/password');
  });

  /**
   * Второй фактор не перезаписывается — инициаторы установки отвечают 409, пока защита включена.
   * Поэтому призыва у затенённого метода нет: звать некуда.
   */
  it('takes the call away from the method that cannot be set now', () => {
    renderCard('PASSWORD', 8);

    expect(within(totpTile()).queryByRole('link')).not.toBeInTheDocument();
    expect(
      within(totpTile()).queryByText(tr('auth.twoFa.method.totp.cta')),
    ).not.toBeInTheDocument();
    // Затенённой плитке нечего и снимать: включён не её метод.
    expect(
      within(totpTile()).queryByRole('button', { name: tr('auth.twoFa.disableShort') }),
    ).not.toBeInTheDocument();
    // Включённый метод тоже никуда не ведёт: какой он сейчас, говорит чип в шапке.
    expect(within(passwordTile()).queryByRole('link')).not.toBeInTheDocument();
  });

  /** У включённого метода плитка предлагает его снять — тем же инициатором, что и кнопка внизу. */
  it('starts the disable flow from the current method tile', async () => {
    renderCard('PASSWORD', 8);

    fireEvent.click(
      within(passwordTile()).getByRole('button', { name: tr('auth.twoFa.disableShort') }),
    );

    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/security/confirm'));
    expect(startDisable2fa).toHaveBeenCalled();
    expect(loadSecurityFlow()?.kind).toBe('disable2fa');
  });

  /** Остаток кодов говорится ступенями: цифра сама по себе не сказала бы, пора ли тревожиться. */
  it.each([
    [0, 'empty'],
    [1, 'last'],
    [3, 'low'],
    [8, 'enough'],
  ])('reads %i codes left by its own step', (left, level) => {
    renderCard('PASSWORD', left);

    expect(
      within(screen.getByTestId('two-fa-codes')).getByText(
        tr(`auth.twoFa.codesLeft.${level}`, { count: left }),
      ),
    ).toBeInTheDocument();
  });

  /** У выключенной защиты набора нет вовсе — ни строки остатка, ни отключения. */
  it('has neither the codes row nor the disable button while the protection is off', () => {
    renderCard('NONE');

    expect(screen.queryByTestId('two-fa-codes')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: tr('auth.twoFa.disable') }),
    ).not.toBeInTheDocument();
    // Включённого метода нет — нет и плитки, которая звала бы его снять.
    expect(
      screen.queryByRole('button', { name: tr('auth.twoFa.disableShort') }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(tr('auth.twoFa.codesPromise'))).toBeInTheDocument();
  });

  /** Перевыпуск начинается тем же жестом, что и любой security-поток. */
  it('starts the reissue flow', async () => {
    renderCard('PASSWORD', 2);

    fireEvent.click(screen.getByRole('button', { name: tr('auth.twoFa.reissue') }));

    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/security/confirm'));
    expect(startRecoveryCodesReissue).toHaveBeenCalled();
    expect(loadSecurityFlow()?.kind).toBe('recovery-codes');
    expect(useOperationStore.getState().snapshot?.token).toBe(OPERATION.token);
  });

  /** Отключение — тот же жест, свой инициатор. */
  it('starts the disable flow', async () => {
    renderCard('TOTP', 8);

    fireEvent.click(screen.getByRole('button', { name: tr('auth.twoFa.disable') }));

    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/security/confirm'));
    expect(startDisable2fa).toHaveBeenCalled();
    expect(loadSecurityFlow()?.kind).toBe('disable2fa');
  });

  /**
   * 409 — состояние 2FA изменилось после того, как карточку показали (например, в соседней вкладке).
   * Отказ говорится плашкой, а не проглатывается: кнопка, не сделавшая ничего, читается сломанной.
   */
  it('shows the refusal of the initiator', async () => {
    vi.mocked(startDisable2fa).mockRejectedValue(CONFLICT);
    renderCard('PASSWORD', 8);

    fireEvent.click(screen.getByRole('button', { name: tr('auth.twoFa.disable') }));

    expect(await screen.findByText(CONFLICT.details.detail)).toBeInTheDocument();
    expect(screen.queryByTestId('loc')).not.toBeInTheDocument();
  });
});
