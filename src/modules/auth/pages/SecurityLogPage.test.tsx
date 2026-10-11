import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { initI18n, setLanguage } from '@core/i18n';
import { registerBaseComponents } from '@core/renderer';
import { moduleQueryKey, registerModule, resetRegistry } from '@core/module-registry';
import { resetComponents, resetSchemas } from '@core/schema';
import { realmProvider, useAuthStore } from '@core/auth';
import { ApiTransportError } from '@core/api';
import { contractRegistry } from '@core/contracts';
import { authModule } from '@modules/auth';
import { tr } from '../../../test/i18n';
import { getSecurityLog, getUserInfo } from '../api/authApi';
import { SecurityLogPage } from './SecurityLogPage';
import type { SecurityLog, SecurityLogItem, UserInfo } from '../api/types';

/** Пояс профиля фикстуры: дни ленты считаются по нему, а не по зоне процесса. */
const PROFILE_TZ = 'Europe/Moscow';

vi.mock('../api/authApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/authApi')>()),
  getUserInfo: vi.fn(),
  getSecurityLog: vi.fn(),
}));

const USER: UserInfo = {
  email: 'user@example.com',
  lang: 'en-US',
  tz: PROFILE_TZ,
  auth_2fa_type: 'NONE',
  realms: [],
  status: 'ENABLED',
};

function event(id: string, created_at: string, fields: Partial<SecurityLogItem> = {}) {
  return {
    id,
    event_type: 'SIGNED_IN',
    ip: '95.165.1.1',
    app_name: 'Web, Firefox',
    device_name: `Device ${id}`,
    created_at,
    ...fields,
  } satisfies SecurityLogItem;
}

/** Страница ответа: курсор — id последней записи, и только когда за ней есть следующая. */
function page(items: SecurityLogItem[], hasNext: boolean): SecurityLog {
  const last = items[items.length - 1];
  return hasNext && last ? { items, cursor: last.id } : { items };
}

const FIRST = page(
  Array.from({ length: 10 }, (_, i) => event(String(100 - i), '2026-10-05T09:00:00Z')),
  true,
);
const SECOND = page([event('90', '2026-10-04T09:00:00Z')], false);

/**
 * jsdom не умеет IntersectionObserver: стаб запоминает колбэк последнего наблюдателя, и тест сам
 * решает, когда метка конца ленты «показалась».
 */
let revealSentinel: () => void = () => {};
beforeAll(() => {
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(cb: (entries: Array<{ isIntersecting: boolean }>) => void) {
        revealSentinel = () => cb([{ isIntersecting: true }]);
      }
      observe() {}
      disconnect() {}
    },
  );
  setLanguage('en');
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

beforeEach(() => {
  vi.mocked(getUserInfo).mockResolvedValue(USER);
});

afterEach(() => {
  cleanup();
  vi.mocked(getSecurityLog).mockReset();
  vi.restoreAllMocks();
});

