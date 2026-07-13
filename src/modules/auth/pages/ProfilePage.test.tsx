import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { addTranslations, i18next, initI18n, setLanguage } from '@core/i18n';
import { deployTranslations } from '@app';
import { registerBaseComponents } from '@core/renderer';
import { registerModule, resetRegistry } from '@core/module-registry';
import { resetComponents, resetSchemas } from '@core/schema';
import { realmProvider, useAuthStore } from '@core/auth';
import { contractRegistry } from '@core/contracts';
import { authModule } from '@modules/auth';
import { getUserInfo } from '../api/authApi';
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
  // Подписи кабинетов живут в deploy-слое (в проде их ставит registerAllModules).
  addTranslations(deployTranslations);
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

describe('ProfilePage (кабинеты)', () => {
  const REALMS = [
    {
      name: 'print-shop/standard',
      user_kind: 'standard',
      created_at: '2025-01-10T09:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
    {
      name: 'print-shop/admin',
      user_kind: 'staff',
      created_at: '2025-03-02T14:30:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
  ];

  const accountCard = () =>
    screen.getByText('Учётная запись').closest('.MuiCard-root') as HTMLElement;

  it('один кабинет: тип аккаунта в «Учётной записи», карточки «Кабинеты» нет', async () => {
    await i18next.changeLanguage('ru');
    renderProfile();
    await screen.findByText('Учётная запись');

    // Единственный кабинет — выбирать не из чего, слова «кабинет» на экране быть не должно.
    expect(screen.queryByText('Кабинеты')).toBeNull();
    expect(within(accountCard()).getByText('Тип аккаунта')).toBeInTheDocument();
    expect(within(accountCard()).getByText('Зарегистрирован')).toBeInTheDocument();
    // user_kind 'customer' не переведён — показываем как есть, а не ключом auth.userKind.customer.
    expect(within(accountCard()).getByText('customer')).toBeInTheDocument();
  });

  it('несколько кабинетов: карточка «Кабинеты» сразу после «Учётной записи», строки из неё убраны', async () => {
    await i18next.changeLanguage('ru');
    const info = await vi.mocked(getUserInfo)();
    vi.mocked(getUserInfo).mockResolvedValueOnce({ ...info, realms: REALMS });

    const { container } = renderProfile();
    await screen.findByText('Кабинеты');

    // Эти строки переехали в таблицу кабинетов — в «Учётной записи» их больше нет.
    expect(within(accountCard()).queryByText('Тип аккаунта')).toBeNull();
    expect(within(accountCard()).queryByText('Зарегистрирован')).toBeNull();

    const titles = [...container.querySelectorAll('.MuiCard-root')].map(
      (card) => card.querySelector('.MuiTypography-subtitle2')?.textContent,
    );
    expect(titles).toEqual(['Учётная запись', 'Кабинеты', 'Безопасность', 'Активность']);

    expect(screen.getByText('Клиентский')).toBeInTheDocument();
    expect(screen.getByText('Служебный')).toBeInTheDocument();
    expect(screen.getByText('Сотрудник')).toBeInTheDocument();
    expect(screen.queryByText('print-shop/admin')).toBeNull();
  });
});
