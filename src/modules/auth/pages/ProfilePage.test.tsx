import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { i18next, initI18n, setLanguage } from '@core/i18n';
import { registerBaseComponents } from '@core/renderer';
import { registerModule, resetRegistry } from '@core/module-registry';
import { resetComponents, resetSchemas } from '@core/schema';
import { realmProvider, useAuthStore } from '@core/auth';
import { contractRegistry } from '@core/contracts';
import { authModule } from '@modules/auth';
import { ProfilePage } from './ProfilePage';

/**
 * ProfilePage больше не содержит хардкод-строк: подписи резолвятся из `auth.profile.*`, поэтому при
 * смене языка меняются вместе с остальной чромой. Мокаем getUserInfo (данные) и проверяем ru→en.
 */
vi.mock('../api/authApi', () => ({
  getUserInfo: vi.fn(async () => ({
    email: 'user@example.com',
    phone: '+7 900 000-00-00',
    lang: 'ru',
    last_login_ip: '127.0.0.1',
    last_logged_at: '2026-07-01T10:00:00Z',
    auth_2fa_type: 'NONE',
    realms: [
      {
        name: 'shop',
        user_kind: 'customer',
        created_at: '2026-07-01T10:00:00Z',
        updated_at: '2026-07-01T10:00:00Z',
      },
    ],
    status: 'ENABLED',
    created_at: '2026-07-01T10:00:00Z',
    updated_at: '2026-07-01T10:00:00Z',
  })),
  signin: vi.fn(),
  signup: vi.fn(),
  checkLogin: vi.fn(),
  openSession: vi.fn(),
  confirmOperation: vi.fn(),
  resendOperation: vi.fn(),
  revokeOperation: vi.fn(),
}));

beforeAll(() => {
  setLanguage('ru');
  initI18n();
  resetRegistry();
  resetComponents();
  resetSchemas();
  registerBaseComponents();
  registerModule(authModule, {
    queryClient: new QueryClient(),
    contracts: contractRegistry,
    realmProvider,
  });
  useAuthStore.setState({ status: 'authenticated' });
});

afterEach(cleanup);

function renderProfile() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ProfilePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ProfilePage (i18n)', () => {
  it('ru: подписи из auth.profile.*', async () => {
    await i18next.changeLanguage('ru');
    renderProfile();
    expect(await screen.findByText('Учётная запись')).toBeInTheDocument();
    expect(screen.getByText('Телефон')).toBeInTheDocument();
    expect(screen.getByText('Безопасность')).toBeInTheDocument();
  });

  it('«Зарегистрирован» в Account выводит только дату', async () => {
    await i18next.changeLanguage('ru');
    renderProfile();
    // Дата регистрации переехала под новую подпись и выводится без времени.
    const value = (await screen.findByText('Зарегистрирован'))
      .closest('div')
      ?.querySelector('p:last-child');
    expect(value?.textContent).toBe(new Date('2026-07-01T10:00:00Z').toLocaleDateString('ru-RU'));
  });

  it('«Последний вход» выводит относительное время + точное в title', async () => {
    // now = last_logged_at (2026-07-01T10:00:00Z) + 5 минут → «5 минут назад».
    // Мокаем только Date.now (его читает useNow), чтобы не ломать поллинг findByText fake-таймерами.
    const nowSpy = vi
      .spyOn(Date, 'now')
      .mockReturnValue(new Date('2026-07-01T10:05:00Z').getTime());
    try {
      await i18next.changeLanguage('ru');
      renderProfile();
      const value = (await screen.findByText('Последний вход'))
        .closest('div')
        ?.querySelector('p:last-child');
      expect(value?.textContent).toBe('5 минут назад');
      expect(value?.getAttribute('title')).toBe(
        new Date('2026-07-01T10:00:00Z').toLocaleString('ru-RU'),
      );
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('en: подписи переключаются на английский', async () => {
    await i18next.changeLanguage('en');
    renderProfile();
    expect(await screen.findByText('Account')).toBeInTheDocument();
    expect(screen.getByText('Phone')).toBeInTheDocument();
    expect(screen.getByText('Security')).toBeInTheDocument();
  });
});
