import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { addTranslations, initI18n, setLanguage } from '@core/i18n';
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
 * Тупик «попытки кончились» на звене, где повторная отправка неприменима (второй фактор): нового
 * кода там не будет, и общий текст про «запросите новый код» звал бы в кнопку, которой нет.
 * Поэтому текст тупика — проп, а не константа экрана. Флоу здесь подставной: проверяется ровно
 * презентация, без сети и движка.
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
  it('with no prop it takes the shared confirmation-screen text', () => {
    render(<OperationConfirm flow={flow} />);

    expect(screen.getByText(tr('auth.confirm.deadEnd'))).toBeInTheDocument();
    // Кнопки «запросить новый код» в тупике нет — предлагать нечего.
    expect(
      screen.queryByText(tr('auth.confirm.requestNewCode'), { exact: false }),
    ).not.toBeInTheDocument();
  });

  it('the prop replaces it with the flow text', () => {
    render(<OperationConfirm flow={flow} deadEndText={DEAD_END} />);

    expect(screen.getByText(DEAD_END)).toBeInTheDocument();
    expect(screen.queryByText(tr('auth.confirm.deadEnd'))).not.toBeInTheDocument();
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
