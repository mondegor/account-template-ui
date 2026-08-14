import { beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { addTranslations, initI18n, setLanguage } from '@core/i18n';
import { limits } from '@config';
import type { OperationSnapshot } from '@core/operation';
import { authTranslations } from '../i18n';
import type { ConfirmFlow } from '../hooks/useConfirmFlow';
import { tr } from '../../../test/i18n';
import { codeValue, fillCode } from '../../../test/dom';
import { OperationConfirm } from './OperationConfirm';

// Тексты, которые компонент получает пропами: они приходят от вызывающего экрана, поэтому в
// тесте это фикстуры, а не подписи из переводов.
const DEAD_END = 'Start the operation over.';
const AWAITING_FINISH = 'Code accepted, try again.';
const PASSWORD_HINT = 'The password is needed to turn the second factor off.';
const FLOW_TITLE = 'Turn the second factor off';
/** Причину аннулирования знает только сервер — она приходит текстом. */
const REVOKED_DETAIL = 'Access to the realm was revoked';

/**
 * Тупик «попытки кончились» звучит по-разному в зависимости от звена: там, где повторная отправка
 * неприменима (второй фактор, аварийный код), нового кода не будет вовсе, и упоминать отправки
 * значило бы звать в кнопку, которой нет. Поверх этого выбора вызывающий может поставить свой
 * текст пропом — у security-потоков «начните вход заново» не к месту. Флоу здесь подставной:
 * проверяется ровно презентация, без сети и движка.
 */

const snapshot: OperationSnapshot = {
  token: 't'.repeat(64),
  confirmMethod: 'PASSWORD',
  remainingAttempts: 0,
  // Поля резенда у звена второго фактора спека не возвращает вовсе — это не «ноль отправок».
  remainingResends: undefined,
  expiresAt: Date.now() + 600_000,
  resendAllowedAt: 0,
  phase: 'exhausted',
};

const flow: ConfirmFlow = {
  snapshot,
  error: null,
  errorFrom: null,
  clearError: vi.fn(),
  submitting: false,
  resending: false,
  awaitingFinish: false,
  expiresLeft: 600,
  resendLeft: 0,
  canResend: false,
  isResendApplicable: false,
  confirm: vi.fn(),
  resend: vi.fn(),
  revoke: vi.fn(),
};

// Ветка auth.test.* — стенд под проп hintPrefix: в приложении её нет, а проверять подмену префикса
// надо на ключах, которые действительно существуют, иначе кейс проверял бы только падение.
const flowTranslations = {
  ru: { auth: { test: { hint: { PASSWORD: PASSWORD_HINT } } } },
};

beforeAll(() => {
  setLanguage('en');
  initI18n();
  addTranslations(authTranslations);
  addTranslations(flowTranslations);
});

describe('OperationConfirm: the dead-end text', () => {
  it('on a link without resending it never mentions resends', () => {
    render(<OperationConfirm flow={flow} />);

    expect(screen.getByText(tr('auth.confirm.deadEndNoResend'))).toBeInTheDocument();
    expect(screen.queryByText(tr('auth.confirm.deadEnd'))).not.toBeInTheDocument();
    // Кнопки «запросить новый код» в тупике нет — предлагать нечего.
    expect(
      screen.queryByText(tr('auth.confirm.requestNewCode'), { exact: false }),
    ).not.toBeInTheDocument();
  });

  /** Отправки у звена были, но кончились вместе с попытками — тупик называет обе причины. */
  it('on a code link with the resends used up it takes the shared text', () => {
    const emailLink: ConfirmFlow = {
      ...flow,
      snapshot: { ...snapshot, confirmMethod: 'EMAIL', remainingResends: 0 },
      isResendApplicable: true,
    };
    render(<OperationConfirm flow={emailLink} />);

    expect(screen.getByText(tr('auth.confirm.deadEnd'))).toBeInTheDocument();
  });

  /**
   * Срок операции истекает сам по себе, попытки при этом целы: сказать про попытки значило бы
   * назвать причину, которой не было, и отправить искать ошибку в собственном вводе.
   */
  it('an expired link names the expiry, not the attempts', () => {
    const expired: ConfirmFlow = {
      ...flow,
      snapshot: { ...snapshot, phase: 'expired', remainingAttempts: 3 },
      expiresLeft: 0,
    };
    render(<OperationConfirm flow={expired} />);

    expect(screen.getByText(tr('auth.confirm.deadEndExpiredNoResend'))).toBeInTheDocument();
    expect(screen.queryByText(tr('auth.confirm.deadEndNoResend'))).not.toBeInTheDocument();
  });

  /** На звене с кодом обе возможности исчерпаны сразу — текст называет и срок, и отправки. */
  it('an expired code link with the resends used up names both', () => {
    const expired: ConfirmFlow = {
      ...flow,
      snapshot: {
        ...snapshot,
        phase: 'expired',
        confirmMethod: 'EMAIL',
        remainingAttempts: 3,
        remainingResends: 0,
      },
      isResendApplicable: true,
      expiresLeft: 0,
    };
    render(<OperationConfirm flow={expired} />);

    expect(screen.getByText(tr('auth.confirm.deadEndExpired'))).toBeInTheDocument();
  });

  it('the prop replaces it with the flow text', () => {
    render(<OperationConfirm flow={flow} deadEndText={DEAD_END} />);

    expect(screen.getByText(DEAD_END)).toBeInTheDocument();
    expect(screen.queryByText(tr('auth.confirm.deadEndNoResend'))).not.toBeInTheDocument();
  });
});

/**
 * Заголовок экрана рисует сам компонент, а не схема страницы: он делит строку с переключателем
 * формата, и знать про эту пару может только он. По умолчанию это заголовок подтверждения, но
 * security-потоки служат под своим поводом и называют себя сами.
 */
describe('OperationConfirm: the title', () => {
  const active: ConfirmFlow = { ...flow, snapshot: { ...snapshot, phase: 'active' } };

  it('with no prop it names the confirmation itself', () => {
    render(<OperationConfirm flow={active} />);

    expect(screen.getByRole('heading', { name: tr('auth.confirm.title') })).toBeInTheDocument();
  });

  it('the prop replaces it with the flow title', () => {
    render(<OperationConfirm flow={active} title={FLOW_TITLE} />);

    expect(screen.getByRole('heading', { name: FLOW_TITLE })).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: tr('auth.confirm.title') }),
    ).not.toBeInTheDocument();
  });
});

