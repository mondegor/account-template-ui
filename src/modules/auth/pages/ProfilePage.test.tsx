import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  addTranslations,
  formatDateTimeLong,
  i18next,
  initI18n,
  setLanguage,
  toLocale,
} from '@core/i18n';
import { deployTranslations } from '@app';
import { registerBaseComponents } from '@core/renderer';
import { registerModule, resetRegistry } from '@core/module-registry';
import { resetComponents, resetSchemas } from '@core/schema';
import { realmProvider, useAuthStore } from '@core/auth';
import { contractRegistry } from '@core/contracts';
import { authModule } from '@modules/auth';
import { cardWith, rowValue } from '../../../test/dom';
import { tr } from '../../../test/i18n';
import { getUserInfo } from '../api/authApi';
import { ProfilePage } from './ProfilePage';

/**
 * ProfilePage не содержит хардкод-строк: подписи резолвятся из `auth.profile.*`, поэтому при
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
  setLanguage('en');
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
  it('the labels come from auth.profile.*', async () => {
    await i18next.changeLanguage('en');
    renderProfile();
    expect(await screen.findByText(tr('auth.profile.personalInfo'))).toBeInTheDocument();
    expect(screen.getByText(tr('auth.profile.account'))).toBeInTheDocument();
    expect(screen.getByText(tr('auth.profile.phone'))).toBeInTheDocument();
    expect(screen.getByText(tr('auth.profile.twoFa.NONE.title'))).toBeInTheDocument();
  });

  it('«registered» shows the date alone, in the profile time zone', async () => {
    await i18next.changeLanguage('en');
    renderProfile();
    await screen.findByText(tr('auth.profile.registeredAt'));
    expect(rowValue(tr('auth.profile.registeredAt'))?.textContent).toBe(
      new Date('2026-07-01T10:00:00Z').toLocaleDateString(toLocale(i18next.language), {
        timeZone: PROFILE_TZ,
      }),
    );
  });

  it('«last login» shows relative time, with the exact one in the title', async () => {
    // now = last_logged_at (2026-07-01T10:00:00Z) + 5 минут → «5 минут назад» на языке интерфейса.
    // Мокаем только Date.now (его читает useNow), чтобы не ломать поллинг findByText fake-таймерами.
    const nowSpy = vi
      .spyOn(Date, 'now')
      .mockReturnValue(new Date('2026-07-01T10:05:00Z').getTime());
    try {
      await i18next.changeLanguage('en');
      renderProfile();
      await screen.findByText(tr('auth.profile.lastLogin'));
      const value = rowValue(tr('auth.profile.lastLogin'));
      expect(value?.textContent).toBe('5 minutes ago');
      // Формат title — забота formatDateTimeLong и её тестов (relativeTime.test); здесь проверяем
      // только проводку значения, поэтому эталон берём из той же функции, а не собираем руками.
      // Пояс — из профиля (не браузера): в этом и смысл проводки timeZone до TimeRow.
      expect(value?.getAttribute('title')).toBe(
        formatDateTimeLong(
          new Date('2026-07-01T10:00:00Z'),
          toLocale(i18next.language),
          PROFILE_TZ,
        ),
      );
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('a profile zone unknown to the browser ICU does not break the page', async () => {
    // Имя приходит из справочника сервера, а форматирует ICU браузера — списки не обязаны
    // совпадать (переименования приезжают с задержкой). Без resolveTimeZone одна такая зона
    // роняла бы RangeError-ом весь профиль, а не одну строку.
    const info = await vi.mocked(getUserInfo)();
    vi.mocked(getUserInfo).mockResolvedValueOnce({ ...info, tz: 'Foo/Bar' });

    await i18next.changeLanguage('en');
    renderProfile();

    expect(await screen.findByText(tr('auth.profile.personalInfo'))).toBeInTheDocument();
    // Даты отрисованы — в поясе браузера, как фолбэк.
    expect(rowValue(tr('auth.profile.registeredAt'))?.textContent).toBe(
      new Date('2026-07-01T10:00:00Z').toLocaleDateString(toLocale(i18next.language)),
    );
  });

  it('the labels follow a language switch', async () => {
    await i18next.changeLanguage('ru');
    // Ключи те же, что и в кейсе выше: сравнение с фиксированным словарём другого языка
    // закрепляет, что подписи и правда разъезжаются, — иначе захардкоженная строка прошла бы
    // обе проверки.
    const en = i18next.getFixedT('en');
    expect(tr('auth.profile.personalInfo')).not.toBe(en('auth.profile.personalInfo'));

    renderProfile();
    expect(await screen.findByText(tr('auth.profile.personalInfo'))).toBeInTheDocument();
    expect(screen.getByText(tr('auth.profile.account'))).toBeInTheDocument();
    expect(screen.getByText(tr('auth.profile.phone'))).toBeInTheDocument();
    expect(screen.getByText(tr('auth.profile.twoFa.NONE.title'))).toBeInTheDocument();
  });
});

describe('ProfilePage (language and time zone)', () => {
  const personalCard = () => cardWith(tr('auth.profile.personalInfo'));

  beforeEach(async () => {
    setLanguage('en');
    await i18next.changeLanguage('en');
  });

  it('the language is shown by name, the raw locale sits in the tooltip', async () => {
    renderProfile();
    await screen.findByText(tr('auth.profile.personalInfo'));

    // На экране «Русский», а не ru-RU: техническое значение прячем в title (он на обёртке
    // значения — у строки языка значение это узел с флагом, а не просто текст).
    // «Русский» — эндоним: справочник языков хранит подпись каждого языка на нём самом, поэтому
    // она остаётся кириллицей при любом языке интерфейса и переводу не подлежит.
    expect(rowValue(tr('auth.profile.lang'))?.textContent).toBe('Русский');
    expect(within(personalCard() as HTMLElement).getByTitle('ru-RU')).toBeInTheDocument();
  });

  it('the time zone is shown by its registry label, the IANA name sits in the tooltip', async () => {
    renderProfile();
    await screen.findByText(tr('auth.profile.personalInfo'));

    expect(rowValue(tr('auth.profile.tz'))?.textContent).toBe('(UTC+03:00) Moscow, St. Petersburg');
    expect(rowValue(tr('auth.profile.tz'))?.getAttribute('title')).toBe(PROFILE_TZ);
  });

  it('a language and a zone unknown to the client: the language as is, the zone with a computed offset', async () => {
    const info = await vi.mocked(getUserInfo)();
    vi.mocked(getUserInfo).mockResolvedValueOnce({
      ...info,
      lang: 'de-DE',
      tz: 'Antarctica/Troll',
    });
    renderProfile();
    await screen.findByText(tr('auth.profile.personalInfo'));

    // Бэк мог завести язык или зону, которых во фронте ещё нет — врать про них нельзя.
    // Языку подписи взять неоткуда, поэтому сырая локаль; зоне смещение считает timeZoneLabel,
    // и выглядит она как остальные пункты — здесь и в селекте настроек одинаково.
    expect(rowValue(tr('auth.profile.lang'))?.textContent).toBe('de-DE');
    expect(rowValue(tr('auth.profile.tz'))?.textContent).toBe('(UTC+00:00) Antarctica/Troll');
  });

  it('a zone Intl cannot use: the tooltip states honestly which zone the dates are in', async () => {
    // Строка показывает зону профиля, а даты рядом уходят в пояс браузера — молчать об этом
    // нельзя, иначе страница утверждает один пояс, а рисует время в другом.
    const info = await vi.mocked(getUserInfo)();
    vi.mocked(getUserInfo).mockResolvedValueOnce({ ...info, tz: 'Foo/Bar' });
    renderProfile();
    await screen.findByText(tr('auth.profile.personalInfo'));

    expect(rowValue(tr('auth.profile.tz'))?.getAttribute('title')).toBe(
      `Foo/Bar — ${tr('auth.profile.tzUnsupported')}`,
    );
  });

  it('the «settings» link in the card goes to /settings', async () => {
    renderProfile();
    await screen.findByText(tr('auth.profile.personalInfo'));

    // Ищем внутри карточки: в навигации AppShell есть одноимённый пункт.
    const link = within(personalCard() as HTMLElement).getByRole('link', {
      name: tr('auth.profile.settingsAria'),
    });
    expect(link).toHaveAttribute('href', '/settings');
  });
});

describe('ProfilePage (realm data)', () => {
  const accountCard = () => cardWith(tr('auth.profile.account'));

  it('a single realm: its data sits in «account», the realm name does not leak out', async () => {
    await i18next.changeLanguage('en');
    renderProfile();
    await screen.findByText(tr('auth.profile.account'));

    // Единственный кабинет — выбирать не из чего: заголовок нейтральный, названия кабинета нет.
    // Реалм фикстуры зовётся 'shop', перевода deploy.realmLabel.shop нет — значит регресс на
    // realmLabel для одиночного случая вывел бы сырое 'shop' заголовком. Зеркало проверки из
    // мультиреалм-теста, где наоборот запрещена нейтральная «Учётная запись».
    expect(screen.queryByText('shop')).toBeNull();
    expect(within(accountCard()).getByText(tr('auth.profile.accountKind'))).toBeInTheDocument();
    expect(within(accountCard()).getByText(tr('auth.profile.registeredAt'))).toBeInTheDocument();
    // user_kind 'customer' не переведён — показываем как есть, а не ключом deploy.userKind.customer.
    expect(within(accountCard()).getByText('customer')).toBeInTheDocument();
  });

  it('«last login location» shows the realm value', async () => {
    await i18next.changeLanguage('en');
    renderProfile();
    await screen.findByText(tr('auth.profile.lastLocation'));
    expect(rowValue(tr('auth.profile.lastLocation'))?.textContent).toBe('Moscow, RU');
  });

  it('no last_location or last_logged_at: dashes', async () => {
    await i18next.changeLanguage('en');
    await withRealms([
      {
        name: 'shop',
        user_kind: 'customer',
        created_at: '2026-07-01T10:00:00Z',
        updated_at: '2026-07-02T11:00:00Z',
      },
    ]);
    renderProfile();
    await screen.findByText(tr('auth.profile.lastLocation'));
    expect(rowValue(tr('auth.profile.lastLocation'))?.textContent).toBe('—');
    expect(rowValue(tr('auth.profile.lastLogin'))?.textContent).toBe('—');
  });

  it('an empty string in last_location gives a dash, not a blank', async () => {
    await i18next.changeLanguage('en');
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
    await screen.findByText(tr('auth.profile.lastLocation'));
    expect(rowValue(tr('auth.profile.lastLocation'))?.textContent).toBe('—');
  });

  it('the account kind is shown as a chip', async () => {
    await i18next.changeLanguage('en');
    renderProfile();
    await screen.findByText(tr('auth.profile.account'));

    const kind = within(accountCard()).getByText('customer');
    expect(kind.closest('.MuiChip-root')).not.toBeNull();
    expect(kind.textContent).toBe('customer');
  });

  it('a lone card is not marked «current», even when it is the deployment realm', async () => {
    await i18next.changeLanguage('en');
    // Кабинет совпадает с реалмом деплоя (config.realm) — но карточка одна, выделять не из чего.
    await withRealms([
      {
        name: 'account-template/standard',
        user_kind: 'customer',
        created_at: '2026-07-01T10:00:00Z',
        updated_at: '2026-07-02T11:00:00Z',
      },
    ]);
    renderProfile();
    await screen.findByText(tr('auth.profile.account'));
    expect(screen.queryByText(tr('auth.profile.currentRealm'))).toBeNull();
  });

  it('the «sessions» link goes to the sessions of its own realm', async () => {
    await i18next.changeLanguage('en');
    renderProfile();
    await screen.findByText(tr('auth.profile.account'));
    // Доступное имя уточнено и в одиночном кабинете: видимый текст «Сессии» совпадает с пунктом
    // меню AppShell при другом href, и без aria-label скринридер видел бы две одинаковые ссылки.
    // Глобальный поиск по имени как раз закрепляет отсутствие коллизии.
    const link = screen.getByRole('link', { name: tr('auth.profile.sessionsOfAccount') });
    expect(link).toHaveAttribute('href', '/sessions?realm=shop');
  });
});

describe('ProfilePage (several realms)', () => {
  const REALMS = [
    {
      name: 'account-template/standard',
      user_kind: 'standard',
      last_location: 'Moscow, RU',
      last_logged_at: '2026-07-01T10:00:00Z',
      created_at: '2025-01-10T09:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
    {
      name: 'account-template/admin',
      user_kind: 'employee',
      created_at: '2025-03-02T14:30:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
  ];

  it('every realm gets its own block, titled with the user-facing realm name', async () => {
    await i18next.changeLanguage('en');
    await withRealms(REALMS);

    const { container } = renderProfile();
    await screen.findByText(tr('deploy.realmLabel.account-template/standard'));

    const titles = [...container.querySelectorAll('.MuiCard-root')].map(
      (card) => card.querySelector('.MuiTypography-subtitle2')?.textContent,
    );
    expect(titles).toEqual([
      tr('auth.profile.personalInfo'),
      tr('deploy.realmLabel.account-template/standard'),
      tr('deploy.realmLabel.account-template/admin'),
    ]);

    // Нейтральный заголовок — только когда кабинет один; сырое имя реалма наружу не течёт.
    expect(screen.queryByText(tr('auth.profile.account'))).toBeNull();
    expect(screen.queryByText('account-template/admin')).toBeNull();
    // Тип аккаунта — из deploy.userKind, он свой у каждого кабинета и не перепутан между блоками.
    expect(
      within(cardWith(tr('deploy.realmLabel.account-template/standard'))).getByText(
        tr('deploy.userKind.standard'),
      ),
    ).toBeInTheDocument();
    expect(
      within(cardWith(tr('deploy.realmLabel.account-template/admin'))).getByText(
        tr('deploy.userKind.employee'),
      ),
    ).toBeInTheDocument();
  });

  it('the realm card of the current session is marked, the others are not', async () => {
    await i18next.changeLanguage('en');
    await withRealms(REALMS);
    renderProfile();
    await screen.findByText(tr('deploy.realmLabel.account-template/standard'));

    // «Клиентский» (account-template/standard) — реалм деплоя, т.е. кабинет текущей сессии.
    expect(
      within(cardWith(tr('deploy.realmLabel.account-template/standard'))).getByText(
        tr('auth.profile.currentRealm'),
      ),
    ).toBeInTheDocument();
    expect(
      within(cardWith(tr('deploy.realmLabel.account-template/admin'))).queryByText(
        tr('auth.profile.currentRealm'),
      ),
    ).toBeNull();
  });

  it('the «sessions» link in each block goes to its own realm', async () => {
    await i18next.changeLanguage('en');
    await withRealms(REALMS);
    renderProfile();
    await screen.findByText(tr('deploy.realmLabel.account-template/standard'));

    // Видимый текст ссылок один — «Сессии»; различает их доступное имя с названием кабинета, так
    // что глобальный поиск по роли находит каждую однозначно (иначе скринридеру — «Сессии, Сессии»).
    const sessionsOf = (realm: string) =>
      tr('auth.profile.sessionsOf', { realm: tr(`deploy.realmLabel.${realm}`) });

    expect(
      screen.getByRole('link', { name: sessionsOf('account-template/standard') }),
    ).toHaveAttribute('href', '/sessions?realm=account-template%2Fstandard');
    expect(
      screen.getByRole('link', { name: sessionsOf('account-template/admin') }),
    ).toHaveAttribute('href', '/sessions?realm=account-template%2Fadmin');
  });
});

/** Профиль с заданной ступенью защиты; остаток кодов приходит только при включённой 2FA. */
async function with2fa(type: 'NONE' | 'PASSWORD' | 'TOTP', recoveryCodesLeft?: number) {
  const info = await vi.mocked(getUserInfo)();
  vi.mocked(getUserInfo).mockResolvedValueOnce({
    ...info,
    auth_2fa_type: type,
    ...(recoveryCodesLeft === undefined ? {} : { recovery_codes_left: recoveryCodesLeft }),
  });
}

