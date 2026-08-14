import { beforeAll, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { initI18n, setLanguage } from '@core/i18n';
import { ApiFieldError, ApiProblemError, ApiRateLimitError } from '@core/api';
import {
  registerHandler,
  resetComponents,
  resetHandlers,
  type HandlerEntry,
  type SchemaNode,
} from '@core/schema';
import { tr } from '../../test/i18n';
import { registerBaseComponents } from './baseNodes';
import { SchemaRenderer } from './SchemaRenderer';

/** Detail от серверной стороны: свой текст, не из переводов, — форма показывает его как есть. */
const EMAIL_TAKEN_DETAIL = 'Email already registered';
const WRONG_PASSWORD_DETAIL = 'Wrong password';

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

// Форма из двух полей: там форменной ошибке место наверху, отдельным алертом. Под полем её было бы
// не отличить от ошибки этого самого поля, а полей больше одного.
const pairSchema: SchemaNode = {
  id: 'test.pairform',
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
        {
          type: 'field.text',
          name: 'user_login',
          label: 'auth.field.login',
          validation: { required: true, min: 7, max: 64 },
        },
      ],
    },
  ],
};

function setupPair(handler: HandlerEntry) {
  resetComponents();
  registerBaseComponents();
  resetHandlers();
  registerHandler('test.pairform', handler);
  return render(
    <MemoryRouter>
      <SchemaRenderer schema={pairSchema} />
    </MemoryRouter>,
  );
}

beforeAll(() => {
  setLanguage('en');
  initI18n();
});

