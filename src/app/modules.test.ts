import { beforeAll, describe, expect, it } from 'vitest';
import { forceLogout } from '@core/auth';
import { initI18n, setLanguage } from '@core/i18n';
import { queryClient, registerAllModules } from './modules';

/**
 * Разлогин обязан уносить кэш запросов. authStore и tokenStorage ядро чистит само, но QueryClient
 * живёт в app — подписка на onForcedLogout ставится здесь же, при регистрации модулей.
 */
describe('registerAllModules', () => {
  beforeAll(() => {
    // registerModule подмешивает переводы модулей — i18n должен быть поднят до регистрации.
    setLanguage('ru');
    initI18n();
    registerAllModules();
  });

  it("sign-out clears the cache: the next user does not see the previous one's data", () => {
    queryClient.setQueryData(['auth', 'user'], { email: 'previous@example.com' });
    queryClient.setQueryData(
      ['auth', 'sessions', 'account-template/standard'],
      [{ session_id: 'aaaa' }],
    );

    forceLogout();

    expect(queryClient.getQueryData(['auth', 'user'])).toBeUndefined();
    expect(
      queryClient.getQueryData(['auth', 'sessions', 'account-template/standard']),
    ).toBeUndefined();
  });
});
