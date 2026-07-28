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
/** Пояс профиля фикстуры: даты на экране обязаны считаться по нему, а не по зоне процесса. */
const PROFILE_TZ = 'Europe/Moscow';

vi.mock('../api/authApi', () => ({
  getUserInfo: vi.fn(async () => ({
    email: 'user@example.com',
    phone: '+7 900 000-00-00',
    lang: 'ru-RU',
    tz: 'Europe/Moscow',
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

  it('«Зарегистрирован» выводит только дату, в поясе профиля', async () => {
    await i18next.changeLanguage('ru');
    renderProfile();
    await screen.findByText('Зарегистрирован');
    expect(rowValue('Зарегистрирован')?.textContent).toBe(
      new Date('2026-07-01T10:00:00Z').toLocaleDateString('ru-RU', { timeZone: PROFILE_TZ }),
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
      // Пояс — из профиля (не браузера): в этом и смысл проводки timeZone до TimeRow.
      expect(value?.getAttribute('title')).toBe(
        formatDateTimeLong(new Date('2026-07-01T10:00:00Z'), 'ru-RU', PROFILE_TZ),
      );
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('зона профиля, неизвестная ICU браузера, не роняет страницу', async () => {
    // Имя приходит из справочника сервера, а форматирует ICU браузера — списки не обязаны
    // совпадать (переименования приезжают с задержкой). Без resolveTimeZone одна такая зона
    // роняла бы RangeError-ом весь профиль, а не одну строку.
    const info = await vi.mocked(getUserInfo)();
    vi.mocked(getUserInfo).mockResolvedValueOnce({ ...info, tz: 'Foo/Bar' });

    await i18next.changeLanguage('ru');
    renderProfile();

    expect(await screen.findByText('Личные данные')).toBeInTheDocument();
    // Даты отрисованы — в поясе браузера, как фолбэк.
    expect(rowValue('Зарегистрирован')?.textContent).toBe(
      new Date('2026-07-01T10:00:00Z').toLocaleDateString('ru-RU'),
    );
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

describe('ProfilePage (язык и часовой пояс)', () => {
  const personalCard = () => cardWith('Личные данные');

  beforeEach(async () => {
    setLanguage('ru');
    await i18next.changeLanguage('ru');
  });

  it('язык показан названием, сырая локаль — в подсказке', async () => {
    renderProfile();
    await screen.findByText('Личные данные');

    // На экране «Русский», а не ru-RU: техническое значение прячем в title (он на обёртке
    // значения — у строки языка значение это узел с флагом, а не просто текст).
    expect(rowValue('Язык')?.textContent).toBe('Русский');
    expect(within(personalCard() as HTMLElement).getByTitle('ru-RU')).toBeInTheDocument();
  });

  it('часовой пояс показан подписью из справочника, IANA-имя — в подсказке', async () => {
    renderProfile();
    await screen.findByText('Личные данные');

    expect(rowValue('Часовой пояс')?.textContent).toBe('(UTC+03:00) Москва, Санкт-Петербург');
    expect(rowValue('Часовой пояс')?.getAttribute('title')).toBe(PROFILE_TZ);
  });

  it('незнакомые фронту язык и зона: язык как есть, зона — с посчитанным смещением', async () => {
    const info = await vi.mocked(getUserInfo)();
    vi.mocked(getUserInfo).mockResolvedValueOnce({
      ...info,
      lang: 'de-DE',
      tz: 'Antarctica/Troll',
    });
    renderProfile();
    await screen.findByText('Личные данные');

    // Бэк мог завести язык или зону, которых во фронте ещё нет — врать про них нельзя.
    // Языку подписи взять неоткуда, поэтому сырая локаль; зоне смещение считает timeZoneLabel,
    // и выглядит она как остальные пункты — здесь и в селекте настроек одинаково.
    expect(rowValue('Язык')?.textContent).toBe('de-DE');
    expect(rowValue('Часовой пояс')?.textContent).toBe('(UTC+00:00) Antarctica/Troll');
  });

  it('зона, непригодная для Intl: подсказка честно говорит, в каком поясе даты', async () => {
    // Строка показывает зону профиля, а даты рядом уходят в пояс браузера — молчать об этом
    // нельзя, иначе страница утверждает один пояс, а рисует время в другом.
    const info = await vi.mocked(getUserInfo)();
    vi.mocked(getUserInfo).mockResolvedValueOnce({ ...info, tz: 'Foo/Bar' });
    renderProfile();
    await screen.findByText('Личные данные');

    expect(rowValue('Часовой пояс')?.getAttribute('title')).toBe(
      'Foo/Bar — этот пояс не знает браузер, даты показаны в поясе устройства',
    );
  });

  it('ссылка «Настройки» из карточки ведёт на /settings', async () => {
    renderProfile();
    await screen.findByText('Личные данные');

    // Ищем внутри карточки: в навигации AppShell есть одноимённый пункт.
    const link = within(personalCard() as HTMLElement).getByRole('link', { name: /Настройки/ });
    expect(link).toHaveAttribute('href', '/settings');
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
    expect(screen.getByRole('link', { name: 'Сессии кабинета «Клиентский»' })).toHaveAttribute(
      'href',
      '/sessions?realm=print-shop%2Fstandard',
    );
    expect(screen.getByRole('link', { name: 'Сессии кабинета «Служебный»' })).toHaveAttribute(
      'href',
      '/sessions?realm=print-shop%2Fadmin',
    );
  });
});