describe('ProfilePage (account protection)', () => {
  beforeEach(async () => {
    setLanguage('en');
    await i18next.changeLanguage('en');
  });

  // Полоса живёт в карточке «Личные данные», поэтому ищем внутри карточки, а не глобально.
  const personalCard = () => cardWith(tr('auth.profile.personalInfo'));

  it.each(['NONE', 'PASSWORD', 'TOTP'] as const)(
    '%s: its own state and its own call to action',
    async (type) => {
      await with2fa(type, type === 'NONE' ? undefined : 8);
      renderProfile();
      await screen.findByText(tr(`auth.profile.twoFa.${type}.title`));

      expect(
        within(personalCard()).getByText(tr(`auth.profile.twoFa.${type}.cta`)),
      ).toBeInTheDocument();
    },
  );

  it('the strip leads to the settings', async () => {
    renderProfile();
    await screen.findByText(tr('auth.profile.twoFa.NONE.title'));

    // Адрес тот же, что у ссылки в заголовке карточки, поэтому идём от самого призыва: список
    // ссылок карточки был бы полон и без полосы.
    const cta = within(personalCard()).getByText(tr('auth.profile.twoFa.NONE.cta'));
    expect(cta.closest('a')).toHaveAttribute('href', '/settings');
  });
});

/** Строка предупреждения об остатке кодов: ищем её как элемент, а не по тексту подписи. */
const WARNING = 'two-fa-codes-warning';

