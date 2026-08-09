import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Link, MemoryRouter, useLocation } from 'react-router';
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
import { ApiTransportError } from '@core/api';
import { contractRegistry } from '@core/contracts';
import { authModule } from '@modules/auth';
import { cardWith, rowValue } from '../../../test/dom';
import { tr } from '../../../test/i18n';
import { closeUserSessions, getUserInfo, getUserSessions } from '../api/authApi';
import { SessionsPage } from './SessionsPage';
import type { UserInfo, UserSession } from '../api/types';

/**
 * Реалм деплоя (realmProvider) — 'print-shop/standard': именно в нём осмыслен is_current.
 * Второй кабинет пользователя — чужой, там «текущей» сессии не существует.
 */
const CURRENT_REALM = 'print-shop/standard';
const OTHER_REALM = 'print-shop/admin';

function session(id: string, device: string, isCurrent = false): UserSession {
  return {
    session_id: id,
    app_name: 'Web, Firefox',
    device_name: device,
    last_ip: '95.165.1.1',
    location: 'Moscow, Russia',
    created_at: '2026-07-01T10:00:00Z',
    last_seen_at: '2026-07-12T10:00:00Z',
    expires_at: '2026-08-11T10:00:00Z',
    is_current: isCurrent,
  };
}

const CURRENT = session('aaaaaaaa', 'This device', true);
const OTHERS = [session('bbbbbbbb', 'iPhone 14'), session('cccccccc', 'Home PC')];
const ADMIN_SESSIONS = [session('dddddddd', 'MacBook Pro')];

/** Пояс профиля фикстуры: даты карточек считаются по нему, а не по зоне процесса. */
const PROFILE_TZ = 'Europe/Moscow';

function user(realms: UserInfo['realms']): UserInfo {
  return {
    email: 'user@example.com',
    lang: 'ru-RU',
    tz: PROFILE_TZ,
    auth_2fa_type: 'NONE',
    realms,
    status: 'ENABLED',
  };
}

