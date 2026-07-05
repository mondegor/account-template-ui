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

beforeAll(() => {
  setLanguage('ru');
  initI18n();
});

describe('FormRenderer (zod из validation + маппинг ошибок)', () => {
  it('пустое обязательное поле → ошибка required (из common.validation)', async () => {
    setup();
    fireEvent.click(screen.getByTestId('ui-button'));
    expect(await screen.findByText('Обязательное поле')).toBeInTheDocument();
  });

  it('невалидный email → ошибка формата', async () => {
    setup();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'not-an-email-x' } });
    fireEvent.click(screen.getByTestId('ui-button'));
    expect(await screen.findByText('Введите корректный email')).toBeInTheDocument();
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
});