/**
 * Подсказка над полем берётся по методу подтверждения текущего звена. Один и тот же метод в разных
 * потоках объясняется по-разному, поэтому префикс ключа задаёт вызывающий, а метод к нему
 * добавляет сам экран.
 */
describe('OperationConfirm: the hint above the field', () => {
  const active: ConfirmFlow = { ...flow, snapshot: { ...snapshot, phase: 'active' } };

  it('with no prop it takes the confirmation-screen keys', () => {
    render(<OperationConfirm flow={active} />);

    expect(screen.getByText(tr('auth.confirm.hint.PASSWORD'))).toBeInTheDocument();
  });

  it('an own prefix gives an own text for the same method', () => {
    render(<OperationConfirm flow={active} hintPrefix="auth.test.hint" />);

    expect(screen.getByText(PASSWORD_HINT)).toBeInTheDocument();
    expect(screen.queryByText(tr('auth.confirm.hint.PASSWORD'))).not.toBeInTheDocument();
  });

  /**
   * Ключа под чужим префиксом может не оказаться — на экран должен уехать текст, а не сам ключ.
   * Падаем на подсказку экрана подтверждения: метод тот же, объяснение остаётся осмысленным.
   */
  it('no key under the own prefix: the screen hint is used, not the raw key', () => {
    render(<OperationConfirm flow={active} hintPrefix="auth.test.missing" />);

    expect(screen.getByText(tr('auth.confirm.hint.PASSWORD'))).toBeInTheDocument();
    expect(screen.queryByText(/auth\.test\.missing/)).not.toBeInTheDocument();
  });
});

/**
 * Форматов четыре, и каждый показывает себя собой: код известной длины — рядом клеток, пароль —
 * точками и глазом, аварийный код — открытым текстом. Подпись при этом называет активный формат:
 * «Код подтверждения» над полем пароля называло бы не то, что от человека ждут.
 */
