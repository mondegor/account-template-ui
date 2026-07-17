import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { addTranslations, formatDateTimeLong, i18next, initI18n, setLanguage } from '@core/i18n';
import { deployTranslations } from '@app';
import { registerBaseComponents } from '@core/renderer';
import { registerModule, resetRegistry } from '@core/module-registry';
import { resetComponents, resetSchemas } from '@core/schema';
import { realmProvider, useAuthStore } from '@core/auth';
import { contractRegistry } from '@core/contracts';
import { authModule } from '@modules/auth';
import { cardWith, rowValue } from '../../../test/dom';
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
    auth_2fa_type: 'NONE',
    realms: [
      {
        name: 'shop',
        user_kind: 'customer',
        last_location: 'Moscow, RU',
        last_logged_at: '2026-07-01T10:00:00Z',
        created_at: '2026-07-01T10:00:00Z',
        updated_at: '2026-07-02T11:00:00Z',
      },
    ],
    status: 'ENABLED',
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

/** Подменяет ответ getUserInfo на один рендер, оставляя остальные поля базовой фикстуры. */
async function withRealms(realms: unknown[]) {
  const info = await vi.mocked(getUserInfo)();
  vi.mocked(getUserInfo).mockResolvedValueOnce({
    ...info,
    realms: realms as (typeof info)['realms'],
  });
}

// cardWith ищет карточку по заголовку: ссылку «Сессии» ищем только внутри карточки — в навигации
// AppShell есть своя одноимённая ссылка на /sessions, и глобальный поиск по роли захватил бы обе.

