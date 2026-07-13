import { QueryClient } from '@tanstack/react-query';
import { registerModule, type ModuleInitContext } from '@core/module-registry';
import { addTranslations } from '@core/i18n';
import { onForcedLogout, realmProvider } from '@core/auth';
import { contractRegistry } from '@core/contracts';
import { authModule } from '@modules/auth';
import { demoModule } from '@modules/demo';
import { deployTranslations } from './i18n/deploy';

/**
 * Композиция приложения: общий QueryClient + список модулей. registerAllModules() прогоняет
 * реестр (порядок детерминирован, auth первым — eager). Добавить модуль = дописать сюда его
 * ModuleDefinition; ядро не меняется.
 */

export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

const modules = [authModule, demoModule];

let registered = false;

export function registerAllModules(): void {
  if (registered) return;
  registered = true;
  // Подписи реалмов/типов аккаунта — это про деплой, а не про модуль: имена print-shop/* живут здесь.
  addTranslations(deployTranslations);
  const ctx: ModuleInitContext = { queryClient, contracts: contractRegistry, realmProvider };
  for (const m of modules) registerModule(m, ctx);

  // Разлогин (и осознанный выход, и принудительный) обязан унести с собой кэш запросов: иначе
  // следующий пользователь в этой же вкладке увидит из кэша профиль и устройства предыдущего.
  // Подписка со стороны app — ядру про QueryClient знать незачем.
  onForcedLogout(() => queryClient.clear());
}