describe('OperationConfirm: the secret field', () => {
  const active: ConfirmFlow = { ...flow, snapshot: { ...snapshot, phase: 'active' } };
  const linkFlow = (confirmMethod: OperationSnapshot['confirmMethod']): ConfirmFlow => ({
    ...active,
    snapshot: { ...snapshot, phase: 'active', confirmMethod },
  });

  it('names what the current link asks for', () => {
    render(<OperationConfirm flow={active} />);

    expect(screen.getByLabelText(tr('auth.field.password'))).toBeInTheDocument();
  });

  /** Код известной длины набирают в ряд клеток: сколько клеток, столько и цифр. */
  it('a link with a code from a message shows a row of cells', () => {
    render(<OperationConfirm flow={linkFlow('EMAIL')} />);

    const row = screen.getByRole('group', { name: tr('auth.field.code') });
    expect(within(row).getAllByRole('textbox')).toHaveLength(limits.confirmCode.max);
  });

  /** Код из приложения — тоже ряд, но своей длины: у него формат объявлен точно, ровно шесть цифр. */
  it('the authenticator link shows a row of its own length', () => {
    render(<OperationConfirm flow={linkFlow('TOTP')} />);

    const row = screen.getByRole('group', { name: tr('auth.field.totpCode') });
    expect(within(row).getAllByRole('textbox')).toHaveLength(limits.totpCode.max);
  });

  /**
   * Пароль живёт дольше операции: подсмотренный через плечо или попавший в запись экрана, он
   * остаётся ключом к аккаунту, поэтому единственное звено, где ввод скрывают, — парольное.
   */
  it('hides the password and leaves the one-time secrets visible', () => {
    render(<OperationConfirm flow={active} />);
    expect(screen.getByLabelText(tr('auth.field.password'))).toHaveAttribute('type', 'password');

    cleanup();
    render(<OperationConfirm flow={linkFlow('RECOVERY')} />);
    expect(screen.getByLabelText(tr('auth.field.recoveryCode'))).not.toHaveAttribute(
      'type',
      'password',
    );
  });

  /**
   * Всё нецифровое в ряду клеток — заведомо промах: пробелы приносит вставка из буфера, буквы
   * приходят с чужой раскладки. Дойди они до сервера, попытка сгорела бы за то, чего не набирали.
   */
  it('keeps only the digits of a pasted code', () => {
    const confirm = vi.fn();
    render(<OperationConfirm flow={{ ...linkFlow('EMAIL'), confirm }} />);

    fillCode(' 18cq39 47 ');
    expect(codeValue()).toBe('183947');

    fireEvent.click(screen.getByRole('button', { name: tr('auth.confirm.submit') }));
    expect(confirm).toHaveBeenCalledWith('183947');
  });

  /** Ряд не растягивается: лишние цифры вставки в него не помещаются и отбрасываются. */
  it('cuts a pasted code down to the length of the row', () => {
    render(<OperationConfirm flow={linkFlow('EMAIL')} />);

    fillCode('18 39 47 99');
    expect(codeValue()).toBe('183947');
  });

  /**
   * Набор поверх занятой клетки заменяет её цифру и только её: ряд не растёт, хвост не сдвигается и
   * последняя цифра не вытесняется за край — человек отправляет ровно то, что видит.
   */
  it('replaces the digit under the caret in a full row', () => {
    render(<OperationConfirm flow={linkFlow('EMAIL')} />);
    fillCode('183947');

    // Клетка управляемая и держит один символ: браузер дописывает набранное к тому, что там было.
    fireEvent.change(screen.getByTestId('field-secret-0'), { target: { value: '19' } });
    expect(codeValue()).toBe('983947');
  });

  /**
   * Секрет длиннее одной операции только один — пароль, и менеджер паролей ему предлагается: явный
   * выбор формата снял причину, по которой автозаполнение было выключено и здесь. Одноразовым
   * секретам сохранять нечего.
   */
  it.each([
    ['the password link', 'PASSWORD' as const, 'auth.field.password', 'current-password'],
    ['the recovery link', 'RECOVERY' as const, 'auth.field.recoveryCode', 'off'],
  ])('offers the right autofill on %s', (_name, confirmMethod, label, autoComplete) => {
    render(<OperationConfirm flow={linkFlow(confirmMethod)} />);

    expect(screen.getByLabelText(tr(label))).toHaveAttribute('autocomplete', autoComplete);
  });

  /**
   * Автоподстановка кода из сообщения объявлена ровно на первой клетке: объяви её на каждой — и
   * браузер подставил бы код шесть раз, по разу в клетку.
   */
  it('asks for the one-time code on the first cell only', () => {
    render(<OperationConfirm flow={linkFlow('EMAIL')} />);

    const cells = within(screen.getByRole('group', { name: tr('auth.field.code') })).getAllByRole(
      'textbox',
    );
    expect(cells[0]).toHaveAttribute('autocomplete', 'one-time-code');
    expect(cells[1]).toHaveAttribute('autocomplete', 'off');
  });

  /**
   * На звене второго фактора спека разрешает предъявить аварийный код вместо кода из
   * 2FA-приложения — и ряд из шести клеток сворачивается в поле: семнадцать символов в шесть клеток
   * не помещаются никак, и без этого разворота боксы закрыли бы запасной путь входа совсем.
   */
  it('lets a recovery code through on the authenticator link', () => {
    const confirm = vi.fn();
    render(<OperationConfirm flow={{ ...linkFlow('TOTP'), confirm }} allowRecoverySwap />);

    fireEvent.click(screen.getByRole('button', { name: tr('auth.confirm.mode.RECOVERY') }));
    const field = screen.getByLabelText(tr('auth.field.recoveryCode'));
    fireEvent.change(field, { target: { value: 'RECOVRY1-CODE0011' } });

    fireEvent.click(screen.getByRole('button', { name: tr('auth.confirm.submit') }));
    expect(confirm).toHaveBeenCalledWith('RECOVRY1-CODE0011');
  });

  /**
   * Аварийный код набран из фиксированного алфавита с дефисом — пробел по краю в него не входит и
   * приезжает только вместе со вставкой из списка кодов. Уйди он на сервер, попытка сгорела бы.
   */
  it('trims the edges of a recovery code', () => {
    const confirm = vi.fn();
    render(<OperationConfirm flow={{ ...linkFlow('RECOVERY'), confirm }} />);

    fireEvent.change(screen.getByLabelText(tr('auth.field.recoveryCode')), {
      target: { value: ' RECOVRY1-CODE0011 ' },
    });
    fireEvent.click(screen.getByRole('button', { name: tr('auth.confirm.submit') }));
    expect(confirm).toHaveBeenCalledWith('RECOVRY1-CODE0011');
  });

  /**
   * Пароль уходит как набран: символы в нём контракт ничем не ограничивает, поэтому пробел по краю —
   * такая же его часть, как любая буква. Обрежь его, и попытки сгорели бы на значении, которого
   * никто не вводил, — а их всего три.
   */
  it('sends the password exactly as typed', () => {
    const confirm = vi.fn();
    const passwordLink: ConfirmFlow = { ...active, confirm };
    render(<OperationConfirm flow={passwordLink} />);

    fireEvent.change(screen.getByLabelText(tr('auth.field.password')), {
      target: { value: ' secret pass ' },
    });
    fireEvent.click(screen.getByRole('button', { name: tr('auth.confirm.submit') }));
    expect(confirm).toHaveBeenCalledWith(' secret pass ');
  });

  /**
   * Кнопка меряет то, что уйдёт на сервер: пробелы по краям на сервер не едут, и включать сабмит
   * им нечем. Иначе заведомо короткое значение уехало бы запросом и сожгло одну из трёх попыток.
   */
  it('does not count the trimmed edges towards the minimum', () => {
    render(<OperationConfirm flow={linkFlow('RECOVERY')} />);

    fireEvent.change(screen.getByLabelText(tr('auth.field.recoveryCode')), {
      target: { value: '  1 ' },
    });
    expect(screen.getByRole('button', { name: tr('auth.confirm.submit') })).toBeDisabled();
  });

  /**
   * У каждого формата свои границы, и держит их явный выбор режима: аварийный код приезжает в
   * поле только вместе с переключением, поэтому гейт по паролю запасной путь входа не закрывает.
   */
  it('holds the submit until the password reaches its own minimum', () => {
    render(<OperationConfirm flow={active} />);

    const field = screen.getByLabelText(tr('auth.field.password'));
    const submit = screen.getByRole('button', { name: tr('auth.confirm.submit') });

    fireEvent.change(field, { target: { value: 'S'.repeat(limits.password.min - 1) } });
    expect(submit).toBeDisabled();

    fireEvent.change(field, { target: { value: 'S'.repeat(limits.password.min) } });
    expect(submit).toBeEnabled();
  });

  /** Ряд включает кнопку с контрактного пола: короче него код сервер не примет ни при каком вводе. */
  it('holds the submit until the row of cells reaches the code minimum', () => {
    render(<OperationConfirm flow={linkFlow('EMAIL')} />);
    const submit = screen.getByRole('button', { name: tr('auth.confirm.submit') });

    fillCode('1'.repeat(limits.confirmCode.min - 1));
    expect(submit).toBeDisabled();

    fillCode('1'.repeat(limits.confirmCode.min));
    expect(submit).toBeEnabled();
  });
});

