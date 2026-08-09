import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient } from '@tanstack/react-query';
import { delay, http, HttpResponse } from 'msw';
import { config } from '@config';
import { server } from '@mocks/server';
import { initI18n, setLanguage } from '@core/i18n';
import { registerBaseComponents } from '@core/renderer';
import { registerModule, resetRegistry } from '@core/module-registry';
import { resetComponents, resetSchemas } from '@core/schema';
import { realmProvider, useAuthStore } from '@core/auth';
import { contractRegistry } from '@core/contracts';
import { authModule } from '@modules/auth';
import { demoModule } from '@modules/demo';
import { AppShell } from './AppShell';
import { tr } from '../../test/i18n';

/**
 * AppShell — доменно-агностичная оболочка: навигацию берёт из реестра (buildNav), «Выйти»
 * показывает только аутентифицированному. Здесь регистрируем два модуля и проверяем, что их
 * пункты приходят в меню без правок оболочки.
 */
beforeAll(() => {
  setLanguage('en');
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
        <div data-testid="content">page content</div>
      </AppShell>
    </MemoryRouter>,
  );
}

describe('AppShell', () => {
  it('renders the navigation entries from the registry and the page content', () => {
    renderShell();
    // Пункты обоих модулей (метки резолвятся через i18next).
    expect(screen.getByRole('link', { name: tr('auth.nav.profile') })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: tr('demo.nav.home') })).toBeInTheDocument();
    expect(screen.getByTestId('content')).toBeInTheDocument();
  });

  it('the sign-out button is hidden from an anonymous visitor', () => {
    useAuthStore.setState({ status: 'anonymous' });
    renderShell();
    expect(
      screen.queryByRole('button', { name: tr('common.shell.logout') }),
    ).not.toBeInTheDocument();
  });

  it('the sign-out button is visible to an authenticated user', () => {
    useAuthStore.setState({ status: 'authenticated' });
    renderShell();
    expect(screen.getByRole('button', { name: tr('common.shell.logout') })).toBeInTheDocument();
  });

  it('sign-out invalidates the server session (DELETE /v1/session) and makes the tab anonymous', async () => {
    const calls: (string | null)[] = [];
    server.use(
      http.delete(`${config.authApiBaseUrl}/v1/session`, ({ request }) => {
        calls.push(request.headers.get('Authorization'));
        return new HttpResponse(null, { status: 204 });
      }),
    );
    useAuthStore.setState({ status: 'authenticated', accessToken: 'access', expiresAt: null });
    renderShell();

    fireEvent.click(screen.getByRole('button', { name: tr('common.shell.logout') }));

    // Серверная часть обязательна: без неё silent-refresh вернул бы пользователя после reload.
    // DELETE /v1/session требует bearer (openapi: security bearerAuth) — без него был бы 401,
    // тихо проглоченный catch-ом в logout(): вкладка чистая, серверная сессия жива.
    await waitFor(() => expect(calls).toEqual(['Bearer access']));
    await waitFor(() => expect(useAuthStore.getState().status).toBe('anonymous'));
    expect(useAuthStore.getState().accessToken).toBeNull();
  });

  it('during sign-out the button is disabled: a second click does not send a second DELETE', async () => {
    const calls: (string | null)[] = [];
    server.use(
      http.delete(`${config.authApiBaseUrl}/v1/session`, async ({ request }) => {
        calls.push(request.headers.get('Authorization'));
        await delay(20);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    useAuthStore.setState({ status: 'authenticated', accessToken: 'access', expiresAt: null });
    renderShell();

    const btn = screen.getByRole('button', { name: tr('common.shell.logout') });
    fireEvent.click(btn);
    // Пока DELETE в полёте — кнопка disabled; повторный клик по ней не доходит до logout().
    await waitFor(() => expect(btn).toBeDisabled());
    fireEvent.click(btn);

    await waitFor(() => expect(useAuthStore.getState().status).toBe('anonymous'));
    expect(calls).toHaveLength(1);
  });
});
