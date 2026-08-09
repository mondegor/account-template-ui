import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { addTranslations, i18next, initI18n, setLanguage } from '@core/i18n';
import { deployTranslations } from '@app';
import { ApiFieldError } from '@core/api';
import { registerBaseComponents } from '@core/renderer';
import { moduleQueryKey, registerModule, resetRegistry } from '@core/module-registry';
import { resetComponents, resetSchemas } from '@core/schema';
import { realmProvider, useAuthStore } from '@core/auth';
import { contractRegistry } from '@core/contracts';
import { authModule } from '@modules/auth';
import { changeUserSettings, getUserInfo } from '../api/authApi';
import type { UserInfo } from '../api/types';
import { SettingsPage } from './SettingsPage';
import { tr } from '../../../test/i18n';

/**
 * Форма настроек: что показано (префилл, плашки) и что уходит на сервер (тело запроса).
 * API мокаем целиком — транспорт проверяется отдельно (settingsTransport.test.ts).
 */

/** Detail от серверной стороны: подсветка поля берёт его текст как есть, минуя переводы. */
const TZ_DETAIL = 'Time zone is not supported';

/** Плашки после сохранения ищем как элементы, а не по их длинным подписям. */
const SAVED = 'settings-saved';
const SUBSTITUTED = 'settings-substituted';

/**
 * Зону ОС фиксируем: предупреждение о подменённой зоне сравнивает её с сохранённой, и без этого
 * результат зависел бы от часового пояса машины, на которой гоняют тесты. Остальной @core/i18n —
 * настоящий: справочники и вычисления смещений и есть предмет проверки.
 */
vi.mock('@core/i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@core/i18n')>()),
  getOsTimeZone: () => 'UTC',
}));

vi.mock('../api/authApi', () => ({
  getUserInfo: vi.fn(),
  changeUserSettings: vi.fn(),
  signin: vi.fn(),
  signup: vi.fn(),
  checkLogin: vi.fn(),
  openSession: vi.fn(),
  confirmOperation: vi.fn(),
  resendOperation: vi.fn(),
  revokeOperation: vi.fn(),
  getUserSessions: vi.fn(),
  closeUserSessions: vi.fn(),
}));

const PROFILE: UserInfo = {
  email: 'user@example.com',
  lang: 'ru-RU',
  tz: 'Europe/Moscow',
  auth_2fa_type: 'NONE',
  realms: [{ name: 'print-shop/standard', user_kind: 'standard', created_at: '', updated_at: '' }],
  status: 'ENABLED',
};

beforeAll(() => {
  setLanguage('en');
  initI18n();
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

beforeEach(async () => {
  await i18next.changeLanguage('en');
  vi.mocked(getUserInfo).mockResolvedValue(PROFILE);
  vi.mocked(changeUserSettings).mockReset();
});

afterEach(cleanup);

function renderSettings(
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) {
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

/**
 * Выбор в MUI-селекте: он открывается по mouseDown, а пункты живут в портале (listbox вне формы).
 * Селект ищем по его подписи — combobox-ов на странице два.
 */
function choose(label: string, option: string | RegExp) {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: label }));
  fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: option }));
}

function save() {
  fireEvent.click(screen.getByRole('button', { name: tr('auth.settings.save') }));
}

/**
 * Показанное в селекте значение. Эталон сравнения — литерал: посчитать его тем же timeZoneLabel,
 * которым рисует форма, значит проверить, что функция равна себе.
 */
const selectValue = (label: string) => screen.getByRole('combobox', { name: label }).textContent;

/**
 * Дождаться формы, а не заголовка: «Настройки» есть ещё и пунктом меню в AppShell, поэтому
 * findByText отработал бы мгновенно — до того, как приедет профиль.
 */
function formReady() {
  return screen.findByRole('button', { name: tr('auth.settings.save') });
}