/**
 * Подмена второго фактора аварийным кодом — штатный запасной путь входа, а не краевой случай.
 * Заранее объявлять выбор спека не требует, но угадать формат по вводу нельзя: пароль может
 * содержать дефис и выглядеть как код. Отсюда явный переключатель — и он же обязан молчать там,
 * где подмена не разрешена: отказ стоил бы одной попытки из трёх.
 */
describe('OperationConfirm: switching to a recovery code', () => {
  const ATTEMPTS = 3;
  /** Текст отказа, в котором набранное не виновато: приходит пропом, поэтому в тесте это фикстура. */
  const OFFLINE = 'No connection to the server';
  const live: OperationSnapshot = { ...snapshot, phase: 'active', remainingAttempts: ATTEMPTS };
  const active: ConfirmFlow = { ...flow, snapshot: live };
  const linkFlow = (confirmMethod: OperationSnapshot['confirmMethod']): ConfirmFlow => ({
    ...active,
    snapshot: { ...live, confirmMethod },
  });

  it('has no icons where the swap is not allowed', () => {
    render(<OperationConfirm flow={active} />);

    expect(
      screen.queryByRole('button', { name: tr('auth.confirm.mode.RECOVERY') }),
    ).not.toBeInTheDocument();
  });

  /**
   * Звено `RECOVERY` — уже сам аварийный код, отдельным звеном цепочки: подменять на этом звене
   * нечего и не на что.
   */
  it('has no icons on the recovery link itself', () => {
    render(<OperationConfirm flow={linkFlow('RECOVERY')} allowRecoverySwap />);

    expect(
      screen.queryByRole('button', { name: tr('auth.confirm.mode.RECOVERY') }),
    ).not.toBeInTheDocument();
  });

  /** Имя поля называет активный формат, хотя видимой подписи на экране нет. */
  it('renames the field after the switch', () => {
    render(<OperationConfirm flow={active} allowRecoverySwap />);

    fireEvent.click(screen.getByRole('button', { name: tr('auth.confirm.mode.RECOVERY') }));
    expect(screen.getByLabelText(tr('auth.field.recoveryCode'))).toBeInTheDocument();
    expect(screen.queryByLabelText(tr('auth.field.password'))).not.toBeInTheDocument();
  });

  /**
   * Переключение чистит поле: форматы несовместимы, а хвост пароля, оставшийся в поле аварийного
   * кода, был бы показан открытым текстом.
   */
  it('clears the field on the switch', () => {
    render(<OperationConfirm flow={active} allowRecoverySwap />);

    fireEvent.change(screen.getByLabelText(tr('auth.field.password')), {
      target: { value: 'secret pass' },
    });
    fireEvent.click(screen.getByRole('button', { name: tr('auth.confirm.mode.RECOVERY') }));
    expect(screen.getByLabelText(tr('auth.field.recoveryCode'))).toHaveValue('');
  });

  /**
   * Клик по выбранному формату — не переключение: знаки стоят парой и по ним же читают, какой
   * формат сейчас набирают, поэтому клик по активному не имеет права стирать набранное.
   */
  it('keeps the field when the chosen format is clicked again', () => {
    render(<OperationConfirm flow={active} allowRecoverySwap />);

    fireEvent.change(screen.getByLabelText(tr('auth.field.password')), {
      target: { value: 'secret pass' },
    });
    fireEvent.click(screen.getByRole('button', { name: tr('auth.confirm.mode.PASSWORD') }));
    expect(screen.getByLabelText(tr('auth.field.password'))).toHaveValue('secret pass');
  });

  /** Счётчик попыток про отправки на сервер, а переключение до сервера не доходит. */
  it('spends no attempt on the switch', () => {
    const confirm = vi.fn();
    render(<OperationConfirm flow={{ ...active, confirm }} allowRecoverySwap />);

    fireEvent.click(screen.getByRole('button', { name: tr('auth.confirm.mode.RECOVERY') }));
    fireEvent.click(screen.getByRole('button', { name: tr('auth.confirm.mode.PASSWORD') }));
    expect(confirm).not.toHaveBeenCalled();
    expect(screen.getByText(tr('auth.confirm.attemptsLeft', { n: ATTEMPTS }))).toBeInTheDocument();
  });

  /** Сообщение — единственное место, где формат назван словом. */
  it('swaps the message for the chosen format', () => {
    render(<OperationConfirm flow={active} allowRecoverySwap />);
    expect(screen.getByText(tr('auth.confirm.hint.PASSWORD'))).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: tr('auth.confirm.mode.RECOVERY') }));
    expect(screen.getByText(tr('auth.confirm.hint.RECOVERY'))).toBeInTheDocument();
    expect(screen.queryByText(tr('auth.confirm.hint.PASSWORD'))).not.toBeInTheDocument();
  });

  /** Почтовое звено от телефонного отличает только сообщение: выбранный формат у них один. */
  it('keeps the link own message while nothing is swapped', () => {
    render(<OperationConfirm flow={linkFlow('PHONE')} />);

    expect(screen.getByText(tr('auth.confirm.hint.PHONE'))).toBeInTheDocument();
  });

  it('shows no visible label over the field', () => {
    render(<OperationConfirm flow={active} allowRecoverySwap />);

    expect(screen.queryByText(tr('auth.field.password'))).not.toBeInTheDocument();
    expect(screen.getByLabelText(tr('auth.field.password'))).toBeInTheDocument();
  });

  /**
   * Отказ по набранному стоит под полем, а не плашкой наверху: он про то, что сейчас в поле.
   * Плашка остаётся за состоянием операции — там поля может не быть вовсе.
   */
  it('puts a refusal of the typed secret under the field, not in the alert', () => {
    const WRONG = 'Wrong password';
    render(<OperationConfirm flow={{ ...active, error: WRONG, errorFrom: 'confirm' }} />);

    expect(screen.getByText(WRONG)).toBeInTheDocument();
    expect(screen.queryByTestId('ui-alert')).not.toBeInTheDocument();
    expect(screen.getByLabelText(tr('auth.field.password'))).toHaveAttribute(
      'aria-invalid',
      'true',
    );
  });

  /**
   * Отказ по набранному объявляется: он приходит ответом сервера, курсор после отправки остаётся
   * в поле, и экран не меняется ничем другим. Регион стоит на месте с первого кадра — объявляет
   * его текст, вставленный внутрь, — поэтому ждём текста, а не самого региона.
   */
  it('announces the refusal of the typed secret', () => {
    const WRONG = 'Wrong password';
    render(<OperationConfirm flow={{ ...active, error: WRONG, errorFrom: 'confirm' }} />);

    expect(screen.getByRole('alert')).toHaveTextContent(WRONG);
  });

  /** Ряд клеток говорит отказ тем же способом: место строки другое, объявление то же. */
  it('announces the refusal under the row of cells too', () => {
    const WRONG = 'Wrong code';
    render(
      <OperationConfirm flow={{ ...linkFlow('EMAIL'), error: WRONG, errorFrom: 'confirm' }} />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(WRONG);
  });

  /** Отказ без вердикта объявляется наравне с вердиктом: повторяют его тоже с этого экрана. */
  it('announces a refusal that is not a verdict as well', () => {
    render(<OperationConfirm flow={{ ...active, error: OFFLINE, errorFrom: 'notice' }} />);

    expect(screen.getByRole('alert')).toHaveTextContent(OFFLINE);
  });

  /** Ввод снимает отказ прошлой попытки — он был про прошлое значение. */
  it('clears the refusal as soon as the secret is edited', () => {
    const clearError = vi.fn();
    render(
      <OperationConfirm
        flow={{ ...active, error: 'Wrong password', errorFrom: 'confirm', clearError }}
      />,
    );

    fireEvent.change(screen.getByLabelText(tr('auth.field.password')), {
      target: { value: 'another' },
    });
    expect(clearError).toHaveBeenCalled();
  });

  /**
   * Отказ без вердикта — лимит, сбой сервиса, обрыв связи — повторяют тем же набором, поэтому
   * стоит он там же, под полем. Но поля не метит: помеченное поле зовёт исправлять набранное, а
   * исправлять в нём нечего.
   */
  it('leaves the field clean when the refusal is not a verdict on the secret', () => {
    render(<OperationConfirm flow={{ ...active, error: OFFLINE, errorFrom: 'notice' }} />);

    expect(screen.getByText(OFFLINE)).toBeInTheDocument();
    expect(screen.queryByTestId('ui-alert')).not.toBeInTheDocument();
    expect(screen.getByLabelText(tr('auth.field.password'))).not.toHaveAttribute(
      'aria-invalid',
      'true',
    );
  });

  /** Ряд клеток живёт по тому же правилу: без вердикта набранные цифры ни в чём не виноваты. */
  it('leaves the cells clean on the same refusal', () => {
    render(
      <OperationConfirm flow={{ ...linkFlow('EMAIL'), error: OFFLINE, errorFrom: 'notice' }} />,
    );

    expect(screen.getByText(OFFLINE)).toBeInTheDocument();
    const row = screen.getByRole('group', { name: tr('auth.field.code') });
    for (const cell of within(row).getAllByRole('textbox')) {
      expect(cell).not.toHaveAttribute('aria-invalid', 'true');
    }
  });

  /** Правка набранного такой отказ не снимает: связь от набора цифр не появится. */
  it('keeps that refusal while the secret is edited', () => {
    const clearError = vi.fn();
    render(
      <OperationConfirm flow={{ ...active, error: OFFLINE, errorFrom: 'notice', clearError }} />,
    );

    fireEvent.change(screen.getByLabelText(tr('auth.field.password')), {
      target: { value: 'another' },
    });
    expect(clearError).not.toHaveBeenCalled();
  });

  /**
   * Значки ничего не всплывают: что набирают сейчас, сказано сообщением под ними. Имя у кнопки при
   * этом остаётся — на нём держится и доступность, и все поиски в тестах.
   */
  it('gives the icons a name and nothing that pops up', () => {
    render(<OperationConfirm flow={active} allowRecoverySwap />);

    const icon = screen.getByRole('button', { name: tr('auth.confirm.mode.RECOVERY') });
    expect(icon).not.toHaveAttribute('title');
    expect(icon).toHaveAttribute('aria-pressed', 'false');
  });

  /** Код из сообщения подменять нечем: разрешение на подмену есть, а звено её не допускает. */
  it('has no icons on a link that cannot be swapped', () => {
    render(<OperationConfirm flow={linkFlow('EMAIL')} allowRecoverySwap />);

    expect(
      screen.queryByRole('button', { name: tr('auth.confirm.mode.RECOVERY') }),
    ).not.toBeInTheDocument();
  });
});

