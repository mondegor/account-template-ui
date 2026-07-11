import { beforeAll, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient } from '@tanstack/react-query';
import { initI18n, setLanguage } from '@core/i18n';
import { registerBaseComponents } from '@core/renderer';
import { registerModule } from '@core/module-registry';
import { realmProvider } from '@core/auth';
import { contractRegistry } from '@core/contracts';
import { authModule } from '../module';
import { SignupPage } from './SignupPage';

/**
 * Сквозная проверка schema-driven обвязки в процессе: реальная регистрация модуля через реестр
 * (schema auth.signup валидируется/грузится, переводы auth подключены, обработчики — onInit) →
 * SignupPage рендерит форму из JSON. Правка signup.json меняет эту страницу без правок React.
 */
beforeAll(() => {
  setLanguage('ru');
  initI18n();
  registerBaseComponents();
  registerModule(authModule, {
    queryClient: new QueryClient(),
    contracts: contractRegistry,
    realmProvider,
  });
});

describe('SignupPage (schema-driven)', () => {
  it('рендерит схему auth.signup: заголовок, email-поле и submit', () => {
    render(
      <MemoryRouter>
        <SignupPage />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('ui-page')).toHaveTextContent('Создание аккаунта');
    expect(screen.getByRole('textbox')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Зарегистрироваться' })).toBeInTheDocument();
  });
});
