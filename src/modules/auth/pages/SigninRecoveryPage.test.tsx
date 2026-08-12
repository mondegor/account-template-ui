import { beforeAll, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient } from '@tanstack/react-query';
import { initI18n, setLanguage } from '@core/i18n';
import { registerBaseComponents } from '@core/renderer';
import { registerModule } from '@core/module-registry';
import { realmProvider } from '@core/auth';
import { contractRegistry } from '@core/contracts';
import { authModule } from '../module';
import { SigninPage } from './SigninPage';
import { SigninRecoveryPage } from './SigninRecoveryPage';
import { tr } from '../../../test/i18n';

/**
 * Резервный вход — отдельный экран той же schema-driven обвязки: свой заголовок, строка с тем, что
 * указать, путь назад к обычному входу и примечание о том, что понадобится (без него человек без
 * второго фактора уходил бы в цепочку, подтвердить которую ему нечем). Регистрации отсюда нет:
 * сюда приходят с уже существующим аккаунтом.
 */
beforeAll(() => {
  setLanguage('en');
  initI18n();
  registerBaseComponents();
  registerModule(authModule, {
    queryClient: new QueryClient(),
    contracts: contractRegistry,
    realmProvider,
  });
});

describe('SigninRecoveryPage (schema-driven)', () => {
  it('renders the auth.signinRecovery schema: the heading, the instruction, the field and submit', () => {
    render(
      <MemoryRouter>
        <SigninRecoveryPage />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('ui-page')).toHaveTextContent(tr('auth.signinRecovery.title'));
    expect(screen.getByTestId('ui-text')).toHaveTextContent(tr('auth.signinRecovery.enterLogin'));
    expect(screen.getByRole('textbox')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: tr('auth.signinRecovery.submit') }),
    ).toBeInTheDocument();
  });

  /**
   * Что понадобится — примечание, а не плашка: оно живёт в подвале карточки, ПОСЛЕ пути назад, и
   * потому в схему не входит. Порядок задан разметкой страницы и без этой проверки съедет молча —
   * а наверху эта же строка перебивала бы и заголовок, и инструкцию к полю.
   */
  it('puts the note at the very bottom, after the way back', () => {
    const { container } = render(
      <MemoryRouter>
        <SigninRecoveryPage />
      </MemoryRouter>,
    );

    const card = container.textContent ?? '';
    expect(card).toContain(tr('auth.signinRecovery.twoFaOnly'));
    expect(card.indexOf(tr('auth.signinRecovery.emailSigninLink'))).toBeLessThan(
      card.indexOf(tr('auth.signinRecovery.twoFaOnly')),
    );
    // В схеме примечания нет: страница дорисовывает его сама.
    expect(screen.getByTestId('ui-page')).not.toHaveTextContent(
      tr('auth.signinRecovery.twoFaOnly'),
    );
  });

  it('offers the way back to the email sign-in and no sign-up', () => {
    render(
      <MemoryRouter>
        <SigninRecoveryPage />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole('button', { name: tr('auth.signinRecovery.emailSigninLink') }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: tr('auth.signin.signupLink') }),
    ).not.toBeInTheDocument();
  });
});

describe('SigninPage: the way into the backup sign-in', () => {
  it('carries the recovery link next to the sign-up one', () => {
    render(
      <MemoryRouter>
        <SigninPage />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('ui-page')).toHaveTextContent(tr('auth.signin.title'));
    expect(
      screen.getByRole('button', { name: tr('auth.signin.recoveryLink') }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: tr('auth.signin.signupLink') })).toBeInTheDocument();
  });
});