/**
 * Отказ повторной отправки и отказ по набранному приходят одним и тем же путём, но говорят о
 * разном: первый — про кнопку, второй — про то, что в поле. Экран показывает их в разных местах,
 * и перепутать их значило бы обвинить набранные цифры в том, чего они не делали.
 */
describe('OperationConfirm: a refusal of the resend', () => {
  const RESEND_FAILED = 'Failed to resend the code';
  const emailLink: ConfirmFlow = {
    ...flow,
    snapshot: {
      ...snapshot,
      phase: 'active',
      confirmMethod: 'EMAIL',
      remainingAttempts: 3,
      remainingResends: 2,
    },
    isResendApplicable: true,
  };
  const failed: ConfirmFlow = { ...emailLink, error: RESEND_FAILED, errorFrom: 'resend' };

  it('goes to the alert, not under the code row', () => {
    render(<OperationConfirm flow={failed} />);

    expect(within(screen.getByTestId('ui-alert')).getByText(RESEND_FAILED)).toBeInTheDocument();
  });

  it('leaves the typed code unaccused', () => {
    render(<OperationConfirm flow={failed} />);

    const cells = within(screen.getByRole('group', { name: tr('auth.field.code') })).getAllByRole(
      'textbox',
    );
    for (const cell of cells) expect(cell).not.toHaveAttribute('aria-invalid');
  });

  /** Правка поля снимает отказ по набранному, а до сорванной отправки ей дела нет. */
  it('survives editing the code', () => {
    const clearError = vi.fn();
    render(<OperationConfirm flow={{ ...failed, clearError }} />);

    fillCode('183947');
    expect(clearError).not.toHaveBeenCalled();
    expect(screen.getByTestId('ui-alert')).toBeInTheDocument();
  });

  /**
   * Отправки кончились — предупреждение об этом стоит на том же месте, что и отказ. Место одно, и
   * занимает его случившийся отказ: предупреждение про будущее подождёт.
   */
  it('outweighs the last-resend warning', () => {
    render(
      <OperationConfirm
        flow={{ ...failed, snapshot: { ...failed.snapshot!, remainingResends: 0 } }}
      />,
    );

    expect(screen.getByText(RESEND_FAILED)).toBeInTheDocument();
    expect(screen.queryByText(tr('auth.confirm.lastResend'))).not.toBeInTheDocument();
  });
});

