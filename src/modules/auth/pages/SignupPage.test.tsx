import { beforeAll, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { initI18n, setLanguage } from '@core/i18n';
import { registerBaseComponents } from '@core/renderer';
import { registerAuthModule } from '../register';
import { SignupPage } from './SignupPage';

/**
 * Сквозная проверка schema-driven обвязки в процессе: реальная регистрация модуля (schema
 * auth.signup валидируется и грузится, переводы auth подключены) → SignupPage рендерит форму
 * из JSON. Правка signup.json меняет эту страницу без правок React.
 */
beforeAll(() => {
  setLanguage('ru');
  initI18n();
  registerBaseComponents();
  registerAuthModule();
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