describe('ProfilePage (recovery codes left)', () => {
  beforeEach(async () => {
    setLanguage('en');
    await i18next.changeLanguage('en');
  });

  /** Ждём саму полосу: её заголовок одинаков во всех случаях ниже, меняется только строка кодов. */
  const findStrip = () => screen.findByText(tr('auth.profile.twoFa.TOTP.title'));

  it.each([
    [0, 'recoveryCodesEmpty'],
    [1, 'recoveryCodesLast'],
    [3, 'recoveryCodesLow'],
  ] as const)('%i left: the warning is shown', async (left, key) => {
    await with2fa('TOTP', left);
    renderProfile();
    await findStrip();

    expect(screen.getByTestId(WARNING).textContent).toBe(
      tr(`auth.profile.${key}`, { count: left }),
    );
  });

  // Порог проверяем по границе: 4 — первое значение, на котором предупреждать уже не о чем.
  it.each([4, 8])('%i left: no warning at all', async (left) => {
    await with2fa('TOTP', left);
    renderProfile();
    await findStrip();

    expect(screen.queryByTestId(WARNING)).toBeNull();
  });

  it('with the field absent (2FA off) there is no warning: «no data» is not zero here', async () => {
    renderProfile();
    await screen.findByText(tr('auth.profile.twoFa.NONE.title'));

    expect(screen.queryByTestId(WARNING)).toBeNull();
  });

  it('running-low codes do not change the strip itself: that is a different event', async () => {
    await with2fa('TOTP', 0);
    renderProfile();
    await findStrip();

    // Заголовок и призыв те же, что и при полном запасе: остаток кодов трогает только свою строку.
    expect(screen.getByText(tr('auth.profile.twoFa.TOTP.hint'))).toBeInTheDocument();
    expect(screen.getByText(tr('auth.profile.twoFa.TOTP.cta'))).toBeInTheDocument();
  });
});