describe('ProfilePage (i18n)', () => {
  it('ru: подписи из auth.profile.*', async () => {
    await i18next.changeLanguage('ru');
    renderProfile();
    expect(await screen.findByText('Личные данные')).toBeInTheDocument();
    expect(screen.getByText('Учётная запись')).toBeInTheDocument();
    expect(screen.getByText('Телефон')).toBeInTheDocument();
    expect(screen.getByText('Безопасность')).toBeInTheDocument();
  });

  it('«Зарегистрирован» выводит только дату', async () => {
    await i18next.changeLanguage('ru');
    renderProfile();
    await screen.findByText('Зарегистрирован');
    expect(rowValue('Зарегистрирован')?.textContent).toBe(
      new Date('2026-07-01T10:00:00Z').toLocaleDateString('ru-RU'),
    );
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
      await screen.findByText('Последний вход');
      const value = rowValue('Последний вход');
      expect(value?.textContent).toBe('5 минут назад');
      // Формат title — забота formatDateTimeLong и её тестов (relativeTime.test); здесь проверяем
      // только проводку значения, поэтому эталон берём из той же функции, а не собираем руками.
      expect(value?.getAttribute('title')).toBe(
        formatDateTimeLong(new Date('2026-07-01T10:00:00Z'), 'ru-RU'),
      );
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('en: подписи переключаются на английский', async () => {
    await i18next.changeLanguage('en');
    renderProfile();
    expect(await screen.findByText('Personal info')).toBeInTheDocument();
    expect(screen.getByText('Account')).toBeInTheDocument();
    expect(screen.getByText('Phone')).toBeInTheDocument();
    expect(screen.getByText('Security')).toBeInTheDocument();
  });
});

describe('ProfilePage (данные кабинета)', () => {
  const accountCard = () => cardWith('Учётная запись');

  it('один кабинет: его данные в «Учётной записи», имя реалма наружу не течёт', async () => {
    await i18next.changeLanguage('ru');
    renderProfile();
    await screen.findByText('Учётная запись');

    // Единственный кабинет — выбирать не из чего: заголовок нейтральный, названия кабинета нет.
    // Реалм фикстуры зовётся 'shop', перевода deploy.realmLabel.shop нет — значит регресс на
    // realmLabel для одиночного случая вывел бы сырое 'shop' заголовком. Зеркало проверки из
    // мультиреалм-теста, где наоборот запрещена нейтральная «Учётная запись».
    expect(screen.queryByText('shop')).toBeNull();
    expect(within(accountCard()).getByText('Тип аккаунта')).toBeInTheDocument();
    expect(within(accountCard()).getByText('Зарегистрирован')).toBeInTheDocument();
    // user_kind 'customer' не переведён — показываем как есть, а не ключом deploy.userKind.customer.
    expect(within(accountCard()).getByText('customer')).toBeInTheDocument();
  });

  it('«Локация последнего входа» показывает значение реалма', async () => {
    await i18next.changeLanguage('ru');
    renderProfile();
    await screen.findByText('Локация последнего входа');
    expect(rowValue('Локация последнего входа')?.textContent).toBe('Moscow, RU');
  });

  it('нет last_location / last_logged_at → прочерки', async () => {
    await i18next.changeLanguage('ru');
    await withRealms([
      {
        name: 'shop',
        user_kind: 'customer',
        created_at: '2026-07-01T10:00:00Z',
        updated_at: '2026-07-02T11:00:00Z',
      },
    ]);
    renderProfile();
    await screen.findByText('Локация последнего входа');
    expect(rowValue('Локация последнего входа')?.textContent).toBe('—');
    expect(rowValue('Последний вход')?.textContent).toBe('—');
  });

  it('пустая строка в last_location → прочерк, а не пустое место', async () => {
    await i18next.changeLanguage('ru');
    await withRealms([
      {
        name: 'shop',
        user_kind: 'customer',
        last_location: '',
        created_at: '2026-07-01T10:00:00Z',
        updated_at: '2026-07-02T11:00:00Z',
      },
    ]);
    renderProfile();
    await screen.findByText('Локация последнего входа');
    expect(rowValue('Локация последнего входа')?.textContent).toBe('—');
  });

  it('тип аккаунта показывается чипом', async () => {
    await i18next.changeLanguage('ru');
    renderProfile();
    await screen.findByText('Учётная запись');

    const kind = within(accountCard()).getByText('customer');
    expect(kind.closest('.MuiChip-root')).not.toBeNull();
    expect(kind.textContent).toBe('customer');
  });

  it('единственная карточка не выделяется рамкой, даже когда это кабинет деплоя', async () => {
    await i18next.changeLanguage('ru');
    // Кабинет совпадает с реалмом деплоя (config.realm) — но карточка одна, выделять не из чего.
    await withRealms([
      {
        name: 'print-shop/standard',
        user_kind: 'customer',
        created_at: '2026-07-01T10:00:00Z',
        updated_at: '2026-07-02T11:00:00Z',
      },
    ]);
    renderProfile();
    await screen.findByText('Учётная запись');
    expect(cardWith('Учётная запись')).not.toHaveStyle({ borderWidth: '2px' });
  });

  it('ссылка «Сессии» ведёт на сессии своего кабинета', async () => {
    await i18next.changeLanguage('ru');
    renderProfile();
    await screen.findByText('Учётная запись');
    // Доступное имя уточнено и в одиночном кабинете: видимый текст «Сессии» совпадает с пунктом
    // меню AppShell при другом href, и без aria-label скринридер видел бы две одинаковые ссылки.
    // Глобальный поиск по имени как раз закрепляет отсутствие коллизии.
    const link = screen.getByRole('link', { name: 'Сессии учётной записи' });
    expect(link).toHaveAttribute('href', '/sessions?realm=shop');
  });
});

describe('ProfilePage (несколько кабинетов)', () => {
  const REALMS = [
    {
      name: 'print-shop/standard',
      user_kind: 'standard',
      last_location: 'Moscow, RU',
      last_logged_at: '2026-07-01T10:00:00Z',
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

  it('на каждый кабинет свой блок, заголовок — пользовательское название кабинета', async () => {
    await i18next.changeLanguage('ru');
    await withRealms(REALMS);

    const { container } = renderProfile();
    await screen.findByText('Клиентский');

    const titles = [...container.querySelectorAll('.MuiCard-root')].map(
      (card) => card.querySelector('.MuiTypography-subtitle2')?.textContent,
    );
    expect(titles).toEqual(['Личные данные', 'Клиентский', 'Служебный', 'Безопасность']);

    // Нейтральный заголовок — только когда кабинет один; сырое имя реалма наружу не течёт.
    expect(screen.queryByText('Учётная запись')).toBeNull();
    expect(screen.queryByText('print-shop/admin')).toBeNull();
    // Тип аккаунта — из deploy.userKind, он свой у каждого кабинета и не перепутан между блоками.
    expect(within(cardWith('Клиентский')).getByText('Стандартный')).toBeInTheDocument();
    expect(within(cardWith('Служебный')).getByText('Сотрудник')).toBeInTheDocument();
  });

  it('карточка кабинета текущей сессии выделена рамкой, остальные — нет', async () => {
    await i18next.changeLanguage('ru');
    await withRealms(REALMS);
    renderProfile();
    await screen.findByText('Клиентский');

    // «Клиентский» (print-shop/standard) — реалм деплоя, т.е. кабинет текущей сессии.
    expect(cardWith('Клиентский')).toHaveStyle({ borderWidth: '2px' });
    expect(cardWith('Служебный')).not.toHaveStyle({ borderWidth: '2px' });
  });

  it('ссылка «Сессии» в каждом блоке ведёт в свой кабинет', async () => {
    await i18next.changeLanguage('ru');
    await withRealms(REALMS);
    renderProfile();
    await screen.findByText('Клиентский');

    // Видимый текст ссылок один — «Сессии»; различает их доступное имя с названием кабинета, так
    // что глобальный поиск по роли находит каждую однозначно (иначе скринридеру — «Сессии, Сессии»).
    expect(
      screen.getByRole('link', { name: 'Сессии кабинета «Клиентский»' }),
    ).toHaveAttribute('href', '/sessions?realm=print-shop%2Fstandard');
    expect(
      screen.getByRole('link', { name: 'Сессии кабинета «Служебный»' }),
    ).toHaveAttribute('href', '/sessions?realm=print-shop%2Fadmin');
  });
});