const TWO_REALMS = user([
  {
    name: CURRENT_REALM,
    user_kind: 'standard',
    created_at: '2025-01-10T09:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
  {
    name: OTHER_REALM,
    user_kind: 'employee',
    created_at: '2025-03-02T14:30:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
]);

const ONE_REALM = user([
  {
    name: CURRENT_REALM,
    user_kind: 'standard',
    created_at: '2025-01-10T09:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
]);

vi.mock('../api/authApi', () => ({
  getUserInfo: vi.fn(),
  getUserSessions: vi.fn(),
  closeUserSessions: vi.fn(),
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

beforeEach(() => {
  vi.mocked(getUserInfo).mockResolvedValue(TWO_REALMS);
  vi.mocked(getUserSessions).mockImplementation(async (realm?: string) =>
    realm === OTHER_REALM ? ADMIN_SESSIONS : [CURRENT, ...OTHERS],
  );
  vi.mocked(closeUserSessions).mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/**
 * Кабинет живёт в URL, а MemoryRouter наружу его не отдаёт — подсматриваем через useLocation.
 * Рядом — ссылка на /sessions без параметра: точная копия пункта меню AppShell (тот же роут,
 * component={Link}), которым проверяется откат на кабинет деплоя без размонтирования страницы.
 */
function RouterProbe() {
  const { pathname, search } = useLocation();
  return (
    <>
      <span data-testid="location">{pathname + search}</span>
      <Link to="/sessions">nav-sessions</Link>
    </>
  );
}

const locationNow = () => screen.getByTestId('location').textContent;

function renderSessions(url = '/sessions') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  return {
    client,
    invalidate,
    ...render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[url]}>
          <SessionsPage />
          <RouterProbe />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  };
}

// Доступное имя корзины — подпись, а за ней имя устройства, поэтому сверяем начало строки.
// Функцией, а не регуляркой: подпись приходит из переводов, и метасимвол в ней молча сломал бы
// шаблон — совпадений не стало бы, а тест сказал бы «кнопок нет».
const trashButtons = () =>
  screen.queryAllByRole('button', {
    name: (name: string) => name.startsWith(tr('auth.sessions.closeOne')),
  });

describe('SessionsPage', () => {
  it('the current session sits in its own block and has no bin', async () => {
    renderSessions();
    expect(await screen.findByText('This device')).toBeInTheDocument();
    expect(
      screen.getByText(tr('auth.sessions.otherSessions', { n: OTHERS.length })),
    ).toBeInTheDocument();

    // Корзин ровно столько, сколько чужих сессий: у текущей её нет.
    expect(trashButtons()).toHaveLength(OTHERS.length);
    const currentCard = screen.getByText('This device').closest('.MuiCard-root')!;
    expect(within(currentCard as HTMLElement).queryByRole('button')).toBeNull();
    expect(
      within(currentCard as HTMLElement).getByText(tr('auth.sessions.current')),
    ).toBeInTheDocument();
  });

  it('«expires» is an absolute date, formatted like «opened»', async () => {
    renderSessions();
    await screen.findByText('This device');
    expect(rowValue(tr('auth.sessions.expiresAt'), cardWith('This device'))?.textContent).toBe(
      // Локаль берём ту же, что страница (@core/i18n: toLocale активного языка), а не жёсткую:
      // эталон обязан ехать за языком интерфейса.
      formatDateTimeLong(new Date('2026-08-11T10:00:00Z'), toLocale(i18next.language), PROFILE_TZ),
    );
  });

  it('no expires_at (the field is optional): «expires» shows a dash', async () => {
    vi.mocked(getUserSessions).mockResolvedValue([{ ...CURRENT, expires_at: undefined }]);
    renderSessions();
    await screen.findByText('This device');
    expect(rowValue(tr('auth.sessions.expiresAt'), cardWith('This device'))?.textContent).toBe('—');
  });

  it('a location with no data (missing field or empty string): a dash, the row stays', async () => {
    vi.mocked(getUserSessions).mockResolvedValue([
      CURRENT,
      { ...OTHERS[0]!, location: undefined },
      { ...OTHERS[1]!, location: '' },
    ]);
    renderSessions();
    await screen.findByText('This device');

    const locationOf = (device: string) =>
      rowValue(tr('auth.sessions.location'), cardWith(device))?.textContent;
    expect(locationOf('This device')).toBe('Moscow, Russia');
    // Как в профиле у «Локации последнего входа»: нет данных — прочерк, а не пропавшая строка.
    expect(locationOf('iPhone 14')).toBe('—');
    expect(locationOf('Home PC')).toBe('—');
  });

  it('the bulk button comes after the current-session card and before the rest of the list', async () => {
    const { container } = renderSessions();
    await screen.findByText('This device');
    const text = container.textContent ?? '';
    expect(text.indexOf('This device')).toBeLessThan(
      text.indexOf(tr('auth.sessions.terminateOthers')),
    );
    expect(text.indexOf(tr('auth.sessions.terminateOthers'))).toBeLessThan(
      text.indexOf(tr('auth.sessions.otherSessions', { n: OTHERS.length })),
    );
  });

  it('a click on the bin closes a single session', async () => {
    renderSessions();
    await screen.findByText('This device');

    fireEvent.click(trashButtons()[0]!);
    await waitFor(() => expect(closeUserSessions).toHaveBeenCalledWith([OTHERS[0]!.session_id]));
  });

  it('invalidation after closing does not depend on which realm is open right now', async () => {
    // Запрос закрытия висит; пока он в полёте, пользователь уходит в другой кабинет.
    let release: () => void = () => {};
    vi.mocked(closeUserSessions).mockImplementation(
      () => new Promise<void>((resolve) => (release = resolve)),
    );
    const { invalidate } = renderSessions();
    await screen.findByText('This device');

    fireEvent.click(trashButtons()[0]!);
    await waitFor(() => expect(closeUserSessions).toHaveBeenCalledTimes(1));

    fireEvent.mouseDown(screen.getByRole('combobox'));
    fireEvent.click(
      within(screen.getByRole('listbox')).getByText(tr('deploy.realmLabel.print-shop/admin')),
    );
    release();

    // Ключ — префикс без реалма: иначе инвалидировался бы кабинет B, а список A остался бы в кэше
    // с уже закрытой сессией.
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['auth', 'sessions'] }),
    );
  });

  it('bulk closing sends every id except the current one, and only after confirmation', async () => {
    renderSessions();
    await screen.findByText('This device');

    fireEvent.click(screen.getByRole('button', { name: tr('auth.sessions.terminateOthers') }));
    expect(closeUserSessions).not.toHaveBeenCalled(); // диалог ещё открыт

    fireEvent.click(screen.getByRole('button', { name: tr('auth.sessions.confirm') }));
    await waitFor(() =>
      expect(closeUserSessions).toHaveBeenCalledWith(OTHERS.map((s) => s.session_id)),
    );
  });

  it('while bulk closing runs the bins are disabled: a second mutate cannot overwrite the first', async () => {
    // Запрос, который не завершается: держим мутацию в pending и смотрим на состояние кнопок.
    let release: () => void = () => {};
    vi.mocked(closeUserSessions).mockImplementation(
      () => new Promise<void>((resolve) => (release = resolve)),
    );
    renderSessions();
    await screen.findByText('This device');

    fireEvent.click(screen.getByRole('button', { name: tr('auth.sessions.terminateOthers') }));
    fireEvent.click(screen.getByRole('button', { name: tr('auth.sessions.confirm') }));
    await waitFor(() => expect(closeUserSessions).toHaveBeenCalledTimes(1));
    // Пока диалог закрывается, MUI держит контент под ним aria-hidden — ждём, пока корзины вернутся.
    await waitFor(() => expect(trashButtons()).toHaveLength(OTHERS.length));

    // Клик по корзине посреди bulk не трогает спиннер массовой кнопки и не путает onSettled.
    trashButtons().forEach((btn) => expect(btn).toBeDisabled());
    fireEvent.click(trashButtons()[0]!);
    expect(closeUserSessions).toHaveBeenCalledTimes(1);

    release();
    await waitFor(() => expect(trashButtons()[0]!).toBeEnabled());
  });

  it('changing the realm refetches the list, the combobox stays in place', async () => {
    renderSessions();
    await screen.findByText('This device');

    fireEvent.mouseDown(screen.getByRole('combobox'));
    fireEvent.click(
      within(screen.getByRole('listbox')).getByText(tr('deploy.realmLabel.print-shop/admin')),
    );

    // Комбобокс переживает загрузку: страница не схлопывается целиком.
    expect(screen.getByRole('combobox')).toBeInTheDocument();

    await waitFor(() => expect(getUserSessions).toHaveBeenCalledWith(OTHER_REALM));
    await waitFor(() =>
      expect(screen.getByText(tr('auth.sessions.allSessions', { n: 1 }))).toBeInTheDocument(),
    );
    // В чужом кабинете «текущей» сессии не существует: ни карточки, ни подписи.
    expect(screen.queryByText('This device')).toBeNull();
    expect(screen.queryByText(tr('auth.sessions.current'))).toBeNull();
    expect(
      screen.getByRole('button', { name: tr('auth.sessions.terminateAll') }),
    ).toBeInTheDocument();
  });

  it('the chosen realm goes into the URL: a reload and a forwarded link both keep it', async () => {
    renderSessions();
    await screen.findByText('This device');
    expect(locationNow()).toBe('/sessions');

    fireEvent.mouseDown(screen.getByRole('combobox'));
    fireEvent.click(
      within(screen.getByRole('listbox')).getByText(tr('deploy.realmLabel.print-shop/admin')),
    );

    await waitFor(() =>
      expect(locationNow()).toBe(`/sessions?realm=${encodeURIComponent(OTHER_REALM)}`),
    );
  });

  it('the «sessions» menu item (/sessions with no parameter) falls back to the deployment realm', async () => {
    renderSessions(`/sessions?realm=${encodeURIComponent(OTHER_REALM)}`);
    await waitFor(() =>
      expect(screen.getByRole('combobox').textContent).toBe(
        tr('deploy.realmLabel.print-shop/admin'),
      ),
    );

    // Роут тот же — страница не размонтируется, инициализатор стейта не перезапустился бы. Пока
    // кабинет жил в useState, он тут залипал: адрес /sessions, а на экране служебный кабинет.
    fireEvent.click(screen.getByRole('link', { name: 'nav-sessions' }));

    await waitFor(() => expect(locationNow()).toBe('/sessions'));
    await waitFor(() =>
      expect(screen.getByRole('combobox').textContent).toBe(
        tr('deploy.realmLabel.print-shop/standard'),
      ),
    );
    await waitFor(() => expect(getUserSessions).toHaveBeenCalledWith(CURRENT_REALM));
  });

  it('?realm= from the profile link opens the sessions of that realm', async () => {
    renderSessions(`/sessions?realm=${encodeURIComponent(OTHER_REALM)}`);

    await waitFor(() => expect(getUserSessions).toHaveBeenCalledWith(OTHER_REALM));
    // Кабинет деплоя не должен запрашиваться даже мельком: ссылка ведёт сразу в нужный.
    expect(getUserSessions).not.toHaveBeenCalledWith(CURRENT_REALM);
    await waitFor(() =>
      expect(screen.getByText(tr('auth.sessions.allSessions', { n: 1 }))).toBeInTheDocument(),
    );
    expect(screen.getByRole('combobox').textContent).toBe(tr('deploy.realmLabel.print-shop/admin'));
  });

  it('a foreign ?realm= is ignored: fall back to the deployment realm and clean the address', async () => {
    // URL правится руками: доступа к кабинету нет, запрос туда уходить не должен.
    renderSessions('/sessions?realm=print-shop%2Fsomebody-else');

    await screen.findByText('This device');
    expect(getUserSessions).toHaveBeenCalledWith(CURRENT_REALM);
    expect(getUserSessions).not.toHaveBeenCalledWith('print-shop/somebody-else');
    expect(screen.getByRole('combobox').textContent).toBe(
      tr('deploy.realmLabel.print-shop/standard'),
    );
    // Иначе адрес называл бы один кабинет, а экран показывал другой — и такую ссылку переслали бы.
    await waitFor(() => expect(locationNow()).toBe('/sessions'));
  });

  it('a foreign realm does not wipe the neighbouring query parameters', async () => {
    renderSessions('/sessions?realm=print-shop%2Fsomebody-else&keep=1');

    await screen.findByText('This device');
    await waitFor(() => expect(locationNow()).toBe('/sessions?keep=1'));
  });

  it('choosing a realm does not wipe the neighbouring query parameters', async () => {
    renderSessions('/sessions?keep=1');
    await screen.findByText('This device');

    fireEvent.mouseDown(screen.getByRole('combobox'));
    fireEvent.click(
      within(screen.getByRole('listbox')).getByText(tr('deploy.realmLabel.print-shop/admin')),
    );

    await waitFor(() =>
      expect(locationNow()).toBe(`/sessions?keep=1&realm=${encodeURIComponent(OTHER_REALM)}`),
    );
  });

  it('a close error goes away together with the list it belonged to', async () => {
    vi.mocked(closeUserSessions).mockRejectedValue(new Error('500'));
    renderSessions();
    await screen.findByText('This device');

    fireEvent.click(trashButtons()[0]!);
    expect(await screen.findByText(tr('auth.sessions.closeError'))).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole('combobox'));
    fireEvent.click(
      within(screen.getByRole('listbox')).getByText(tr('deploy.realmLabel.print-shop/admin')),
    );

    await waitFor(() =>
      expect(screen.getByText(tr('auth.sessions.allSessions', { n: 1 }))).toBeInTheDocument(),
    );
    expect(screen.queryByText(tr('auth.sessions.closeError'))).toBeNull();
  });

  it('a close error goes away when the realm is changed by the menu item, not the combobox', async () => {
    // Комбобокс — не единственная дверь: кабинет живёт в URL, и пункт меню «Сессии» меняет его
    // мимо selectRealm (тот же роут — страница не размонтируется). Ошибка всё равно относится к
    // прошлому списку и обязана уйти вместе с ним, иначе висит над сессиями другого кабинета.
    vi.mocked(closeUserSessions).mockRejectedValue(new Error('500'));
    renderSessions(`/sessions?realm=${encodeURIComponent(OTHER_REALM)}`);
    await screen.findByText('MacBook Pro');

    fireEvent.click(trashButtons()[0]!);
    expect(await screen.findByText(tr('auth.sessions.closeError'))).toBeInTheDocument();

    fireEvent.click(screen.getByRole('link', { name: 'nav-sessions' }));

    await waitFor(() => expect(screen.getByText('This device')).toBeInTheDocument());
    expect(screen.queryByText(tr('auth.sessions.closeError'))).toBeNull();
  });

  it('the realm changed mid-request: the error does not surface over a foreign list and does not wait for a return', async () => {
    // Корзины на время запроса выключены, а комбобокс — нет: кабинет можно сменить, пока запрос в
    // полёте, и тогда ошибка рождается уже над чужим списком.
    let fail: (e: Error) => void = () => {};
    vi.mocked(closeUserSessions).mockImplementation(
      () => new Promise<void>((_, reject) => (fail = reject)),
    );
    renderSessions();
    await screen.findByText('This device');

    fireEvent.click(trashButtons()[0]!);
    await waitFor(() => expect(closeUserSessions).toHaveBeenCalledTimes(1));

    fireEvent.mouseDown(screen.getByRole('combobox'));
    fireEvent.click(
      within(screen.getByRole('listbox')).getByText(tr('deploy.realmLabel.print-shop/admin')),
    );
    await screen.findByText('MacBook Pro');

    // Ошибка приходит, когда на экране уже чужой кабинет. Оседания мутации ждём по корзине: пока
    // запрос в полёте, она выключена — включилась, значит error уже долетел до стейта.
    fail(new Error('500'));
    await waitFor(() => expect(trashButtons()[0]!).toBeEnabled());
    expect(screen.queryByText(tr('auth.sessions.closeError'))).toBeNull();

    // И не всплывает при возврате: стейт мутации выброшен, а не просто спрятан условием рендера.
    fireEvent.mouseDown(screen.getByRole('combobox'));
    fireEvent.click(
      within(screen.getByRole('listbox')).getByText(tr('deploy.realmLabel.print-shop/standard')),
    );
    await screen.findByText('This device');
    expect(screen.queryByText(tr('auth.sessions.closeError'))).toBeNull();
  });

  it('the realm disappeared from the profile: the choice resets to the deployment realm', async () => {
    const { client } = renderSessions();
    await screen.findByText('This device');

    fireEvent.mouseDown(screen.getByRole('combobox'));
    fireEvent.click(
      within(screen.getByRole('listbox')).getByText(tr('deploy.realmLabel.print-shop/admin')),
    );
    await waitFor(() => expect(getUserSessions).toHaveBeenCalledWith(OTHER_REALM));

    // Доступ к «Служебному» отозвали — профиль перезапрашивается и приходит уже без него.
    vi.mocked(getUserInfo).mockResolvedValue(ONE_REALM);
    await act(() => client.invalidateQueries({ queryKey: ['auth', 'user'] }));

    // Иначе Select остался бы со значением вне списка, а сессии запрашивались бы в чужом кабинете.
    await waitFor(() => expect(screen.queryByRole('combobox')).toBeNull());
    expect(getUserSessions).toHaveBeenLastCalledWith(CURRENT_REALM);
  });

  it('the combobox shows human names, not print-shop/*', async () => {
    renderSessions();
    await screen.findByText('This device');

    fireEvent.mouseDown(screen.getByRole('combobox'));
    const options = within(screen.getByRole('listbox'));
    expect(options.getByText(tr('deploy.realmLabel.print-shop/standard'))).toBeInTheDocument();
    expect(options.getByText(tr('deploy.realmLabel.print-shop/admin'))).toBeInTheDocument();
    expect(options.queryByText(CURRENT_REALM)).toBeNull();
  });

  it('no other sessions: the bulk button is disabled', async () => {
    vi.mocked(getUserSessions).mockResolvedValue([CURRENT]);
    renderSessions();
    await screen.findByText('This device');

    expect(screen.getByText(tr('auth.sessions.empty'))).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: tr('auth.sessions.terminateOthers') }),
    ).toBeDisabled();
  });

  it('the profile request failed: the message is about the profile, not the sessions', async () => {
    // Ошибка в том виде, в каком её отдаёт интерсептор. Текст плашки берётся из переводов, а не из
    // `message` класса: тот английский и служебный (@core/api/errors).
    vi.mocked(getUserInfo).mockRejectedValue(new ApiTransportError());
    renderSessions();

    // Список сессий тут даже не запрашивался (реалмы неизвестны) — текст про него сбивал бы с толку.
    expect(
      await screen.findByText(
        tr('auth.profile.loadError', { message: tr('common.error.network') }),
      ),
    ).toBeInTheDocument();
    expect(getUserSessions).not.toHaveBeenCalled();
  });

  it('no realms at all: a clear message, not an empty page', async () => {
    vi.mocked(getUserInfo).mockResolvedValue(user([]));
    renderSessions();

    expect(await screen.findByText(tr('auth.sessions.noRealms'))).toBeInTheDocument();
    // Реалма нет — запрашивать сессии не у чего.
    expect(getUserSessions).not.toHaveBeenCalled();
  });

  it('a single realm: just «sessions», with no combobox and no realm wording', async () => {
    vi.mocked(getUserInfo).mockResolvedValue(ONE_REALM);
    const { container } = renderSessions();
    await screen.findByText('This device');

    expect(screen.getByRole('heading', { name: tr('auth.sessions.title') })).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).toBeNull();
    // Слово «кабинет» на экране одного кабинета неуместно — берём его из тех же переводов,
    // где оно и живёт, а не пишем руками.
    expect(container.textContent?.toLowerCase()).not.toContain(
      tr('auth.sessions.realm').toLowerCase(),
    );
  });
});
