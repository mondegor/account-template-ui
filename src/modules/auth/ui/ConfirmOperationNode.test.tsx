import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { initI18n, setLanguage } from '@core/i18n';
import { useOperationStore } from '@core/operation';
import type { SchemaNode } from '@core/schema';
import { authTranslations } from '../i18n';
import { saveConfirmReturn } from '../lib/confirmReturn';
import { ConfirmOperationNode } from './ConfirmOperationNode';

/**
 * «Отменить» на общем экране /confirm возвращает на исходный экран (signup/signin), запомненный
 * в sessionStorage (переживает reload); при отсутствии — дефолт /signin. После отмены запись
 * чистится. revokeOperation мокаем (сеть не нужна — отмена best-effort).
 */
vi.mock('../api/authApi', () => ({
  confirmOperation: vi.fn(),
  openSession: vi.fn(),
  resendOperation: vi.fn(),
  revokeOperation: vi.fn().mockResolvedValue(undefined),
}));

const node: SchemaNode = { type: 'confirmOperation' };

// Зонд текущего маршрута: показывает pathname, куда увёл navigate.
function LocationProbe() {
  return <div data-testid="loc">{useLocation().pathname}</div>;
}

function renderConfirm() {
  return render(
    <MemoryRouter initialEntries={['/confirm']}>
      <Routes>
        <Route path="/confirm" element={<ConfirmOperationNode node={node} />} />
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeAll(() => {
  setLanguage('ru');
  const i18n = initI18n();
  for (const [lng, res] of Object.entries(authTranslations)) {
    i18n.addResourceBundle(lng, 'translation', res, true, true);
  }
});

beforeEach(() => {
  sessionStorage.clear();
  // Активная операция подтверждения, чтобы узел отрисовался (иначе snapshot=null → null).
  useOperationStore.getState().dispatch({
    type: 'START',
    parts: {
      token: 't'.repeat(64),
      confirm_method: 'EMAIL',
      remaining_attempts: 3,
      remaining_resends: 1,
      resends_in: 30,
      expires_in: 600,
    },
    now: Date.now(),
  });
});

describe('ConfirmOperationNode — «Отменить» возвращает на исходный экран', () => {
  it('поток signup (returnTo=/signup) → Отменить ведёт на /signup', async () => {
    saveConfirmReturn('/signup');
    renderConfirm();
    fireEvent.click(screen.getByRole('button', { name: 'Отменить' }));
    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/signup'));
    // Запись НЕ чистим на «Отменить»: reset() снапшота в revoke() успевает дать ConfirmPage
    // редиректнуть по тому же loadConfirmReturn(); очистка до навигации вернула бы дефолт /signin.
    expect(sessionStorage.getItem('auth:confirmReturn')).toBe('/signup');
  });

  it('без запомненного origin (прямой заход) → Отменить ведёт на /signin (дефолт)', async () => {
    renderConfirm();
    fireEvent.click(screen.getByRole('button', { name: 'Отменить' }));
    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/signin'));
  });
});
