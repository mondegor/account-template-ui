import { beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { addTranslations, initI18n, setLanguage } from '@core/i18n';
import { limits } from '@config';
import type { OperationSnapshot } from '@core/operation';
import { authTranslations } from '../i18n';
import type { ConfirmFlow } from '../hooks/useConfirmFlow';
import { tr } from '../../../test/i18n';
import { OperationConfirm } from './OperationConfirm';

// Тексты, которые компонент получает пропами: они приходят от вызывающего экрана, поэтому в
// тесте это фикстуры, а не подписи из переводов.
const DEAD_END = 'Start the operation over.';
const AWAITING_FINISH = 'Code accepted, try again.';
const PASSWORD_HINT = 'The password is needed to turn the second factor off.';
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
 * Поле ввода одно на все звенья, но спрашивают они разное: подпись «Код подтверждения» над полем
 * пароля называла бы не то, что от человека ждут.
 */
describe('OperationConfirm: the secret field', () => {
  const active: ConfirmFlow = { ...flow, snapshot: { ...snapshot, phase: 'active' } };

  it('names what the current link asks for', () => {
    render(<OperationConfirm flow={active} />);

    expect(screen.getByLabelText(tr('auth.field.password'))).toBeInTheDocument();
  });

  it('a link with a code from a message keeps the confirmation-code label', () => {
    const emailLink: ConfirmFlow = {
      ...active,
      snapshot: { ...snapshot, phase: 'active', confirmMethod: 'EMAIL' },
    };
    render(<OperationConfirm flow={emailLink} />);

    expect(screen.getByLabelText(tr('auth.field.code'))).toBeInTheDocument();
  });

  /**
   * Пароль живёт дольше операции: подсмотренный через плечо или попавший в запись экрана, он
   * остаётся ключом к аккаунту, поэтому единственное звено, где ввод скрывают, — парольное.
   */
  it('hides the password and leaves the one-time secrets visible', () => {
    render(<OperationConfirm flow={active} />);
    expect(screen.getByLabelText(tr('auth.field.password'))).toHaveAttribute('type', 'password');

    cleanup();
    const recoveryLink: ConfirmFlow = {
      ...active,
      snapshot: { ...snapshot, phase: 'active', confirmMethod: 'RECOVERY' },
    };
    render(<OperationConfirm flow={recoveryLink} />);
    expect(screen.getByLabelText(tr('auth.field.recoveryCode'))).not.toHaveAttribute(
      'type',
      'password',
    );
  });

  /**
   * Всё нецифровое на цифровом звене — заведомо промах: пробелы приносит вставка из буфера, буквы
   * приходят с чужой раскладки. Дойди они до сервера, попытка сгорела бы за то, чего не набирали.
   */
  it('keeps only the digits on a numeric link', () => {
    const confirm = vi.fn();
    const emailLink: ConfirmFlow = {
      ...active,
      snapshot: { ...snapshot, phase: 'active', confirmMethod: 'EMAIL' },
      confirm,
    };
    render(<OperationConfirm flow={emailLink} />);

    const field = screen.getByLabelText(tr('auth.field.code'));
    fireEvent.change(field, { target: { value: ' 18cq39 47 ' } });
    expect(field).toHaveValue('183947');

    fireEvent.click(screen.getByRole('button', { name: tr('auth.confirm.submit') }));
    expect(confirm).toHaveBeenCalledWith('183947');
  });

  /**
   * Верхнюю длину поле объявляет контрактную — ту, что принимает сервер; продуктовый предел держит
   * фильтр: браузер применяет maxLength к вставке ДО onChange, и код, скопированный с пробелом или
   * группами, обрезался бы по мусорным символам, а человек увидел бы короткий код. Нижняя своя
   * только у цифрового звена: остальные обслуживают несколько форматов разом и меряются контрактом.
   */
  it.each([
    ['a code from a message', 'EMAIL' as const, 'auth.field.code', limits.confirmCode],
    ['the authenticator code', 'TOTP' as const, 'auth.field.code', limits.secret],
    ['the password', 'PASSWORD' as const, 'auth.field.password', limits.secret],
  ])('bounds %s by the length of its own link', (_name, confirmMethod, label, length) => {
    const link: ConfirmFlow = {
      ...active,
      snapshot: { ...snapshot, phase: 'active', confirmMethod },
    };
    render(<OperationConfirm flow={link} />);

    const field = screen.getByLabelText(tr(label));
    expect(field).toHaveAttribute('minLength', String(length.min));
    expect(field).toHaveAttribute('maxLength', String(limits.secret.max));
  });

  /** Продуктовый предел цифрового звена: лишнее срезается уже после фильтра, а не до него. */
  it('cuts a numeric link down to the code length after filtering', () => {
    const emailLink: ConfirmFlow = {
      ...active,
      snapshot: { ...snapshot, phase: 'active', confirmMethod: 'EMAIL' },
    };
    render(<OperationConfirm flow={emailLink} />);

    const field = screen.getByLabelText(tr('auth.field.code'));
    fireEvent.change(field, { target: { value: '18 39 47 99' } });
    expect(field).toHaveValue('183947');
  });

  /**
   * Заполненный код лишнюю цифру не принимает — иначе набор в его середину вытеснял бы последнюю,
   * и на сервер уходило бы не то, что человек видит в поле.
   */
  it('ignores a digit typed into a full numeric code', () => {
    const emailLink: ConfirmFlow = {
      ...active,
      snapshot: { ...snapshot, phase: 'active', confirmMethod: 'EMAIL' },
    };
    render(<OperationConfirm flow={emailLink} />);

    const field = screen.getByLabelText(tr('auth.field.code'));
    fireEvent.change(field, { target: { value: '183947' } });
    fireEvent.change(field, { target: { value: '9183947' } });
    expect(field).toHaveValue('183947');
  });

  /**
   * Автозаполнение не предлагается ни на одном звене второго фактора: спека разрешает ввести в это
   * поле аварийный код, и менеджер паролей предложил бы заменить сохранённый пароль погашенным
   * одноразовым кодом.
   */
  it.each([
    ['the password link', 'PASSWORD' as const, 'auth.field.password'],
    ['the authenticator link', 'TOTP' as const, 'auth.field.code'],
    ['the recovery link', 'RECOVERY' as const, 'auth.field.recoveryCode'],
  ])('offers no autofill on %s', (_name, confirmMethod, label) => {
    const link: ConfirmFlow = {
      ...active,
      snapshot: { ...snapshot, phase: 'active', confirmMethod },
    };
    render(<OperationConfirm flow={link} />);

    expect(screen.getByLabelText(tr(label))).toHaveAttribute('autocomplete', 'off');
  });

  /**
   * На звене второго фактора спека разрешает ввести аварийный код вместо пароля или кода из
   * 2FA-приложения. Фильтр цифр и короткая длина закрыли бы этот путь совсем: код из букв с
   * дефисом до сервера просто не дошёл бы.
   */
  it('lets a recovery code through on the authenticator link', () => {
    const confirm = vi.fn();
    const totpLink: ConfirmFlow = {
      ...active,
      snapshot: { ...snapshot, phase: 'active', confirmMethod: 'TOTP' },
      confirm,
    };
    render(<OperationConfirm flow={totpLink} />);

    const field = screen.getByLabelText(tr('auth.field.code'));
    fireEvent.change(field, { target: { value: 'RECOVRY1-CODE0011' } });
    expect(field).toHaveValue('RECOVRY1-CODE0011');

    fireEvent.click(screen.getByRole('button', { name: tr('auth.confirm.submit') }));
    expect(confirm).toHaveBeenCalledWith('RECOVRY1-CODE0011');
  });

  /**
   * Аварийный код набран из фиксированного алфавита с дефисом — пробел по краю в него не входит и
   * приезжает только вместе со вставкой из списка кодов. Уйди он на сервер, попытка сгорела бы.
   */
  it('trims the edges of a recovery code', () => {
    const confirm = vi.fn();
    const recoveryLink: ConfirmFlow = {
      ...active,
      snapshot: { ...snapshot, phase: 'active', confirmMethod: 'RECOVERY' },
      confirm,
    };
    render(<OperationConfirm flow={recoveryLink} />);

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
    const recoveryLink: ConfirmFlow = {
      ...active,
      snapshot: { ...snapshot, phase: 'active', confirmMethod: 'RECOVERY' },
    };
    render(<OperationConfirm flow={recoveryLink} />);

    fireEvent.change(screen.getByLabelText(tr('auth.field.recoveryCode')), {
      target: { value: '  1 ' },
    });
    expect(screen.getByRole('button', { name: tr('auth.confirm.submit') })).toBeDisabled();
  });

  /**
   * Парольное звено меряется контрактом, а не границами пароля: вместо пароля спека разрешает ввести
   * аварийный код, формата которого она не объявляет вовсе. Гейт по паролю закрыл бы этот путь для
   * любого набора короче парольного минимума.
   */
  it('holds the submit only until the password link reaches the contract minimum', () => {
    render(<OperationConfirm flow={active} />);

    const field = screen.getByLabelText(tr('auth.field.password'));
    const submit = screen.getByRole('button', { name: tr('auth.confirm.submit') });

    fireEvent.change(field, { target: { value: 'S'.repeat(limits.secret.min - 1) } });
    expect(submit).toBeDisabled();

    fireEvent.change(field, { target: { value: 'S'.repeat(limits.secret.min) } });
    expect(submit).toBeEnabled();
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
    };
    render(<OperationConfirm flow={invalidated} invalidatedText={DEAD_END} />);

    expect(screen.getByText(REVOKED_DETAIL)).toBeInTheDocument();
  });
});
