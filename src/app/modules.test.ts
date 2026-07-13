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

  it('разлогин чистит кэш: следующий пользователь не увидит данные предыдущего', () => {
    queryClient.setQueryData(['auth', 'user'], { email: 'previous@example.com' });
    queryClient.setQueryData(['auth', 'sessions', 'print-shop/standard'], [{ session_id: 'aaaa' }]);

    forceLogout();

    expect(queryClient.getQueryData(['auth', 'user'])).toBeUndefined();
    expect(queryClient.getQueryData(['auth', 'sessions', 'print-shop/standard'])).toBeUndefined();
  });
});