/**
 * Отсчёт один и тот же — срок жизни операции, — но называть его сроком кода можно только там, где
 * код есть: на парольном звене истекает время на подтверждение, а не какой-то код. А там, где код
 * уже принят, остаток времени не про подтверждение вовсе — про повтор терминального действия.
 */
describe('OperationConfirm: the countdown caption', () => {
  const active: ConfirmFlow = { ...flow, snapshot: { ...snapshot, phase: 'active' } };

  it('a link without a delivered code counts the confirmation time', () => {
    render(<OperationConfirm flow={active} />);

    expect(screen.getByText(tr('auth.confirm.expiresInNoCode', { time: '10:00' }))).toBeVisible();
  });

  it('a link with a code from a message counts the code', () => {
    const emailLink: ConfirmFlow = {
      ...active,
      snapshot: { ...snapshot, phase: 'active', confirmMethod: 'EMAIL', remainingResends: 2 },
      isResendApplicable: true,
    };
    render(<OperationConfirm flow={emailLink} />);

    expect(screen.getByText(tr('auth.confirm.expiresIn', { time: '10:00' }))).toBeVisible();
  });

  /**
   * Код принят, сорвался терминал: подтверждать больше нечего, и «Повторить» — единственная кнопка
   * на экране. Остаток времени тут отмерен ей, поэтому подписан он повтором, а не сроком кода и не
   * сроком подтверждения, которого уже не будет.
   */
  it('a link waiting for the terminal counts the retry time', () => {
    const finishing: ConfirmFlow = {
      ...active,
      snapshot: { ...snapshot, phase: 'confirmed', confirmMethod: 'EMAIL', remainingResends: 2 },
      isResendApplicable: true,
      awaitingFinish: true,
    };
    render(<OperationConfirm flow={finishing} />);

    expect(screen.getByText(tr('auth.confirm.finishExpiresIn', { time: '10:00' }))).toBeVisible();
  });

  it('a link waiting for the terminal says the retry time is up', () => {
    const finishing: ConfirmFlow = {
      ...active,
      snapshot: { ...snapshot, phase: 'confirmed' },
      awaitingFinish: true,
      expiresLeft: 0,
    };
    render(<OperationConfirm flow={finishing} />);

    expect(screen.getByText(tr('auth.confirm.finishExpired'))).toBeVisible();
  });

  /**
   * Минуты дополняются нулём: без него отсчёт на переходе через десять минут теряет разряд, число
   * укорачивается и подпись дёргается.
   */
  it('pads a single-digit minute', () => {
    render(<OperationConfirm flow={{ ...active, expiresLeft: 546 }} />);

    expect(screen.getByText(tr('auth.confirm.expiresInNoCode', { time: '09:06' }))).toBeVisible();
  });

  /**
   * У отсчёта повторной отправки разряду минут теряться не в чем — он не достигает единицы, — и
   * ведущий ноль был бы там просто шумом.
   */
  it('leaves the resend countdown without a leading zero', () => {
    const emailLink: ConfirmFlow = {
      ...active,
      snapshot: { ...snapshot, phase: 'active', confirmMethod: 'EMAIL', remainingResends: 2 },
      isResendApplicable: true,
      resendLeft: 30,
    };
    render(<OperationConfirm flow={emailLink} />);

    expect(screen.getByText(tr('auth.confirm.resendTimer', { time: '0:30' }))).toBeVisible();
  });
});

