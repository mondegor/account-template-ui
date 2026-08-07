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
  setLanguage('ru');
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
  await i18next.changeLanguage('ru');
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
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
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
  return screen.findByRole('button', { name: 'Сохранить' });
}

describe('SettingsPage', () => {
  it('префилл — из профиля, а не «Авто»', async () => {
    renderSettings();
    await formReady();

    // Селекты показывают сохранённые значения: форма правит профиль, значит показывает профиль.
    // Подпись зоны — как в системном списке и на языке интерфейса, а не IANA-имя.
    expect(selectValue('Язык')).toBe('Русский');
    expect(selectValue('Часовой пояс')).toBe('(UTC+03:00) Москва, Санкт-Петербург');
  });

  it('«Авто» — это отсутствие поля в теле, а не пустая строка', async () => {
    vi.mocked(changeUserSettings).mockResolvedValue({ lang: 'ru-RU', tz: 'Asia/Tokyo' });
    renderSettings();
    await formReady();

    choose('Часовой пояс', /Авто/);
    save();

    await waitFor(() => expect(changeUserSettings).toHaveBeenCalled());
    // Пустая строка по спеке невалидна — ключа быть не должно вовсе.
    expect(vi.mocked(changeUserSettings).mock.calls[0]![0]).toEqual({ lang: 'ru-RU' });
  });

  it('значение профиля вне справочника показано отдельным пунктом и выбрано', async () => {
    vi.mocked(getUserInfo).mockResolvedValue({ ...PROFILE, tz: 'Antarctica/Troll' });
    renderSettings();
    await formReady();

    // Иначе MUI показал бы пустой селект вместо сохранённого значения. Подпись — та же, что
    // в строке «Часовой пояс» профиля (ProfilePage.test): один и тот же tz не должен выглядеть
    // на двух экранах по-разному, даже пока справочник фронта отстаёт от серверного.
    expect(screen.getByText('(UTC+00:00) Antarctica/Troll')).toBeInTheDocument();
  });

  it('плашка про окно применения появляется после сохранения, а до него её нет', async () => {
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

  it('успешное сохранение патчит кэш профиля', async () => {
    vi.mocked(changeUserSettings).mockResolvedValue({ lang: 'ru-RU', tz: 'Asia/Tokyo' });
    const client = renderSettings();
    await formReady();

    // Интерфейс в этом тесте русский — значит и подпись зоны русская.
    choose('Часовой пояс', /Осака, Саппоро, Токио/);
    save();

    await waitFor(() =>
      expect(client.getQueryData<UserInfo>(moduleQueryKey('auth', 'user'))).toMatchObject({
        tz: 'Asia/Tokyo',
      }),
    );
  });

  it('400 по полю подсвечивает нужный селект его же текстом', async () => {
    vi.mocked(changeUserSettings).mockRejectedValue(
      new ApiFieldError([{ code: 'ValidateError/tz', detail: TZ_DETAIL }], 400),
    );
    renderSettings();
    await formReady();

    save();

    expect(await screen.findByText(TZ_DETAIL)).toBeInTheDocument();
  });

  it('подменённая зона: предупреждаем, только когда часы реально расходятся', async () => {
    // Просили «Авто», сервер сохранил зону с другим смещением (+14 против UTC): часы разъедутся.
    vi.mocked(changeUserSettings).mockResolvedValue({ lang: 'ru-RU', tz: 'Pacific/Kiritimati' });
    renderSettings();
    await formReady();

    choose('Часовой пояс', /Авто/);
    save();

    expect(await screen.findByTestId(SUBSTITUTED)).toBeInTheDocument();
  });

  it('зона ответа, неизвестная ICU браузера, не роняет форму, а предупреждает', async () => {
    // База ICU отстаёт от серверной на годы (Europe/Kyiv — tzdata 2022b), поэтому сервер может
    // вернуть валидное для себя имя, на котором Intl кидает RangeError. Сверить поведение такой
    // зоны нечем — предупреждаем, но форма обязана остаться живой.
    vi.mocked(changeUserSettings).mockResolvedValue({ lang: 'ru-RU', tz: 'Mars/Olympus_Mons' });
    renderSettings();
    await formReady();

    choose('Часовой пояс', /Авто/);
    save();

    expect(await screen.findByTestId(SUBSTITUTED)).toBeInTheDocument();
    // Форма на месте: рендер не свалился исключением.
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeInTheDocument();
  });

  it('равнозначная по поведению зона предупреждения не даёт', async () => {
    // Зона ОС замокана в UTC; Africa/Abidjan ведёт себя так же круглый год — часы те же.
    vi.mocked(changeUserSettings).mockResolvedValue({ lang: 'ru-RU', tz: 'Africa/Abidjan' });
    renderSettings();
    await formReady();

    choose('Часовой пояс', /Авто/);
    save();

    await waitFor(() => expect(changeUserSettings).toHaveBeenCalled());
    expect(screen.queryByTestId(SUBSTITUTED)).toBeNull();
  });

  it('явно выбранная зона предупреждения не даёт — там сервер не подбирает', async () => {
    // Ответ сознательно расходится с запросом: даже так предупреждать не о чем — явное значение
    // проверяется строго, и подмены на этом пути не бывает (был бы 400 по полю).
    vi.mocked(changeUserSettings).mockResolvedValue({ lang: 'ru-RU', tz: 'Pacific/Kiritimati' });
    renderSettings();
    await formReady();

    choose('Часовой пояс', /Токио/);
    save();

    await waitFor(() => expect(changeUserSettings).toHaveBeenCalled());
    expect(screen.queryByTestId(SUBSTITUTED)).toBeNull();
  });

  it('правка формы снимает обе плашки прошлого сохранения разом', async () => {
    vi.mocked(changeUserSettings).mockResolvedValue({ lang: 'ru-RU', tz: 'Pacific/Kiritimati' });
    renderSettings();
    await formReady();

    choose('Часовой пояс', /Авто/);
    save();
    expect(await screen.findByTestId(SAVED)).toBeInTheDocument();
    expect(screen.getByTestId(SUBSTITUTED)).toBeInTheDocument();

    // Обе плашки — про запрос, которого выбранные сейчас значения уже не касаются. Оставить одну
    // значило бы рассказывать про сервер на фоне формы, которая говорит другое.
    choose('Язык', 'English');

    expect(screen.queryByTestId(SAVED)).toBeNull();
    expect(screen.queryByTestId(SUBSTITUTED)).toBeNull();
  });

  it('новая попытка сохранения снимает прошлое предупреждение', async () => {
    vi.mocked(changeUserSettings).mockResolvedValue({ lang: 'ru-RU', tz: 'Pacific/Kiritimati' });
    renderSettings();
    await formReady();

    choose('Часовой пояс', /Авто/);
    save();
    expect(await screen.findByTestId(SUBSTITUTED)).toBeInTheDocument();

    // Теперь сервер отвечает равнозначной зоной — предупреждать больше не о чем.
    vi.mocked(changeUserSettings).mockResolvedValue({ lang: 'ru-RU', tz: 'Africa/Abidjan' });
    choose('Часовой пояс', /Авто/);
    save();

    await waitFor(() => expect(screen.queryByTestId(SUBSTITUTED)).toBeNull());
  });

  it('профиль в кэше обновился — селекты идут за ним, а не застревают на старом', async () => {
    const client = renderSettings();
    await formReady();
    expect(selectValue('Часовой пояс')).toBe('(UTC+03:00) Москва, Санкт-Петербург');

    // Так выглядит фоновый рефетч того же ключа (или сохранение из соседней вкладки): форма
    // не перемонтируется, key на ней нет — значение должно подхватиться сравнением с прошлым.
    client.setQueryData<UserInfo>(moduleQueryKey('auth', 'user'), { ...PROFILE, tz: 'Asia/Tokyo' });

    await waitFor(() =>
      expect(selectValue('Часовой пояс')).toBe('(UTC+09:00) Осака, Саппоро, Токио'),
    );
  });

  it('en: подписи переключаются на английский', async () => {
    await i18next.changeLanguage('en');
    renderSettings();

    expect(await screen.findByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Time zone' })).toBeInTheDocument();
  });
});
