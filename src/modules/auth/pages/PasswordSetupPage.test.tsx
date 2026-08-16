import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { addTranslations, initI18n, setLanguage } from '@core/i18n';
import { ApiFieldError, ApiProblemError } from '@core/api';
import { useOperationStore } from '@core/operation';
import { useAuthStore } from '@core/auth';
import { tr } from '../../../test/i18n';
import { authTranslations } from '../i18n';
import { calcPasswordStrength, generatePassword, startPasswordSetup } from '../api/authApi';
import { loadSecurityFlow } from '../lib/securityFlow';
import type { WaitingConfirmOperation } from '../api/types';
import { PasswordSetupPage } from './PasswordSetupPage';

/**
 * Форма установки пароля: ворота по оценке сервера, помощь с генерацией и копированием и разбор
 * отказов инициатора. Оценку и генерацию мокаем — что и как считает сервер, решает развёртывание.
 */

vi.mock('../api/authApi', () => ({
  calcPasswordStrength: vi.fn(),
  generatePassword: vi.fn(),
  startPasswordSetup: vi.fn(),
}));

/** Значения, которые придумал сам тест, — английские литералы. */
const STRONG = 'L$QI.qA6eu7zG%7w';
const WEAK = 'password12';
const GENERATED = 'Xy7#kQ2mZp4!Rt9W';
const REJECTED = 'Password does not meet the security requirements';

/** Тело problem+json — фикстура теста; статус в нём и есть то, по чему форма выбирает ветку. */
const problem = (status: number, detail: string) =>
  new ApiProblemError({ title: 'Error', status, detail, instance: '', time: '' });

const OPERATION: WaitingConfirmOperation = {
  token: 't'.repeat(64),
  confirm_method: 'EMAIL',
  remaining_attempts: 3,
  remaining_resends: 1,
  resends_in: 0,
  expires_in: 600,
};

function LocationProbe() {
  return <div data-testid="loc">{useLocation().pathname}</div>;
}

function renderPage() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={['/security/password']}>
        <Routes>
          <Route path="/security/password" element={<PasswordSetupPage />} />
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const submitButton = () => screen.getByRole('button', { name: tr('auth.password.submit') });

/**
 * Проматывает паузу в наборе и ответ оценки. Внутри act: и таймер, и разрешение промиса меняют
 * состояние компонента, а вне act это состояние до разметки не доехало бы.
 */
async function settle() {
  await act(async () => {
    await vi.runAllTimersAsync();
  });
}

/** Заполняет оба поля и ждёт, пока приедет оценка: без неё ворота заперты. */
async function fill(password: string, repeat = password) {
  fireEvent.change(screen.getByTestId('field-new_password'), { target: { value: password } });
  fireEvent.change(screen.getByTestId('field-repeat_password'), { target: { value: repeat } });
  await settle();
}

