import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { addTranslations, initI18n, setLanguage } from '@core/i18n';
import { deployTranslations } from '@app';
import { registerBaseComponents } from '@core/renderer';
import { registerModule, resetRegistry } from '@core/module-registry';
import { resetComponents, resetSchemas } from '@core/schema';
import { realmProvider, useAuthStore } from '@core/auth';
import { contractRegistry } from '@core/contracts';
import { authModule } from '@modules/auth';
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
    is_current: isCurrent,
  };
}

const CURRENT = session('aaaaaaaa', 'Это устройство', true);
const OTHERS = [session('bbbbbbbb', 'iPhone 14'), session('cccccccc', 'Домашний ПК')];
const ADMIN_SESSIONS = [session('dddddddd', 'MacBook Pro')];

function user(realms: UserInfo['realms']): UserInfo {
  return {
    email: 'user@example.com',
    lang: 'ru-RU',
    last_login_ip: '95.165.1.1',
    last_logged_at: '2026-07-12T10:00:00Z',
    auth_2fa_type: 'NONE',
    realms,
    status: 'ENABLED',
    created_at: '2025-01-10T09:00:00Z',
    updated_at: '2026-07-12T10:00:00Z',
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
    user_kind: 'staff',
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

function renderSessions() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  return {
    client,
    invalidate,
    ...render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <SessionsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  };
}

const trashButtons = () => screen.queryAllByRole('button', { name: /Завершить сессию/ });

describe('SessionsPage', () => {
  it('текущая сессия — отдельным блоком и без корзины', async () => {
    renderSessions();
    expect(await screen.findByText('Это устройство')).toBeInTheDocument();
    expect(screen.getByText('Другие сессии (2)')).toBeInTheDocument();

    // Корзин ровно столько, сколько чужих сессий: у текущей её нет.
    expect(trashButtons()).toHaveLength(OTHERS.length);
    const currentCard = screen.getByText('Это устройство').closest('.MuiCard-root')!;
    expect(within(currentCard as HTMLElement).queryByRole('button')).toBeNull();
    expect(within(currentCard as HTMLElement).getByText('Текущая')).toBeInTheDocument();
  });

  it('массовая кнопка идёт после карточки текущей сессии и до списка остальных', async () => {
    const { container } = renderSessions();
    await screen.findByText('Это устройство');
    const text = container.textContent ?? '';
    expect(text.indexOf('Это устройство')).toBeLessThan(
      text.indexOf('Завершить все другие сессии'),
    );
    expect(text.indexOf('Завершить все другие сессии')).toBeLessThan(
      text.indexOf('Другие сессии (2)'),
    );
  });

  it('клик по корзине закрывает одну сессию', async () => {
    renderSessions();
    await screen.findByText('Это устройство');

    fireEvent.click(trashButtons()[0]!);
    await waitFor(() => expect(closeUserSessions).toHaveBeenCalledWith([OTHERS[0]!.session_id]));
  });

  it('инвалидация после закрытия не зависит от того, какой кабинет открыт сейчас', async () => {
    // Запрос закрытия висит; пока он в полёте, пользователь уходит в другой кабинет.
    let release: () => void = () => {};
    vi.mocked(closeUserSessions).mockImplementation(
      () => new Promise<void>((resolve) => (release = resolve)),
    );
    const { invalidate } = renderSessions();
    await screen.findByText('Это устройство');

    fireEvent.click(trashButtons()[0]!);
    await waitFor(() => expect(closeUserSessions).toHaveBeenCalledTimes(1));

    fireEvent.mouseDown(screen.getByRole('combobox'));
    fireEvent.click(within(screen.getByRole('listbox')).getByText('Служебный'));
    release();

    // Ключ — префикс без реалма: иначе инвалидировался бы кабинет B, а список A остался бы в кэше
    // с уже закрытой сессией.
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['auth', 'sessions'] }),
    );
  });

  it('массовое закрытие шлёт все id, кроме текущей — и только после подтверждения', async () => {
    renderSessions();
    await screen.findByText('Это устройство');

    fireEvent.click(screen.getByRole('button', { name: /Завершить все другие сессии/ }));
    expect(closeUserSessions).not.toHaveBeenCalled(); // диалог ещё открыт

    fireEvent.click(screen.getByRole('button', { name: 'Завершить' }));
    await waitFor(() =>
      expect(closeUserSessions).toHaveBeenCalledWith(OTHERS.map((s) => s.session_id)),
    );
  });

  it('пока идёт массовое закрытие, корзины выключены — второй mutate не перетрёт первый', async () => {
    // Запрос, который не завершается: держим мутацию в pending и смотрим на состояние кнопок.
    let release: () => void = () => {};
    vi.mocked(closeUserSessions).mockImplementation(
      () => new Promise<void>((resolve) => (release = resolve)),
    );
    renderSessions();
    await screen.findByText('Это устройство');

    fireEvent.click(screen.getByRole('button', { name: /Завершить все другие сессии/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Завершить' }));
    await waitFor(() => expect(closeUserSessions).toHaveBeenCalledTimes(1));
    // Пока диалог закрывается, MUI держит контент под ним aria-hidden — ждём, пока корзины вернутся.
    await waitFor(() => expect(trashButtons()).toHaveLength(OTHERS.length));

    // Клик по корзине посреди bulk раньше сбрасывал спиннер массовой кнопки и путал onSettled.
    trashButtons().forEach((btn) => expect(btn).toBeDisabled());
    fireEvent.click(trashButtons()[0]!);
    expect(closeUserSessions).toHaveBeenCalledTimes(1);

    release();
    await waitFor(() => expect(trashButtons()[0]!).toBeEnabled());
  });

  it('смена кабинета перезапрашивает список, комбобокс остаётся на месте', async () => {
    renderSessions();
    await screen.findByText('Это устройство');

    fireEvent.mouseDown(screen.getByRole('combobox'));
    fireEvent.click(within(screen.getByRole('listbox')).getByText('Служебный'));

    // Регрессия: раньше страница на время загрузки схлопывалась целиком, вместе с комбобоксом.
    expect(screen.getByRole('combobox')).toBeInTheDocument();

    await waitFor(() => expect(getUserSessions).toHaveBeenCalledWith(OTHER_REALM));
    await waitFor(() => expect(screen.getByText('Сессии (1)')).toBeInTheDocument());
    // В чужом кабинете «текущей» сессии не существует: ни карточки, ни чипа.
    expect(screen.queryByText('Это устройство')).toBeNull();
    expect(screen.queryByText('Текущая')).toBeNull();
    expect(
      screen.getByRole('button', { name: /Завершить все сессии этого кабинета/ }),
    ).toBeInTheDocument();
  });

  it('ошибка закрытия уходит вместе со списком, к которому относилась', async () => {
    vi.mocked(closeUserSessions).mockRejectedValue(new Error('500'));
    renderSessions();
    await screen.findByText('Это устройство');

    fireEvent.click(trashButtons()[0]!);
    expect(
      await screen.findByText('Не удалось закрыть сессии. Попробуйте ещё раз.'),
    ).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole('combobox'));
    fireEvent.click(within(screen.getByRole('listbox')).getByText('Служебный'));

    await waitFor(() => expect(screen.getByText('Сессии (1)')).toBeInTheDocument());
    expect(screen.queryByText('Не удалось закрыть сессии. Попробуйте ещё раз.')).toBeNull();
  });

  it('кабинет пропал из профиля → выбор сбрасывается на кабинет деплоя', async () => {
    const { client } = renderSessions();
    await screen.findByText('Это устройство');

    fireEvent.mouseDown(screen.getByRole('combobox'));
    fireEvent.click(within(screen.getByRole('listbox')).getByText('Служебный'));
    await waitFor(() => expect(getUserSessions).toHaveBeenCalledWith(OTHER_REALM));

    // Доступ к «Служебному» отозвали — профиль перезапрашивается и приходит уже без него.
    vi.mocked(getUserInfo).mockResolvedValue(ONE_REALM);
    await act(() => client.invalidateQueries({ queryKey: ['auth', 'user'] }));

    // Иначе Select остался бы со значением вне списка, а сессии запрашивались бы в чужом кабинете.
    await waitFor(() => expect(screen.queryByRole('combobox')).toBeNull());
    expect(getUserSessions).toHaveBeenLastCalledWith(CURRENT_REALM);
  });

  it('в комбобоксе — человеческие названия, а не print-shop/*', async () => {
    renderSessions();
    await screen.findByText('Это устройство');

    fireEvent.mouseDown(screen.getByRole('combobox'));
    const options = within(screen.getByRole('listbox'));
    expect(options.getByText('Клиентский')).toBeInTheDocument();
    expect(options.getByText('Служебный')).toBeInTheDocument();
    expect(options.queryByText(CURRENT_REALM)).toBeNull();
  });

  it('нет чужих сессий → массовая кнопка disabled', async () => {
    vi.mocked(getUserSessions).mockResolvedValue([CURRENT]);
    renderSessions();
    await screen.findByText('Это устройство');

    expect(screen.getByText('Других активных сессий нет.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Завершить все другие сессии/ })).toBeDisabled();
  });

  it('упал профиль → сообщение про профиль, а не про сессии', async () => {
    vi.mocked(getUserInfo).mockRejectedValue(new Error('нет связи'));
    renderSessions();

    // Список сессий тут даже не запрашивался (реалмы неизвестны) — текст про него сбивал бы с толку.
    expect(await screen.findByText('Не удалось загрузить профиль: нет связи')).toBeInTheDocument();
    expect(getUserSessions).not.toHaveBeenCalled();
  });

  it('ни одного кабинета → внятное сообщение, а не пустая страница', async () => {
    vi.mocked(getUserInfo).mockResolvedValue(user([]));
    renderSessions();

    expect(
      await screen.findByText('У вас нет ни одного кабинета — показывать нечего.'),
    ).toBeInTheDocument();
    // Реалма нет — запрашивать сессии не у чего.
    expect(getUserSessions).not.toHaveBeenCalled();
  });

  it('один кабинет → просто «Сессии», без комбобокса и слова «кабинет»', async () => {
    vi.mocked(getUserInfo).mockResolvedValue(ONE_REALM);
    const { container } = renderSessions();
    await screen.findByText('Это устройство');

    expect(screen.getByRole('heading', { name: 'Сессии' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(container.textContent).not.toMatch(/абинет/);
  });
});
