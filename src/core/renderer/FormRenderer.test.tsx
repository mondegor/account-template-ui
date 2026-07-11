import { beforeAll, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { initI18n, setLanguage } from '@core/i18n';
import { ApiFieldError, ApiProblemError } from '@core/api';
import {
  registerHandler,
  resetComponents,
  resetHandlers,
  type HandlerEntry,
  type SchemaNode,
} from '@core/schema';
import { registerBaseComponents } from './baseNodes';
import { SchemaRenderer } from './SchemaRenderer';

const emailSchema: SchemaNode = {
  id: 'test.form',
  type: 'page',
  children: [
    {
      type: 'form',
      submitOnly: true,
      submit: { label: 'auth.signup.submit' },
      children: [
        {
          type: 'field.email',
          name: 'user_email',
          label: 'auth.field.email',
          validation: { required: true, min: 7, max: 64, format: 'email' },
        },
      ],
    },
  ],
};

function setup(handler?: HandlerEntry) {
  resetComponents();
  registerBaseComponents();
  resetHandlers();
  if (handler) registerHandler('test.form', handler);
  return render(
    <MemoryRouter>
      <SchemaRenderer schema={emailSchema} />
    </MemoryRouter>,
  );
}

// Схема с password-полем: проверяем, что серверная ошибка поля переживает очистку пароля в finally.
const passwordSchema: SchemaNode = {
  id: 'test.pwform',
  type: 'page',
  children: [
    {
      type: 'form',
      submit: { label: 'auth.signup.submit' },
      children: [
        {
          type: 'field.password',
          name: 'user_password',
          label: 'auth.field.code',
          validation: { required: true, min: 1, max: 64 },
        },
      ],
    },
  ],
};

function setupPassword(handler: HandlerEntry) {
  resetComponents();
  registerBaseComponents();
  resetHandlers();
  registerHandler('test.pwform', handler);
  return render(
    <MemoryRouter>
      <SchemaRenderer schema={passwordSchema} />
    </MemoryRouter>,
  );
}

beforeAll(() => {
  setLanguage('ru');
  initI18n();
});

describe('FormRenderer (zod из validation + маппинг ошибок)', () => {
  it('пустое обязательное поле → кнопка отключена, ошибки required нет', () => {
    setup();
    expect(screen.getByTestId('ui-button')).toBeDisabled();
    fireEvent.click(screen.getByTestId('ui-button'));
    expect(screen.queryByText('Обязательное поле')).not.toBeInTheDocument();
  });

  it('заполненное поле активирует кнопку отправки', () => {
    setup();
    expect(screen.getByTestId('ui-button')).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'user@example.com' } });
    expect(screen.getByTestId('ui-button')).not.toBeDisabled();
  });

  it('до сабмита ошибок нет: фокус/blur/ввод не подсвечивают поле', async () => {
    setup();
    const input = screen.getByRole('textbox');
    // Автофокус + уход с пустого поля — не должно быть «required».
    fireEvent.focus(input);
    fireEvent.blur(input);
    // Ввод кривого email — не должно быть ошибки формата до сабмита.
    fireEvent.change(input, { target: { value: 'not-an-email-x' } });
    expect(screen.queryByText('Обязательное поле')).not.toBeInTheDocument();
    expect(screen.queryByText('Введите корректный email')).not.toBeInTheDocument();
    // Ошибка появляется только по нажатию кнопки.
    fireEvent.click(screen.getByTestId('ui-button'));
    expect(await screen.findByText('Введите корректный email')).toBeInTheDocument();
  });

  it('невалидный email → ошибка формата', async () => {
    setup();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'not-an-email-x' } });
    fireEvent.click(screen.getByTestId('ui-button'));
    expect(await screen.findByText('Введите корректный email')).toBeInTheDocument();
  });

  it('показанная ошибка держится при фокусе, гаснет при вводе/стирании', async () => {
    setup();
    const input = screen.getByRole('textbox');
    // Непустое невалидное значение → кнопка активна, сабмит показывает формат-ошибку.
    fireEvent.change(input, { target: { value: 'not-an-email-x' } });
    fireEvent.click(screen.getByTestId('ui-button'));
    expect(await screen.findByText('Введите корректный email')).toBeInTheDocument();
    // Фокус сам по себе ошибку НЕ снимает.
    fireEvent.focus(input);
    expect(screen.getByText('Введите корректный email')).toBeInTheDocument();
    // Редактирование (ввод/стирание) — снимает.
    fireEvent.change(input, { target: { value: 'not-an-email-' } });
    expect(screen.queryByText('Введите корректный email')).not.toBeInTheDocument();
  });

  it('ApiFieldError с известным полем → setError под поле', async () => {
    setup({
      handler: async () => {
        throw new ApiFieldError([{ code: 'user_email', detail: 'Этот email занят' }], 400);
      },
    });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'user@example.com' } });
    fireEvent.click(screen.getByTestId('ui-button'));
    expect(await screen.findByText('Этот email занят')).toBeInTheDocument();
  });

  it('ApiProblemError → форменный алерт (глобальное уведомление)', async () => {
    setup({
      handler: async () => {
        throw new ApiProblemError({
          title: 'Forbidden',
          status: 403,
          detail: 'Нет доступа',
          instance: '',
          time: '',
        });
      },
    });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'user@example.com' } });
    fireEvent.click(screen.getByTestId('ui-button'));
    expect(await screen.findByTestId('ui-alert')).toHaveTextContent('Нет доступа');
  });

  it('регресс: ApiFieldError на password-поле держится, значение поля очищается', async () => {
    const { container } = setupPassword({
      handler: async () => {
        throw new ApiFieldError([{ code: 'user_password', detail: 'Неверный пароль' }], 400);
      },
    });
    const input = container.querySelector<HTMLInputElement>('input[name="user_password"]')!;
    fireEvent.change(input, { target: { value: 'secret123' } });
    fireEvent.click(screen.getByTestId('ui-button'));
    // Серверная ошибка поля показывается и НЕ затирается resetField({ keepError }) в finally.
    expect(await screen.findByText('Неверный пароль')).toBeInTheDocument();
    // При этом сам пароль очищен — секрет не остаётся в стейте формы.
    expect(input.value).toBe('');
  });
});