function renderPage(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SecurityLogPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const rows = () => screen.getAllByText(tr('auth.securityLog.event.SIGNED_IN'));

describe('SecurityLogPage', () => {
  it('shows the first page of ten and keeps the sentinel while there is more', async () => {
    vi.mocked(getSecurityLog).mockResolvedValueOnce(FIRST);
    renderPage();

    await screen.findByText('Web, Firefox · Device 100 · 95.165.1.1');
    expect(rows()).toHaveLength(10);
    expect(getSecurityLog).toHaveBeenCalledWith({ cursor: undefined, limit: 10 });
    expect(screen.getByTestId('security-log-sentinel')).toBeInTheDocument();
    expect(screen.queryByText(tr('auth.securityLog.end'))).toBeNull();
  });

  it('the sentinel coming into view loads the next ten by cursor, then the end is shown', async () => {
    vi.mocked(getSecurityLog).mockResolvedValueOnce(FIRST).mockResolvedValueOnce(SECOND);
    renderPage();
    await screen.findByText('Web, Firefox · Device 100 · 95.165.1.1');

    act(() => revealSentinel());

    expect(await screen.findByText('Web, Firefox · Device 90 · 95.165.1.1')).toBeInTheDocument();
    expect(getSecurityLog).toHaveBeenLastCalledWith({ cursor: '91', limit: 10 });
    expect(rows()).toHaveLength(11);
    expect(screen.getByText(tr('auth.securityLog.end'))).toBeInTheDocument();
    expect(screen.queryByTestId('security-log-sentinel')).toBeNull();
  });

  it('a failed next page keeps what is loaded and offers a retry instead of the sentinel', async () => {
    vi.mocked(getSecurityLog)
      .mockResolvedValueOnce(FIRST)
      .mockRejectedValueOnce(new ApiTransportError())
      .mockResolvedValueOnce(SECOND);
    renderPage();
    await screen.findByText('Web, Firefox · Device 100 · 95.165.1.1');

    act(() => revealSentinel());

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(tr('common.error.network'));
    expect(rows()).toHaveLength(10);
    // Метка снята: прокрутка сама упавший запрос не повторяет.
    expect(screen.queryByTestId('security-log-sentinel')).toBeNull();

    fireEvent.click(within(alert).getByRole('button', { name: tr('auth.securityLog.retry') }));

    expect(await screen.findByText('Web, Firefox · Device 90 · 95.165.1.1')).toBeInTheDocument();
    expect(getSecurityLog).toHaveBeenLastCalledWith({ cursor: '91', limit: 10 });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('while a failed next page is being retried, only the spinner is shown', async () => {
    let answer: (p: SecurityLog) => void = () => {};
    vi.mocked(getSecurityLog)
      .mockResolvedValueOnce(FIRST)
      .mockRejectedValueOnce(new ApiTransportError())
      .mockReturnValueOnce(new Promise<SecurityLog>((resolve) => (answer = resolve)));
    renderPage();
    await screen.findByText('Web, Firefox · Device 100 · 95.165.1.1');

    act(() => revealSentinel());
    const alert = await screen.findByRole('alert');
    fireEvent.click(within(alert).getByRole('button', { name: tr('auth.securityLog.retry') }));

    expect(await screen.findByRole('progressbar')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();

    act(() => answer(SECOND));
    expect(await screen.findByText('Web, Firefox · Device 90 · 95.165.1.1')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('a failed first page is an alert in place of the feed, retry asks again', async () => {
    vi.mocked(getSecurityLog)
      .mockRejectedValueOnce(new ApiTransportError())
      .mockResolvedValueOnce(SECOND);
    renderPage();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(tr('common.error.network'));

    fireEvent.click(within(alert).getByRole('button', { name: tr('auth.securityLog.retry') }));

    expect(await screen.findByText('Web, Firefox · Device 90 · 95.165.1.1')).toBeInTheDocument();
  });

  it('when both the profile and the log fail, one retry asks for both', async () => {
    vi.mocked(getUserInfo)
      .mockRejectedValueOnce(new ApiTransportError())
      .mockResolvedValueOnce(USER);
    vi.mocked(getSecurityLog)
      .mockRejectedValueOnce(new ApiTransportError())
      .mockResolvedValueOnce(SECOND);
    renderPage();

    const alert = await screen.findByRole('alert');
    fireEvent.click(within(alert).getByRole('button', { name: tr('auth.securityLog.retry') }));

    expect(await screen.findByText('Web, Firefox · Device 90 · 95.165.1.1')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a failed background reread of a cached profile keeps the feed', async () => {
    vi.mocked(getUserInfo).mockRejectedValueOnce(new ApiTransportError());
    vi.mocked(getSecurityLog).mockResolvedValueOnce(SECOND);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(moduleQueryKey('auth', 'user'), USER);
    renderPage(client);

    await screen.findByText('Web, Firefox · Device 90 · 95.165.1.1');
    await waitFor(() => expect(getUserInfo).toHaveBeenCalled());
    await waitFor(() =>
      expect(client.getQueryState(moduleQueryKey('auth', 'user'))?.status).toBe('error'),
    );
    expect(screen.getByText('Web, Firefox · Device 90 · 95.165.1.1')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('coming back to the page starts the feed from the first page again', async () => {
    vi.mocked(getSecurityLog)
      .mockResolvedValueOnce(FIRST)
      .mockResolvedValueOnce(SECOND)
      .mockResolvedValueOnce(FIRST);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const first = renderPage(client);
    await screen.findByText('Web, Firefox · Device 100 · 95.165.1.1');
    act(() => revealSentinel());
    await screen.findByText('Web, Firefox · Device 90 · 95.165.1.1');
    first.unmount();
    // gcTime: 0 убирает ленту из кэша не сразу, а таймером после размонтирования.
    await waitFor(() =>
      expect(client.getQueryData(moduleQueryKey('auth', 'securityLog', 'feed'))).toBeUndefined(),
    );
    vi.mocked(getSecurityLog).mockClear();

    renderPage(client);

    await screen.findByText('Web, Firefox · Device 100 · 95.165.1.1');
    expect(getSecurityLog).toHaveBeenCalledTimes(1);
    expect(getSecurityLog).toHaveBeenCalledWith({ cursor: undefined, limit: 10 });
    expect(screen.queryByText('Web, Firefox · Device 90 · 95.165.1.1')).toBeNull();
  });

  it('an empty log says so, without the end-of-log line', async () => {
    vi.mocked(getSecurityLog).mockResolvedValueOnce(page([], false));
    renderPage();

    expect(await screen.findByText(tr('auth.securityLog.empty'))).toBeInTheDocument();
    expect(screen.queryByText(tr('auth.securityLog.end'))).toBeNull();
  });

  it('days are split by the profile time zone', async () => {
    // 09:00 11 октября по Москве. Оба события в UTC приходятся на 10 октября, но по Москве первое
    // уже 11-го (00:10), а второе ещё 10-го (23:50).
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-10-11T06:00:00Z').getTime());
    vi.mocked(getSecurityLog).mockResolvedValueOnce(
      page(
        [
          event('2', '2026-10-10T21:10:00Z'),
          event('1', '2026-10-10T20:50:00Z'),
          event('0', '2026-10-08T09:00:00Z'),
        ],
        false,
      ),
    );
    const { container } = renderPage();
    await screen.findByText('Web, Firefox · Device 2 · 95.165.1.1');

    await waitFor(() =>
      expect([...container.querySelectorAll('h2')].map((h) => h.textContent)).toEqual([
        tr('auth.securityLog.today'),
        tr('auth.securityLog.yesterday'),
        'October 8',
      ]),
    );
    // Время строки — по тем же московским часам (`\s`: ICU ставит перед AM узкий неразрывный пробел).
    expect(screen.getByText(/^12:10\sAM$/)).toBeInTheDocument();
  });
});