/**
 * Формулировки про вход в общий экран не зашиты: у security-потоков терминал — не вход, и «войти
 * не удалось» / «начните вход заново» отправили бы искать проблему совсем не там.
 */
describe('OperationConfirm: the terminal texts', () => {
  it('the prop replaces the terminal-waiting hint', () => {
    const finishing: ConfirmFlow = {
      ...flow,
      snapshot: { ...snapshot, phase: 'confirmed' },
      awaitingFinish: true,
    };
    render(<OperationConfirm flow={finishing} awaitingFinishText={AWAITING_FINISH} />);

    expect(screen.getByText(AWAITING_FINISH)).toBeInTheDocument();
    expect(screen.queryByText(tr('auth.confirm.awaitingFinish'))).not.toBeInTheDocument();
  });

  it('the prop replaces the fallback text of an invalidated operation', () => {
    const invalidated: ConfirmFlow = { ...flow, snapshot: { ...snapshot, phase: 'dead' } };
    render(<OperationConfirm flow={invalidated} invalidatedText={DEAD_END} />);

    expect(screen.getByText(DEAD_END)).toBeInTheDocument();
  });

  /** Причина от сервера точнее любого запасного текста, поэтому проп ей не мешает. */
  it('the server reason outweighs the prop', () => {
    const invalidated: ConfirmFlow = {
      ...flow,
      snapshot: { ...snapshot, phase: 'dead' },
      error: REVOKED_DETAIL,
      errorFrom: 'confirm',
    };
    render(<OperationConfirm flow={invalidated} invalidatedText={DEAD_END} />);

    expect(screen.getByText(REVOKED_DETAIL)).toBeInTheDocument();
  });
});
