import { beforeAll, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient } from '@tanstack/react-query';
import { config } from '@config';
import { initI18n, setLanguage } from '@core/i18n';
import { registerBaseComponents } from '@core/renderer';
import { registerModule } from '@core/module-registry';
import { realmProvider } from '@core/auth';
import { contractRegistry } from '@core/contracts';
import { authModule } from '../module';
import { SignupPage } from './SignupPage';
import { tr } from '../../../test/i18n';

/**
 * Сквозная проверка schema-driven обвязки в процессе: реальная регистрация модуля через реестр
 * (schema auth.signup валидируется/грузится, переводы auth подключены, обработчики — onInit) →
 * SignupPage рендерит форму из JSON. Правка signup.json меняет эту страницу без правок React.
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

describe('SignupPage (schema-driven)', () => {
  it('renders the auth.signup schema: the heading, the email field and submit', () => {
    render(
      <MemoryRouter>
        <SignupPage />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('ui-page')).toHaveTextContent(tr('auth.signup.title'));
    expect(screen.getByRole('textbox')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: tr('auth.signup.submit') })).toBeInTheDocument();
  });

  /** Что вводить, сказано подзаголовком; полю остаётся имя, но не видимая подпись. */
  it('gives the lone field a name without showing a label', () => {
    render(
      <MemoryRouter>
        <SignupPage />
      </MemoryRouter>,
    );

    expect(screen.queryByText(tr('auth.field.email'))).not.toBeInTheDocument();
    expect(screen.getByLabelText(tr('auth.field.email'))).toBe(screen.getByRole('textbox'));
  });

  /**
   * Оговорка про условия относится к кнопке и стоит сразу за ней; ссылка на вход — выход с экрана
   * и потому замыкает карточку. Порядок задан разметкой страницы и без этой проверки съедет молча.
   */
  it('puts the terms note right after the form, above the way to sign in', () => {
    const { container } = render(
      <MemoryRouter>
        <SignupPage />
      </MemoryRouter>,
    );

    const card = container.textContent ?? '';
    expect(card).toContain(tr('auth.signup.terms.before'));
    expect(card.indexOf(tr('auth.signup.terms.before'))).toBeLessThan(
      card.indexOf(tr('auth.signup.haveAccount')),
    );
    // В схеме оговорки нет: страница дорисовывает её сама.
    expect(screen.getByTestId('ui-page')).not.toHaveTextContent(tr('auth.signup.terms.before'));
  });

  /**
   * Фраза собрана из трёх ключей вокруг ссылки, и склейка — то место, где легко потерять пробел
   * или получить разрыв строки посреди предложения.
   */
  it('reads as one sentence with the terms link inside it', () => {
    const { container } = render(
      <MemoryRouter>
        <SignupPage />
      </MemoryRouter>,
    );

    expect(container.textContent).toContain(
      `${tr('auth.signup.terms.before')} ${tr('auth.signup.terms.link')}${tr('auth.signup.terms.after')}`,
    );
  });

  /** Адрес условий принадлежит деплою: экран берёт его из конфига и никуда не ведёт сам. */
  it('sends the terms link to the address from the config', () => {
    render(
      <MemoryRouter>
        <SignupPage />
      </MemoryRouter>,
    );

    const link = screen.getByRole('link', { name: tr('auth.signup.terms.link') });
    expect(link).toHaveAttribute('href', config.termsUrl);
    // Уводить со страницы нельзя — набранный емаил остаётся в форме.
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('shows the format example inside the field', () => {
    render(
      <MemoryRouter>
        <SignupPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole('textbox')).toHaveAttribute(
      'placeholder',
      tr('auth.field.emailFormat'),
    );
  });
});