describe('SettingsPage', () => {
  it('the prefill comes from the profile, not from «auto»', async () => {
    renderSettings();
    await formReady();

    // Селекты показывают сохранённые значения: форма правит профиль, значит показывает профиль.
    // Подпись зоны — как в системном списке и на языке интерфейса, а не IANA-имя.
    // «Русский» остаётся кириллицей при любом языке интерфейса: справочник языков хранит
    // эндонимы — подпись каждого языка на нём самом, и переводу она не подлежит.
    expect(selectValue(tr('auth.settings.lang'))).toBe('Русский');
    expect(selectValue(tr('auth.settings.tz'))).toBe('(UTC+03:00) Moscow, St. Petersburg');
  });

  it('«auto» means the field is absent from the body, not an empty string', async () => {
    vi.mocked(changeUserSettings).mockResolvedValue({ lang: 'ru-RU', tz: 'Asia/Tokyo' });
    renderSettings();
    await formReady();

    choose(tr('auth.settings.tz'), tr('auth.settings.auto'));
    save();

    await waitFor(() => expect(changeUserSettings).toHaveBeenCalled());
    // Пустая строка по спеке невалидна — ключа быть не должно вовсе.
    expect(vi.mocked(changeUserSettings).mock.calls[0]![0]).toEqual({ lang: 'ru-RU' });
  });

  it('a profile value outside the registry gets its own option and is selected', async () => {
    vi.mocked(getUserInfo).mockResolvedValue({ ...PROFILE, tz: 'Antarctica/Troll' });
    renderSettings();
    await formReady();

    // Иначе MUI показал бы пустой селект вместо сохранённого значения. Подпись — та же, что
    // в строке «Часовой пояс» профиля (ProfilePage.test): один и тот же tz не должен выглядеть
    // на двух экранах по-разному, даже пока справочник фронта отстаёт от серверного.
    expect(screen.getByText('(UTC+00:00) Antarctica/Troll')).toBeInTheDocument();
  });

  it('the note about the apply window appears after saving and not before', async () => {
    vi.mocked(changeUserSettings).mockResolvedValue({ lang: 'ru-RU', tz: 'Asia/Tokyo' });
    renderSettings();
    await formReady();

    // На входе плашки нет: она про только что сделанное сохранение, а не про состояние профиля.
    // Поэтому при следующем заходе на страницу её снова не будет — состояние мутации не переживает
    // перемонтирование, отдельного «закрыть» не нужно.
    expect(screen.queryByTestId(SAVED)).toBeNull();

    save();

    expect(await screen.findByTestId(SAVED)).toBeInTheDocument();
  });

  it('a successful save patches the profile cache', async () => {
    vi.mocked(changeUserSettings).mockResolvedValue({ lang: 'ru-RU', tz: 'Asia/Tokyo' });
    const client = renderSettings();
    await formReady();

    // Пункт списка ищем по подписи зоны — она приходит из справочника на языке интерфейса.
    choose(tr('auth.settings.tz'), /Osaka, Sapporo, Tokyo/);
    save();

    await waitFor(() =>
      expect(client.getQueryData<UserInfo>(moduleQueryKey('auth', 'user'))).toMatchObject({
        tz: 'Asia/Tokyo',
      }),
    );
  });

  it('a 400 on a field highlights the matching select with the server text', async () => {
    vi.mocked(changeUserSettings).mockRejectedValue(
      new ApiFieldError([{ code: 'ValidateError/tz', detail: TZ_DETAIL }], 400),
    );
    renderSettings();
    await formReady();

    save();

    expect(await screen.findByText(TZ_DETAIL)).toBeInTheDocument();
  });

  it('a substituted zone warns only when the clocks really disagree', async () => {
    // Просили «Авто», сервер сохранил зону с другим смещением (+14 против UTC): часы разъедутся.
    vi.mocked(changeUserSettings).mockResolvedValue({ lang: 'ru-RU', tz: 'Pacific/Kiritimati' });
    renderSettings();
    await formReady();

    choose(tr('auth.settings.tz'), tr('auth.settings.auto'));
    save();

    expect(await screen.findByTestId(SUBSTITUTED)).toBeInTheDocument();
  });

  it('a response zone unknown to the browser ICU warns instead of breaking the form', async () => {
    // База ICU отстаёт от серверной на годы (Europe/Kyiv — tzdata 2022b), поэтому сервер может
    // вернуть валидное для себя имя, на котором Intl кидает RangeError. Сверить поведение такой
    // зоны нечем — предупреждаем, но форма обязана остаться живой.
    vi.mocked(changeUserSettings).mockResolvedValue({ lang: 'ru-RU', tz: 'Mars/Olympus_Mons' });
    renderSettings();
    await formReady();

    choose(tr('auth.settings.tz'), tr('auth.settings.auto'));
    save();

    expect(await screen.findByTestId(SUBSTITUTED)).toBeInTheDocument();
    // Форма на месте: рендер не свалился исключением.
    expect(screen.getByRole('button', { name: tr('auth.settings.save') })).toBeInTheDocument();
  });

  it('a behaviourally equivalent zone raises no warning', async () => {
    // Зона ОС замокана в UTC; Africa/Abidjan ведёт себя так же круглый год — часы те же.
    vi.mocked(changeUserSettings).mockResolvedValue({ lang: 'ru-RU', tz: 'Africa/Abidjan' });
    renderSettings();
    await formReady();

    choose(tr('auth.settings.tz'), tr('auth.settings.auto'));
    save();

    await waitFor(() => expect(changeUserSettings).toHaveBeenCalled());
    expect(screen.queryByTestId(SUBSTITUTED)).toBeNull();
  });

  it('an explicitly chosen zone raises no warning: the server does not match there', async () => {
    // Ответ сознательно расходится с запросом: даже так предупреждать не о чем — явное значение
    // проверяется строго, и подмены на этом пути не бывает (был бы 400 по полю).
    vi.mocked(changeUserSettings).mockResolvedValue({ lang: 'ru-RU', tz: 'Pacific/Kiritimati' });
    renderSettings();
    await formReady();

    choose(tr('auth.settings.tz'), /Tokyo/);
    save();

    await waitFor(() => expect(changeUserSettings).toHaveBeenCalled());
    expect(screen.queryByTestId(SUBSTITUTED)).toBeNull();
  });

  it('editing the form clears both notes of the previous save at once', async () => {
    vi.mocked(changeUserSettings).mockResolvedValue({ lang: 'ru-RU', tz: 'Pacific/Kiritimati' });
    renderSettings();
    await formReady();

    choose(tr('auth.settings.tz'), tr('auth.settings.auto'));
    save();
    expect(await screen.findByTestId(SAVED)).toBeInTheDocument();
    expect(screen.getByTestId(SUBSTITUTED)).toBeInTheDocument();

    // Обе плашки — про запрос, которого выбранные сейчас значения уже не касаются. Оставить одну
    // значило бы рассказывать про сервер на фоне формы, которая говорит другое.
    choose(tr('auth.settings.lang'), 'English');

    expect(screen.queryByTestId(SAVED)).toBeNull();
    expect(screen.queryByTestId(SUBSTITUTED)).toBeNull();
  });

  it('a new save attempt clears the previous warning', async () => {
    vi.mocked(changeUserSettings).mockResolvedValue({ lang: 'ru-RU', tz: 'Pacific/Kiritimati' });
    renderSettings();
    await formReady();

    choose(tr('auth.settings.tz'), tr('auth.settings.auto'));
    save();
    expect(await screen.findByTestId(SUBSTITUTED)).toBeInTheDocument();

    // Теперь сервер отвечает равнозначной зоной — предупреждать больше не о чем.
    vi.mocked(changeUserSettings).mockResolvedValue({ lang: 'ru-RU', tz: 'Africa/Abidjan' });
    choose(tr('auth.settings.tz'), tr('auth.settings.auto'));
    save();

    await waitFor(() => expect(screen.queryByTestId(SUBSTITUTED)).toBeNull());
  });

  it('the cached profile changed: the selects follow it instead of sticking to the old value', async () => {
    const client = renderSettings();
    await formReady();
    expect(selectValue(tr('auth.settings.tz'))).toBe('(UTC+03:00) Moscow, St. Petersburg');

    // Так выглядит фоновый рефетч того же ключа (или сохранение из соседней вкладки): форма
    // не перемонтируется, key на ней нет — значение должно подхватиться сравнением с прошлым.
    client.setQueryData<UserInfo>(moduleQueryKey('auth', 'user'), { ...PROFILE, tz: 'Asia/Tokyo' });

    await waitFor(() =>
      expect(selectValue(tr('auth.settings.tz'))).toBe('(UTC+09:00) Osaka, Sapporo, Tokyo'),
    );
  });

  it('the labels follow a language switch', async () => {
    await i18next.changeLanguage('ru');
    // Сверка с фиксированным словарём другого языка: без неё tr() сравнивался бы сам с собой и
    // проверка прошла бы даже на подписи, захардкоженной в компоненте.
    const en = i18next.getFixedT('en');
    expect(tr('auth.settings.save')).not.toBe(en('auth.settings.save'));

    renderSettings();

    expect(
      await screen.findByRole('button', { name: tr('auth.settings.save') }),
    ).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: tr('auth.settings.tz') })).toBeInTheDocument();
  });
});
