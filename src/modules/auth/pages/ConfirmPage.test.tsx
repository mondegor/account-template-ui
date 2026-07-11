import { act } from 'react';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient } from '@tanstack/react-query';
import { initI18n, setLanguage } from '@core/i18n';
import { useOperationStore } from '@core/operation';
import { registerBaseComponents } from '@core/renderer';
import { registerModule } from '@core/module-registry';
import { realmProvider, useAuthStore } from '@core/auth';
import { contractRegistry } from '@core/contracts';
import { authModule } from '../module';
import { saveConfirmReturn } from '../lib/confirmReturn';
import { ConfirmPage } from './ConfirmPage';

/**
 * Регрессия «Отменить ведёт на /signin вместо /signup»: при отмене revoke() делает reset() снапшота
 * ДО навигации, и ConfirmPage (подписан на снапшот) сам редиректит. Его таргет обязан совпадать с
 * «Отменить» в узле (loadConfirmReturn), иначе из регистрации уводит на вход. Тест детерминированно
 * воспроизводит reset() снапшота и проверяет пункт назначения.
 */

const activeOp = {
  type: 'START' as const,
  parts: {
    token: 't'.repeat(64),
    confirm_method: 'EMAIL',
    remaining_attempts: 3,
    remaining_resends: 1,
    resends_in: 30,
    expires_in: 600,
  },
  now: Date.now(),
};

function LocationProbe() {
  return <div data-testid="loc">{useLocation().pathname}</div>;
}

function renderConfirmPage() {
  return render(
    <MemoryRouter initialEntries={['/confirm']}>
      <Routes>
        <Route path="/confirm" element={<ConfirmPage />} />
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeAll(() => {
  setLanguage('ru');
  initI18n();
  registerBaseComponents();
  registerModule(authModule, {
    queryClient: new QueryClient(),
    contracts: contractRegistry,
    realmProvider,
  });
});

beforeEach(() => {
  sessionStorage.clear();
  useOperationStore.getState().reset();
  useAuthStore.getState().setAnonymous();
});

describe('ConfirmPage — редирект при сбросе операции ведёт на исходный экран', () => {
  it('origin=/signup: сброс снапшота (как при «Отменить») → /signup, а не /signin', () => {
    saveConfirmReturn('/signup');
    useOperationStore.getState().dispatch(activeOp);
    renderConfirmPage();
    expect(screen.getByText('Подтверждение')).toBeInTheDocument();

    act(() => {
      useOperationStore.getState().reset();
    });
    expect(screen.getByTestId('loc')).toHaveTextContent('/signup');
  });

  it('без origin (прямой заход без операции) → /signin (дефолт)', () => {
    renderConfirmPage();
    expect(screen.getByTestId('loc')).toHaveTextContent('/signin');
  });

  it('успех: сессия открыта (authenticated) + сброс снапшота → /profile, а не loadConfirmReturn', () => {
    // openSession на access-переходе выставляет status='authenticated' ДО reset() снапшота.
    saveConfirmReturn('/signup');
    useOperationStore.getState().dispatch(activeOp);
    renderConfirmPage();
    expect(screen.getByText('Подтверждение')).toBeInTheDocument();

    act(() => {
      useAuthStore.getState().setAccess('a'.repeat(32), 600);
      useOperationStore.getState().reset();
    });
    expect(screen.getByTestId('loc')).toHaveTextContent('/profile');
  });
});
