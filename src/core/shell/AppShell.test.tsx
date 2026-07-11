import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient } from '@tanstack/react-query';
import { initI18n, setLanguage } from '@core/i18n';
import { registerBaseComponents } from '@core/renderer';
import { registerModule, resetRegistry } from '@core/module-registry';
import { resetComponents, resetSchemas } from '@core/schema';
import { realmProvider, useAuthStore } from '@core/auth';
import { contractRegistry } from '@core/contracts';
import { authModule } from '@modules/auth';
import { demoModule } from '@modules/demo';
import { AppShell } from './AppShell';

/**
 * AppShell — доменно-агностичная оболочка: навигацию берёт из реестра (buildNav), «Выйти»
 * показывает только аутентифицированному. Здесь регистрируем два модуля и проверяем, что их
 * пункты приходят в меню без правок оболочки.
 */
beforeAll(() => {
  setLanguage('ru');
  initI18n();
  resetRegistry();
  resetComponents();
  resetSchemas();
  registerBaseComponents();
  const ctx = { queryClient: new QueryClient(), contracts: contractRegistry, realmProvider };
  registerModule(authModule, ctx);
  registerModule(demoModule, ctx);
});

afterEach(() => {
  cleanup();
  useAuthStore.setState({ status: 'anonymous', accessToken: null, expiresAt: null });
});

function renderShell() {
  return render(
    <MemoryRouter>
      <AppShell>
        <div data-testid="content">контент страницы</div>
      </AppShell>
    </MemoryRouter>,
  );
}

describe('AppShell', () => {
  it('рендерит пункты навигации из реестра и контент страницы', () => {
    renderShell();
    // Пункты обоих модулей (метки резолвятся через i18next).
    expect(screen.getByRole('link', { name: 'Профиль' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Демо' })).toBeInTheDocument();
    expect(screen.getByTestId('content')).toBeInTheDocument();
  });

  it('«Выйти» скрыт для анонима', () => {
    useAuthStore.setState({ status: 'anonymous' });
    renderShell();
    expect(screen.queryByRole('button', { name: 'Выйти' })).not.toBeInTheDocument();
  });

  it('«Выйти» виден аутентифицированному пользователю', () => {
    useAuthStore.setState({ status: 'authenticated' });
    renderShell();
    expect(screen.getByRole('button', { name: 'Выйти' })).toBeInTheDocument();
  });
});
