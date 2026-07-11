import { StrictMode, useState } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { FormProvider, useForm } from 'react-hook-form';
import { initI18n, setLanguage } from '@core/i18n';
import { ApiFieldError } from '@core/api';
import { FormErrorContext } from '@core/renderer';
import type { SchemaNode } from '@core/schema';
import { authTranslations } from '../i18n';
import { resetEmailAvailabilityCache } from '../lib/emailAvailability';
import { EmailFieldNode } from './EmailFieldNode';

// Живая проверка дёргает check-login — мокаем ручку, i18n-ветку auth подключаем напрямую.
vi.mock('../api/authApi', () => ({ checkLogin: vi.fn() }));
import { checkLogin } from '../api/authApi';

const node: SchemaNode = {
  type: 'auth.emailField',
  name: 'user_email',
  label: 'auth.field.email',
  validation: { required: true, min: 7, max: 64, format: 'email' },
};

// Форменную ошибку эмулируем кнопкой «cause-error» (как сабмит-блок), clear() — как onChange поля.
function Harness() {
  const form = useForm({ defaultValues: { user_email: '' } });
  const [hasError, setHasError] = useState(false);
  return (
    <FormProvider {...form}>
      <FormErrorContext.Provider value={{ hasError, clear: () => setHasError(false) }}>
        <EmailFieldNode node={node} />
        <button type="button" onClick={() => setHasError(true)}>
          cause-error
        </button>
      </FormErrorContext.Provider>
    </FormProvider>
  );
}

beforeAll(() => {
  setLanguage('ru');
  const i18n = initI18n();
  for (const [lng, res] of Object.entries(authTranslations)) {
    i18n.addResourceBundle(lng, 'translation', res, true, true);
  }
});

// Кэш исходов — общий на сессию; между тестами чистим, чтобы каждый прогонял реальный async-путь.
beforeEach(resetEmailAvailabilityCache);

describe('EmailFieldNode (живая проверка доступности)', () => {
  it('валидный свободный email → «Email свободен»', async () => {
    vi.mocked(checkLogin).mockResolvedValueOnce(true);
    render(<Harness />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'user@example.com' } });
    expect(await screen.findByText('Email свободен', {}, { timeout: 2000 })).toBeInTheDocument();
    expect(checkLogin).toHaveBeenCalledWith('user@example.com');
  });

  it('занятый email (ApiFieldError) → текст ошибки под полем', async () => {
    vi.mocked(checkLogin).mockRejectedValueOnce(
      new ApiFieldError([{ code: 'user_email', detail: 'Этот email уже зарегистрирован' }], 400),
    );
    render(<Harness />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'taken@example.com' } });
    expect(
      await screen.findByText('Этот email уже зарегистрирован', {}, { timeout: 2000 }),
    ).toBeInTheDocument();
  });

  it('форменная ошибка гасит зелёное; правка поля убирает алерт и возвращает зелёное', async () => {
    vi.mocked(checkLogin).mockResolvedValue(true);
    render(<Harness />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'user@example.com' } });
    expect(await screen.findByText('Email свободен', {}, { timeout: 2000 })).toBeInTheDocument();
    // Возникла форменная ошибка (сабмит-блок) — зелёное гаснет без правки поля.
    fireEvent.click(screen.getByText('cause-error'));
    expect(screen.queryByText('Email свободен')).not.toBeInTheDocument();
    // Правка поля вызывает clear() (алерт снят) → на новом свободном значении зелёное вернулось.
    fireEvent.change(input, { target: { value: 'user2@example.com' } });
    expect(await screen.findByText('Email свободен', {}, { timeout: 2000 })).toBeInTheDocument();
  });

  it('под StrictMode свежая проверка резолвится (mount→unmount→remount не глушит результат)', async () => {
    vi.mocked(checkLogin).mockResolvedValueOnce(true);
    render(
      <StrictMode>
        <Harness />
      </StrictMode>,
    );
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'user@example.com' } });
    expect(await screen.findByText('Email свободен', {}, { timeout: 2000 })).toBeInTheDocument();
  });

  it('невалидный формат → check-login не дёргаем', async () => {
    vi.mocked(checkLogin).mockClear();
    render(<Harness />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'not-an-email' } });
    await new Promise((r) => setTimeout(r, 900));
    expect(checkLogin).not.toHaveBeenCalled();
  });
});
