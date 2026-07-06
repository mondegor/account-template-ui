import { QueryClient } from '@tanstack/react-query';
import { registerModule, type ModuleInitContext } from '@core/module-registry';
import { realmProvider } from '@core/auth';
import { contractRegistry } from '@core/contracts';
import { authModule } from '@modules/auth';
import { demoModule } from '@modules/demo';

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
  const ctx: ModuleInitContext = { queryClient, contracts: contractRegistry, realmProvider };
  for (const m of modules) registerModule(m, ctx);
}