describe('FormRenderer (zod built from validation, plus error mapping)', () => {
  /**
   * Пока сказать нечего, строки под полем нет вовсе — зазор между полем и кнопкой не занят пустым
   * местом. Она появляется с сообщением и уходит вместе с ним.
   */
  it('reserves no room under the lone field until there is something to say', async () => {
    const { container } = setup({ handler: async () => {} });
    const helper = () => container.querySelector('.MuiFormHelperText-root');
    expect(helper()).toBeNull();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'not-an-email' } });
    fireEvent.click(screen.getByTestId('ui-button'));
    expect(await screen.findByText(tr('common.validation.email'))).toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'user@example.com' } });
    expect(screen.getByRole('textbox')).not.toHaveAttribute('aria-invalid', 'true');
    // Строка уезжает вместе со своей высотой, поэтому уходит из разметки не в тот же кадр, что
    // ошибка из состояния формы.
    await waitFor(() => {
      expect(screen.queryByText(tr('common.validation.email'))).not.toBeInTheDocument();
    });
    expect(helper()).toBeNull();
  });

  it('an empty required field disables the button and shows no required error', () => {
    setup();
    expect(screen.getByTestId('ui-button')).toBeDisabled();
    fireEvent.click(screen.getByTestId('ui-button'));
    expect(screen.queryByText(tr('common.validation.required'))).not.toBeInTheDocument();
  });

  it('a filled field enables the submit button', () => {
    setup();
    expect(screen.getByTestId('ui-button')).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'user@example.com' } });
    expect(screen.getByTestId('ui-button')).not.toBeDisabled();
  });

  /**
   * Недобранная длина — незаконченный ввод, а не отказ: про него говорит погашенная кнопка, и под
   * полем не написано ничего. Схема поля здесь несёт min 7.
   */
  it('a value below the minimum keeps the button disabled and says nothing', () => {
    const { container } = setup();
    const input = screen.getByRole('textbox');

    fireEvent.change(input, { target: { value: 'fff' } });
    expect(screen.getByTestId('ui-button')).toBeDisabled();
    fireEvent.click(screen.getByTestId('ui-button'));
    expect(container.querySelector('.MuiFormHelperText-root')).toBeNull();

    fireEvent.change(input, { target: { value: 'user@example.com' } });
    expect(screen.getByTestId('ui-button')).not.toBeDisabled();
  });

  /** Гейт закрывает длину, а не проверку значения: набранное, но не email, по-прежнему отвергается. */
  it('a long enough value still goes through the format check', async () => {
    setup();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'fffffff' } });
    expect(screen.getByTestId('ui-button')).not.toBeDisabled();
    fireEvent.click(screen.getByTestId('ui-button'));

    expect(await screen.findByText(tr('common.validation.email'))).toBeInTheDocument();
  });

  it('no errors before submit: focus, blur and typing do not highlight the field', async () => {
    setup();
    const input = screen.getByRole('textbox');
    // Автофокус + уход с пустого поля — не должно быть «required».
    fireEvent.focus(input);
    fireEvent.blur(input);
    // Ввод кривого email — не должно быть ошибки формата до сабмита.
    fireEvent.change(input, { target: { value: 'not-an-email-x' } });
    expect(screen.queryByText(tr('common.validation.required'))).not.toBeInTheDocument();
    expect(screen.queryByText(tr('common.validation.email'))).not.toBeInTheDocument();
    // Ошибка появляется только по нажатию кнопки.
    fireEvent.click(screen.getByTestId('ui-button'));
    expect(await screen.findByText(tr('common.validation.email'))).toBeInTheDocument();
  });

  it('an invalid email gives a format error', async () => {
    setup();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'not-an-email-x' } });
    fireEvent.click(screen.getByTestId('ui-button'));
    expect(await screen.findByText(tr('common.validation.email'))).toBeInTheDocument();
  });

  it('a shown error survives focus and clears on typing or deleting', async () => {
    setup();
    const input = screen.getByRole('textbox');
    // Непустое невалидное значение → кнопка активна, сабмит показывает формат-ошибку.
    fireEvent.change(input, { target: { value: 'not-an-email-x' } });
    fireEvent.click(screen.getByTestId('ui-button'));
    expect(await screen.findByText(tr('common.validation.email'))).toBeInTheDocument();
    // Фокус сам по себе ошибку НЕ снимает.
    fireEvent.focus(input);
    expect(screen.getByText(tr('common.validation.email'))).toBeInTheDocument();
    // Редактирование (ввод/стирание) — снимает.
    fireEvent.change(input, { target: { value: 'not-an-email-' } });
    await waitFor(() => {
      expect(screen.queryByText(tr('common.validation.email'))).not.toBeInTheDocument();
    });
  });

  it('ApiFieldError with a known field lands on that field via setError', async () => {
    setup({
      handler: async () => {
        throw new ApiFieldError(
          [{ code: 'EmailAlreadyExists/user_email', detail: EMAIL_TAKEN_DETAIL }],
          400,
        );
      },
    });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'user@example.com' } });
    fireEvent.click(screen.getByTestId('ui-button'));
    expect(await screen.findByText(EMAIL_TAKEN_DETAIL)).toBeInTheDocument();
  });

  it('ApiFieldError without a suffix (a refusal on the merits) speaks up, not silence', async () => {
    setup({
      handler: async () => {
        throw new ApiFieldError([{ code: 'ErrorCode', detail: 'Refused on the merits' }], 400);
      },
    });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'user@example.com' } });
    fireEvent.click(screen.getByTestId('ui-button'));
    expect(await screen.findByText('Refused on the merits')).toBeInTheDocument();
  });

  it('ApiFieldError without a suffix and with an empty detail falls back to a translation', async () => {
    // Сервер обязан прислать detail, но если он пуст — молчать нельзя: кнопка просто перестала бы
    // крутиться, ничего не объяснив.
    setup({
      handler: async () => {
        throw new ApiFieldError([{ code: 'ErrorCode', detail: '' }], 400);
      },
    });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'user@example.com' } });
    fireEvent.click(screen.getByTestId('ui-button'));
    expect(await screen.findByText(tr('common.error.generic'))).toBeInTheDocument();
  });

  it('ApiFieldError with a suffix of a foreign field is shown too: it belongs to no field here', async () => {
    setup({
      handler: async () => {
        throw new ApiFieldError([{ code: 'ValidateError/realm', detail: 'Realm not found' }], 400);
      },
    });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'user@example.com' } });
    fireEvent.click(screen.getByTestId('ui-button'));
    expect(await screen.findByText('Realm not found')).toBeInTheDocument();
  });

  it('ApiRateLimitError (429) carries the server detail', async () => {
    setup({
      handler: async () => {
        throw new ApiRateLimitError(
          {
            title: 'Too Many Requests',
            status: 429,
            detail: 'The request is already being processed',
            instance: '',
            time: '',
          },
          600,
        );
      },
    });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'user@example.com' } });
    fireEvent.click(screen.getByTestId('ui-button'));
    expect(await screen.findByText('The request is already being processed')).toBeInTheDocument();
  });

  /**
   * Сообщение всей формы стоит под тем же полем, что и ошибка поля, и стоять обязано так же: блок
   * поля кончается вплотную, а зазор за строкой держит она сама. Иначе строка отъезжала бы от поля
   * и подпирала кнопку. Эталон — сама раскладка: зазор под чужой строкой сверяем с тем, который
   * блок держит под своей, а не с числом.
   */
  it('a form-wide message stands where a field error stands', async () => {
    const { container } = setup({
      handler: async () => {
        throw new ApiProblemError({
          title: 'Forbidden',
          status: 403,
          detail: 'No access',
          instance: '',
          time: '',
        });
      },
    });
    // Блок поля, за ним — обёртка строки всей формы (см. FormRenderer).
    const gapOf = (n: number) =>
      parseFloat(getComputedStyle(container.querySelectorAll('form > div')[n]!).marginBottom);
    const input = screen.getByRole('textbox');

    // Своя ошибка: строку рисует блок, он же и держит зазор за ней.
    fireEvent.change(input, { target: { value: 'not-an-email' } });
    fireEvent.click(screen.getByTestId('ui-button'));
    expect(await screen.findByText(tr('common.validation.email'))).toBeInTheDocument();
    const own = gapOf(0);

    // Отказ всей форме: строка ниже блока, и зазор переехал к ней.
    fireEvent.change(input, { target: { value: 'user@example.com' } });
    fireEvent.click(screen.getByTestId('ui-button'));
    expect(await screen.findByText('No access')).toBeInTheDocument();

    expect(gapOf(0)).toBe(0);
    expect(gapOf(1)).toBe(own);
  });

  it('ApiProblemError is shown as well (a global notification)', async () => {
    setup({
      handler: async () => {
        throw new ApiProblemError({
          title: 'Forbidden',
          status: 403,
          detail: 'No access',
          instance: '',
          time: '',
        });
      },
    });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'user@example.com' } });
    fireEvent.click(screen.getByTestId('ui-button'));
    expect(await screen.findByText('No access')).toBeInTheDocument();
  });

  /**
   * Отказ всей форме объявляется, где бы он ни стоял: у одинокого поля он приходит после нажатия
   * кнопки, экран при этом не меняется ничем другим, и не объявленный он остался бы виден только
   * тому, кто на него смотрит.
   */
  it('announces the form-wide message under a lone field', async () => {
    setup({
      handler: async () => {
        throw new ApiFieldError([{ code: 'ErrorCode', detail: 'Refused on the merits' }], 400);
      },
    });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'user@example.com' } });
    fireEvent.click(screen.getByTestId('ui-button'));

    // Регион стоит на месте с первого кадра — объявляет его текст, вставленный внутрь, — поэтому
    // ждём именно текста: сам регион находится и пустым.
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Refused on the merits');
    });
  });

  /**
   * Место сообщения задаёт число полей: у одинокого оно под полем, у пары — алертом над формой.
   * Сообщение при этом одно и то же — меняется только куда его класть.
   */
  it('with two fields the form-wide message stays an alert above the form', async () => {
    setupPair({
      handler: async () => {
        throw new ApiFieldError([{ code: 'ErrorCode', detail: 'Refused on the merits' }], 400);
      },
    });
    const [email, login] = screen.getAllByRole('textbox');
    fireEvent.change(email!, { target: { value: 'user@example.com' } });
    fireEvent.change(login!, { target: { value: 'user@example.com' } });
    fireEvent.click(screen.getByTestId('ui-button'));

    expect(await screen.findByTestId('ui-alert')).toHaveTextContent('Refused on the merits');
  });

  it('an ApiFieldError on a password field survives while the field value is cleared', async () => {
    const { container } = setupPassword({
      handler: async () => {
        throw new ApiFieldError(
          [{ code: 'ValidateError/user_password', detail: WRONG_PASSWORD_DETAIL }],
          400,
        );
      },
    });
    const input = container.querySelector<HTMLInputElement>('input[name="user_password"]')!;
    fireEvent.change(input, { target: { value: 'secret123' } });
    fireEvent.click(screen.getByTestId('ui-button'));
    // Серверная ошибка поля показывается и НЕ затирается resetField({ keepError }) в finally.
    expect(await screen.findByText(WRONG_PASSWORD_DETAIL)).toBeInTheDocument();
    // При этом сам пароль очищен — секрет не остаётся в стейте формы.
    expect(input.value).toBe('');
  });
});