beforeAll(() => {
  setLanguage('en');
  initI18n();
  // Без словаря модуля tr() вернул бы сам ключ, и он же стоял бы на экране: проверка сравнивала
  // бы ключ с ключом и зеленела при любом тексте.
  addTranslations(authTranslations);
});

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  sessionStorage.clear();
  useOperationStore.getState().reset();
  useAuthStore.setState({ status: 'authenticated' });
  vi.mocked(calcPasswordStrength).mockResolvedValue('THE_BEST');
  vi.mocked(generatePassword).mockResolvedValue(GENERATED);
  vi.mocked(startPasswordSetup).mockResolvedValue(OPERATION);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn(() => Promise.resolve()) },
  });
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe('PasswordSetupPage', () => {
  /**
   * Заголовков на экране два, и говорят они разное: наружный называет раздел, тот же на всех
   * экранах защиты, шапка карточки — поток. Подменить друг друга они не могут.
   */
  it('names the section outside the card and the flow inside it', () => {
    renderPage();

    expect(screen.getByRole('heading', { name: tr('auth.twoFa.title') })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: tr('auth.password.title') })).toBeInTheDocument();
  });

  /**
   * У метода свои границы, и на коротком значении он отвечает 400 — попытка ушла бы впустую.
   * Вместо оценки под полем стоит подсказка о границах.
   */
  it('does not ask for a rating below the minimum length', async () => {
    renderPage();

    await fill('abcde');

    expect(calcPasswordStrength).not.toHaveBeenCalled();
    expect(
      screen.getByText(tr('auth.password.lengthHint', { min: 8, max: 32 })),
    ).toBeInTheDocument();
    expect(submitButton()).toBeDisabled();
  });

  /**
   * Границы поля нужны и тогда, когда набранное до минимума доросло: ошибиться длиной проще всего
   * в наборе, а обрезает лишнее поле молча. Шкала встаёт над подсказкой, а не вместо неё.
   */
  it('keeps the length hint next to the rating', async () => {
    vi.mocked(calcPasswordStrength).mockResolvedValue('MIDDLE');
    renderPage();

    await fill(STRONG);

    expect(screen.getByText(tr('auth.password.strength.MIDDLE'))).toBeInTheDocument();
    expect(
      screen.getByText(tr('auth.password.lengthHint', { min: 8, max: 32 })),
    ).toBeInTheDocument();
  });

  /** Ворота стоят на оценке: слабый пароль вторым фактором не защищает. */
  it('keeps the gate shut on a weak password', async () => {
    vi.mocked(calcPasswordStrength).mockResolvedValue('WEAK');
    renderPage();

    await fill(WEAK);

    expect(screen.getByText(tr('auth.password.strength.WEAK'))).toBeInTheDocument();
    expect(submitButton()).toBeDisabled();
  });

  /** С проходной оценки форма пропускает. */
  it('opens the gate from the passing strength up', async () => {
    vi.mocked(calcPasswordStrength).mockResolvedValue('MIDDLE');
    renderPage();

    await fill(STRONG);

    expect(screen.getByText(tr('auth.password.strength.MIDDLE'))).toBeInTheDocument();
    expect(submitButton()).toBeEnabled();
  });

  /**
   * Ответ применяется только к тому значению, ради которого его спрашивали: пока первый был в пути,
   * набрали другое, и его оценка обязана победить.
   */
  it('applies the rating of the last typed value', async () => {
    vi.mocked(calcPasswordStrength).mockImplementation((password) =>
      Promise.resolve(password === STRONG ? 'THE_BEST' : 'WEAK'),
    );
    renderPage();

    await fill(WEAK);
    await fill(STRONG);

    expect(screen.getByText(tr('auth.password.strength.THE_BEST'))).toBeInTheDocument();
    expect(screen.queryByText(tr('auth.password.strength.WEAK'))).not.toBeInTheDocument();
  });

  /**
   * Оценку получить не удалось — шкала остаётся на месте пустой, а рядом встаёт повтор: убери её,
   * и форма стояла бы заблокированной без единого следа причины.
   */
  it('keeps the empty scale and offers a retry when the rating fails', async () => {
    vi.mocked(calcPasswordStrength).mockRejectedValue(
      problem(500, 'The strength service is unavailable'),
    );
    renderPage();

    await fill(STRONG);
    expect(screen.getByText(tr('auth.password.unknown'))).toBeInTheDocument();
    expect(screen.getByTestId('strength-bars')).toBeInTheDocument();
    expect(submitButton()).toBeDisabled();

    vi.mocked(calcPasswordStrength).mockResolvedValue('STRONG');
    fireEvent.click(screen.getByRole('button', { name: tr('auth.password.retry') }));
    await settle();

    expect(screen.getByText(tr('auth.password.strength.STRONG'))).toBeInTheDocument();
    expect(submitButton()).toBeEnabled();
  });

  /**
   * Пауза отделяет набор от запроса, а нажатую кнопку отделять не от чего: с паузой повтор почти
   * секунду выглядел бы несработавшим. Таймеры тут не проматываются — в этом и проверка.
   */
  it('sends the retry without waiting out the typing pause', async () => {
    vi.mocked(calcPasswordStrength).mockRejectedValue(problem(500, 'Service error'));
    renderPage();

    await fill(STRONG);
    vi.mocked(calcPasswordStrength).mockClear().mockResolvedValue('STRONG');
    fireEvent.click(screen.getByRole('button', { name: tr('auth.password.retry') }));
    await act(async () => {
      vi.advanceTimersByTime(0);
    });

    expect(calcPasswordStrength).toHaveBeenCalledWith(STRONG);
    expect(screen.getByText(tr('auth.password.strength.STRONG'))).toBeInTheDocument();
  });

  /**
   * Генерация заполняет только само поле и оставляет значение скрытым: его копируют, а не читают
   * глазами. Повтор остаётся пустым и держит ворота закрытыми — вынести пароль наружу и вернуть
   * обратно обязан человек, иначе повтор не проверяет ничего.
   */
  it('fills only the password field and leaves the repeat to the person', async () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: tr('auth.password.generate') }));
    await settle();

    expect(screen.getByTestId('field-new_password')).toHaveValue(GENERATED);
    expect(screen.getByTestId('field-repeat_password')).toHaveValue('');
    expect(screen.getByTestId('field-new_password')).toHaveAttribute('type', 'password');
    expect(submitButton()).toBeDisabled();

    fireEvent.change(screen.getByTestId('field-repeat_password'), {
      target: { value: GENERATED },
    });
    await settle();

    expect(submitButton()).toBeEnabled();
  });

  /**
   * Сгенерированное значение выдал сам сервер — спрашивать его же, надёжно ли оно, незачем: оценка
   * ставится без запроса и открывает ворота.
   */
  it('rates the generated password without asking for it', async () => {
    renderPage();
    // Счётчик обнуляется здесь: моки живут дольше одного теста, и без этого проверка считала бы
    // чужие вызовы.
    vi.mocked(calcPasswordStrength).mockClear();

    fireEvent.click(screen.getByRole('button', { name: tr('auth.password.generate') }));
    await settle();

    expect(calcPasswordStrength).not.toHaveBeenCalled();
    expect(screen.getByText(tr('auth.password.strength.THE_BEST'))).toBeInTheDocument();
    expect(screen.queryByText(tr('auth.password.checking'))).not.toBeInTheDocument();
  });

  /**
   * Оценка держится за то значение, ради которого её назвали: правка уводит от него, и набранное
   * руками спрашивают у сервера, как и всё остальное.
   */
  it('asks the server again once the generated value is edited', async () => {
    vi.mocked(calcPasswordStrength).mockResolvedValue('WEAK');
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: tr('auth.password.generate') }));
    await settle();

    fireEvent.change(screen.getByTestId('field-new_password'), { target: { value: WEAK } });
    await settle();

    expect(calcPasswordStrength).toHaveBeenCalledWith(WEAK);
    expect(screen.getByText(tr('auth.password.strength.WEAK'))).toBeInTheDocument();
  });

  /** Повтор, набранный до генерации, был про прежний пароль — новое значение уносит и его. */
  it('clears a repeat left over from the previous password', async () => {
    renderPage();

    await fill(STRONG);
    fireEvent.click(screen.getByRole('button', { name: tr('auth.password.generate') }));
    await settle();

    expect(screen.getByTestId('field-repeat_password')).toHaveValue('');
    expect(screen.queryByText(tr('auth.password.mismatch'))).not.toBeInTheDocument();
  });

  /** Сорвавшаяся генерация тоже отвечает: кнопка, ответившая ничем, неотличима от неработающей. */
  it('says out loud that the generation failed', async () => {
    vi.mocked(generatePassword).mockRejectedValue(problem(500, 'Service error'));
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: tr('auth.password.generate') }));
    await settle();

    expect(screen.getByText(tr('auth.password.generateFailed'))).toBeInTheDocument();
    expect(screen.getByTestId('field-new_password')).toHaveValue('');
  });

  /**
   * Пока генерация в пути, поле остаётся живым: набранное в нём — это отказ от помощи, и пришедшее
   * следом сгенерированное значение затёрло бы его молча.
   */
  it('lets typing cancel a generation that has not arrived yet', async () => {
    let arrive!: (password: string) => void;
    vi.mocked(generatePassword).mockReturnValue(
      new Promise<string>((resolve) => {
        arrive = resolve;
      }),
    );
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: tr('auth.password.generate') }));
    fireEvent.change(screen.getByTestId('field-new_password'), { target: { value: STRONG } });
    await act(async () => {
      arrive(GENERATED);
    });
    await settle();

    expect(screen.getByTestId('field-new_password')).toHaveValue(STRONG);
  });

  /** Копировать пустое поле нечего: знак ждёт значения, а не нажатия. */
  it('keeps the copy shut until there is something to copy', async () => {
    renderPage();
    const copyButton = () => screen.getByRole('button', { name: tr('auth.password.copy') });

    expect(copyButton()).toBeDisabled();

    await fill(STRONG);
    expect(copyButton()).toBeEnabled();
  });

  /** Копирование обязано ответить: молча сработавшая кнопка неотличима от несработавшей. */
  it('answers the copy with a changed label', async () => {
    renderPage();

    await fill(STRONG);
    fireEvent.click(screen.getByRole('button', { name: tr('auth.password.copy') }));

    expect(
      await screen.findByRole('button', { name: tr('auth.password.copied') }),
    ).toBeInTheDocument();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(STRONG);
  });

  /**
   * Галочка отвечает на нажатие и гаснет сама: что лежит в буфере дальше, странице не видно, и
   * оставшаяся стоять галочка утверждала бы о нём то, чего не знает.
   */
  it('takes the copied mark back after the hold', async () => {
    renderPage();

    await fill(STRONG);
    fireEvent.click(screen.getByRole('button', { name: tr('auth.password.copy') }));
    expect(
      await screen.findByRole('button', { name: tr('auth.password.copied') }),
    ).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(3000);
    });

    expect(screen.getByRole('button', { name: tr('auth.password.copy') })).toBeInTheDocument();
  });

  /** Сорвавшееся копирование снимает галочку: удачным было прошлое копирование, а не это. */
  it('takes the copied mark back when the next copy fails', async () => {
    renderPage();

    await fill(STRONG);
    fireEvent.click(screen.getByRole('button', { name: tr('auth.password.copy') }));
    expect(
      await screen.findByRole('button', { name: tr('auth.password.copied') }),
    ).toBeInTheDocument();

    vi.mocked(navigator.clipboard.writeText).mockRejectedValue(new Error('Clipboard unavailable'));
    fireEvent.click(screen.getByRole('button', { name: tr('auth.password.copied') }));

    expect(await screen.findByText(tr('auth.password.copyFailed'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: tr('auth.password.copy') })).toBeInTheDocument();
  });

  /** Повтор ловит опечатку вслепую: расходятся — дальше не пускаем. */
  it('blocks a mismatching repeat', async () => {
    renderPage();

    await fill(STRONG, 'L$QI.qA6eu7zG');

    expect(screen.getByText(tr('auth.password.mismatch'))).toBeInTheDocument();
    expect(submitButton()).toBeDisabled();
  });

  /** Успешный старт кладёт снимок операции и запись потока и уводит на подтверждение. */
  it('starts the flow and goes to the confirmation', async () => {
    renderPage();

    await fill(STRONG);
    fireEvent.click(submitButton());

    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/security/confirm'));
    expect(startPasswordSetup).toHaveBeenCalledWith({ new_password: STRONG });
    expect(useOperationStore.getState().snapshot?.token).toBe(OPERATION.token);
    expect(loadSecurityFlow()?.kind).toBe('password');
  });

  /** Отказ по полю садится под поле: исправлять нужно именно набранное. */
  it('puts the field rejection under the field', async () => {
    vi.mocked(startPasswordSetup).mockRejectedValue(
      new ApiFieldError([{ code: 'ValidateError/new_password', detail: REJECTED }], 400),
    );
    renderPage();

    await fill(STRONG);
    fireEvent.click(submitButton());

    const message = await screen.findByText(REJECTED);
    // Поле помечено и связано со строками под ним: иначе диктору досталось бы «неверно» без
    // причины. Описаний два — границы поля и сам отказ, — и читаются они в том же порядке, в каком
    // стоят на экране.
    const field = screen.getByTestId('field-new_password');
    expect(field).toHaveAttribute('aria-invalid', 'true');
    const [hint, rejection] = (field.getAttribute('aria-describedby') ?? '')
      .split(' ')
      .map((id) => document.getElementById(id));
    expect(hint).toHaveTextContent(tr('auth.password.lengthHint', { min: 8, max: 32 }));
    expect(rejection).toContainElement(message);
  });

  /**
   * Генерация меняет значение так же, как набор руками, — и отказ, полученный на прежнее, обязан
   * уйти вместе с ним: иначе он висит над паролем, о котором сервер ничего не говорил.
   */
  it('takes the rejection away together with the value it was about', async () => {
    vi.mocked(startPasswordSetup).mockRejectedValue(
      new ApiFieldError([{ code: 'ValidateError/new_password', detail: REJECTED }], 400),
    );
    renderPage();

    await fill(STRONG);
    fireEvent.click(submitButton());
    expect(await screen.findByText(REJECTED)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: tr('auth.password.generate') }));
    await settle();

    expect(screen.getByTestId('field-new_password')).toHaveValue(GENERATED);
    expect(screen.queryByText(REJECTED)).not.toBeInTheDocument();
    // Метка снимается вместе со строкой: красное поле звало бы исправлять то, чего в нём уже нет.
    expect(screen.getByTestId('field-new_password')).toHaveAttribute('aria-invalid', 'false');
  });

  /**
   * 409 — не отказ по значению, а состояние аккаунта: второй фактор уже стоит. Форма тут не
   * поможет, поэтому её место занимает дорога туда, где фактор отключают.
   */
  it('replaces the form with a way out on a conflict', async () => {
    vi.mocked(startPasswordSetup).mockRejectedValue(problem(409, '2FA is already on'));
    renderPage();

    await fill(STRONG);
    fireEvent.click(submitButton());

    const conflict = await screen.findByText(tr('auth.password.conflict'), { exact: false });
    expect(
      within(conflict).getByRole('link', { name: tr('auth.password.conflictLink') }),
    ).toHaveAttribute('href', '/settings');
    expect(screen.queryByTestId('field-new_password')).not.toBeInTheDocument();
  });
});
